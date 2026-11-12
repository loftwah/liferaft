import fs from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  BrowserWindow as ElectronBrowserWindow,
  OpenDialogOptions,
  UtilityProcess
} from 'electron'
import type {
  AgentAccessStatus,
  ArchiveSummary,
  ImportProgressEvent
} from '@shared/contracts'
import { getArchiveRecoveryIdentity } from '@shared/recovery-files'
import { AgentAccessStore } from '../mcp/access'
import { ArchiveDatabasePool } from './archive-db'
import { CatalogStore } from './catalog'
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  shell,
  utilityProcess
} from './electron-runtime'
import { ExportService } from './exporter'
import { MessagePreviewService } from './message-preview'
import { SearchService } from './search'
import { observeImportProcess } from './import-lifecycle'

interface ActiveImport {
  archive: ArchiveSummary
  process: UtilityProcess
  lifetime: ReturnType<typeof observeImportProcess>
  stopping: boolean
}

async function removeSqliteArtifacts(dbPath: string): Promise<void> {
  // If the database is still locked, preserve its journal for a later retry.
  await rm(dbPath, { force: true })
  const results = await Promise.allSettled([
    rm(`${dbPath}-wal`, { force: true }),
    rm(`${dbPath}-shm`, { force: true })
  ])
  if (results.some((result) => result.status === 'rejected')) {
    throw new Error(
      'Some local index files could not be removed. Close other Liferaft agents and try again.'
    )
  }
}

export function registerIpc(
  getMainWindow: () => ElectronBrowserWindow | null,
  catalog: CatalogStore,
  pool: ArchiveDatabasePool,
  access: AgentAccessStore
): () => Promise<void> {
  const search = new SearchService(catalog, pool)
  const preview = new MessagePreviewService(catalog, pool)
  const exporter = new ExportService(catalog, pool)
  const activeImports = new Map<string, ActiveImport>()
  const cleanupJobs = new Map<string, Promise<void>>()
  const inflightIpc = new Set<Promise<unknown>>()
  const selectedPaths = new Set<string>()
  let disposing = false
  const getWindow = () => {
    const window = getMainWindow()
    if (!window || window.isDestroyed())
      throw new Error('Open Liferaft to continue.')
    return window
  }
  const handle = (
    channel: string,
    handler: Parameters<typeof ipcMain.handle>[1]
  ) => {
    ipcMain.handle(channel, (event, ...args) => {
      const window = getWindow()
      if (disposing)
        throw new Error(
          'Liferaft is finishing its current work. Try again shortly.'
        )
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      ) {
        throw new Error('This request did not come from the Liferaft window.')
      }
      const operation = Promise.resolve(handler(event, ...args))
      inflightIpc.add(operation)
      return operation.finally(() => inflightIpc.delete(operation))
    })
  }

  const accessStatus = (): AgentAccessStatus => {
    const grant = access.read()
    return {
      enabled: Boolean(grant),
      archiveIds: grant?.archiveIds ?? [],
      exportDirectories:
        grant?.exportDirectories.map(({ id, name, path }) => ({
          id,
          name,
          path
        })) ?? [],
      command: app.getPath('exe'),
      args: app.isPackaged ? ['--mcp'] : [app.getAppPath(), '--mcp']
    }
  }

  handle('liferaft:agent-access', accessStatus)
  handle(
    'liferaft:enable-agent-access',
    async (_event, archiveIds: unknown) => {
      if (
        !Array.isArray(archiveIds) ||
        archiveIds.length < 1 ||
        archiveIds.length > 32 ||
        archiveIds.some((id) => typeof id !== 'string')
      ) {
        throw new Error('Choose between 1 and 32 indexed archives.')
      }
      const ids = [...new Set(archiveIds as string[])]
      const archives = ids.map((id) => {
        const archive = catalog.getArchiveById(id)
        if (!archive || archive.status !== 'ready')
          throw new Error('Wait for the selected archives to finish indexing.')
        getArchiveRecoveryIdentity(pool.getDatabase(archive))
        return archive
      })
      const folder = await dialog.showOpenDialog(getWindow(), {
        title: 'Choose the agent recovery folder',
        properties: ['openDirectory', 'createDirectory']
      })
      if (folder.canceled || !folder.filePaths[0]) return accessStatus()
      const confirm = await dialog.showMessageBox(getWindow(), {
        type: 'question',
        title: 'Enable agent access',
        message:
          'Allow your agent to read these archives and recover selected files?',
        detail: `Archives: ${archives.map((archive) => archive.name).join(', ')}\n\nExport folder: ${folder.filePaths[0]}\n\nYour agent may send returned messages and snippets to its model provider. Archived text cannot grant extra access. Existing files are never overwritten. You can revoke access in Liferaft.`,
        buttons: ['Cancel', 'Enable access'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (confirm.response !== 1) return accessStatus()
      // A native dialog can stay open while an import finishes or an index changes.
      for (const archive of archives) {
        const current = catalog.getArchiveById(archive.id)
        if (!current || current.status !== 'ready')
          throw new Error(
            'The archive selection changed. Review it and try again.'
          )
        getArchiveRecoveryIdentity(pool.getDatabase(current))
      }
      access.grant({
        archiveIds: ids,
        exportDirectories: [folder.filePaths[0]],
        acknowledgeCloudSharing: true
      })
      return accessStatus()
    }
  )
  handle('liferaft:revoke-agent-access', () => {
    access.revoke()
    return accessStatus()
  })

  const broadcastProgress = (event: ImportProgressEvent) => {
    const mainWindow = getMainWindow()
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      mainWindow.webContents.isDestroyed()
    ) {
      return
    }

    mainWindow.webContents.send('liferaft:import-progress', event)
  }

  const rememberCleanupFailure = (archive: ArchiveSummary, error: unknown) => {
    const message =
      error instanceof Error &&
      error.message.includes('importer has not stopped')
        ? error.message
        : 'The local index could not be removed. Close other Liferaft agents and try again. The original archive was not deleted.'
    catalog.upsertArchive({ ...archive, status: 'failed', lastError: message })
    broadcastProgress({
      archiveId: archive.id,
      phase: 'failed',
      bytesProcessed: 0,
      totalBytes: 0,
      messagesProcessed: archive.messageCount,
      attachmentsProcessed: archive.attachmentCount,
      etaSeconds: null,
      currentFile: archive.sourcePath,
      error: message
    })
  }

  const removeArchiveIndex = (archive: ArchiveSummary): Promise<void> => {
    const existing = cleanupJobs.get(archive.id)
    if (existing) return existing
    const job = (async () => {
      const active = activeImports.get(archive.id)
      if (active) {
        active.stopping = true
        await active.lifetime.stop()
      }
      pool.closeArchive(archive.id)
      await removeSqliteArtifacts(archive.dbPath)
      catalog.deleteArchive(archive.id)
      if (activeImports.get(archive.id) === active)
        activeImports.delete(archive.id)
    })().finally(() => cleanupJobs.delete(archive.id))
    cleanupJobs.set(archive.id, job)
    return job
  }

  handle('liferaft:select-mbox-files', async () => {
    const owner =
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows()[0] ??
      undefined

    const options: OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Mailbox archives',
          extensions: ['mbox']
        },
        {
          name: 'All files',
          extensions: ['*']
        }
      ]
    }

    const response = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)

    if (response.canceled) return []
    const paths = response.filePaths.map((filePath) =>
      fs.realpathSync(filePath)
    )
    for (const filePath of paths) selectedPaths.add(filePath)
    return paths
  })

  handle('liferaft:list-archives', () => catalog.listArchives())
  handle('liferaft:get-storage-info', () => catalog.getStorageSummary())

  handle('liferaft:start-import', async (_event, paths: string[]) => {
    if (
      !Array.isArray(paths) ||
      paths.length > 32 ||
      paths.some((entry) => typeof entry !== 'string')
    ) {
      throw new Error('Choose up to 32 archive files using Import .mbox.')
    }
    for (const sourcePath of paths) {
      if (
        !selectedPaths.has(sourcePath) &&
        !catalog.getArchiveBySourcePath(sourcePath)
      ) {
        throw new Error(
          'Choose the archive using Import .mbox before indexing it.'
        )
      }
    }
    const archives: ArchiveSummary[] = []

    for (const sourcePath of paths) {
      const existing = catalog.getArchiveBySourcePath(sourcePath)
      if (existing && activeImports.has(existing.id)) {
        if (activeImports.get(existing.id)?.stopping) {
          throw new Error(
            'The previous import is still stopping. Remove its local index before trying again.'
          )
        }
        archives.push(existing)
        continue
      }

      const archiveId = existing?.id ?? randomUUID()
      const archive: ArchiveSummary = {
        id: archiveId,
        name: path.basename(sourcePath),
        sourcePath,
        dbPath: existing?.dbPath ?? catalog.getArchiveDbPath(archiveId),
        indexSizeBytes: 0,
        importedAt: new Date().toISOString(),
        status: 'indexing',
        messageCount: 0,
        attachmentCount: 0,
        lastIndexedAt: null,
        lastError: null
      }

      pool.closeArchive(archive.id)
      catalog.upsertArchive({
        id: archive.id,
        name: archive.name,
        sourcePath: archive.sourcePath,
        dbPath: archive.dbPath,
        importedAt: archive.importedAt,
        status: archive.status
      })

      const child = utilityProcess.fork(
        path.join(__dirname, 'utility', 'importer.js')
      )
      activeImports.set(archive.id, {
        archive,
        process: child,
        lifetime: observeImportProcess(child),
        stopping: false
      })

      child.on('message', async (message: ImportProgressEvent) => {
        const active = activeImports.get(message.archiveId)
        if (
          message.archiveId !== archive.id ||
          active?.process !== child ||
          active.stopping
        ) {
          return
        }
        if (message.phase !== 'cancelled') broadcastProgress(message)

        if (message.phase === 'completed') {
          catalog.upsertArchive({
            id: active.archive.id,
            name: active.archive.name,
            sourcePath: active.archive.sourcePath,
            dbPath: active.archive.dbPath,
            importedAt: active.archive.importedAt,
            status: 'ready',
            messageCount: message.messagesProcessed,
            attachmentCount: message.attachmentsProcessed,
            lastIndexedAt: new Date().toISOString()
          })
          activeImports.delete(message.archiveId)
        } else if (message.phase === 'failed') {
          catalog.upsertArchive({
            id: active.archive.id,
            name: active.archive.name,
            sourcePath: active.archive.sourcePath,
            dbPath: active.archive.dbPath,
            importedAt: active.archive.importedAt,
            status: 'failed',
            lastError: message.error ?? 'Import failed'
          })
          activeImports.delete(message.archiveId)
          pool.closeArchive(message.archiveId)
        } else if (message.phase === 'cancelled') {
          try {
            await removeArchiveIndex(active.archive)
            broadcastProgress(message)
          } catch (error) {
            rememberCleanupFailure(active.archive, error)
          }
        }
      })

      child.once('exit', () => {
        const active = activeImports.get(archive.id)
        if (active?.process !== child || active.stopping) {
          return
        }

        pool.closeArchive(archive.id)
        catalog.upsertArchive({
          id: archive.id,
          name: archive.name,
          sourcePath: archive.sourcePath,
          dbPath: archive.dbPath,
          importedAt: archive.importedAt,
          status: 'failed',
          lastError: 'Importer exited unexpectedly'
        })
        broadcastProgress({
          archiveId: archive.id,
          phase: 'failed',
          bytesProcessed: 0,
          totalBytes: 0,
          messagesProcessed: 0,
          attachmentsProcessed: 0,
          etaSeconds: null,
          currentFile: archive.sourcePath,
          error: 'Importer exited unexpectedly'
        })
        activeImports.delete(archive.id)
      })

      child.postMessage({
        type: 'start',
        payload: {
          archiveId: archive.id,
          archiveName: archive.name,
          sourcePath: archive.sourcePath,
          dbPath: archive.dbPath
        }
      })

      archives.push(archive)
    }

    return archives
  })

  handle('liferaft:cancel-import', async (_event, archiveId: string) => {
    const active = activeImports.get(archiveId)
    if (!active || active.stopping) {
      return
    }

    active.process.postMessage({
      type: 'cancel'
    })
  })

  handle('liferaft:delete-archive-index', async (_event, archiveId: string) => {
    const archive = catalog.getArchiveById(archiveId)
    if (!archive) {
      return
    }

    try {
      await removeArchiveIndex(archive)
    } catch (error) {
      rememberCleanupFailure(archive, error)
      throw new Error(
        'The local index could not be removed. Close other Liferaft agents and try again.'
      )
    }
  })

  handle('liferaft:search', async (_event, query) => search.search(query))
  handle(
    'liferaft:load-message-preview',
    async (
      _event,
      archiveId: string,
      messageId: number,
      indexRevision: unknown
    ) =>
      preview.loadPreview(archiveId, messageId, {
        expectedIndexRevision: requireIndexRevision(indexRevision)
      })
  )
  handle(
    'liferaft:export-attachment',
    async (
      _event,
      archiveId: string,
      attachmentId: number,
      indexRevision: unknown
    ) =>
      exporter.exportAttachment(
        getWindow(),
        archiveId,
        attachmentId,
        requireIndexRevision(indexRevision)
      )
  )
  handle(
    'liferaft:export-all-attachments',
    async (
      _event,
      archiveId: string,
      messageId: number,
      indexRevision: unknown
    ) =>
      exporter.exportAllAttachments(
        getWindow(),
        archiveId,
        messageId,
        requireIndexRevision(indexRevision)
      )
  )
  handle(
    'liferaft:export-message',
    async (
      _event,
      archiveId: string,
      messageId: number,
      indexRevision: unknown
    ) =>
      exporter.exportMessage(
        getWindow(),
        archiveId,
        messageId,
        requireIndexRevision(indexRevision)
      )
  )
  handle('liferaft:reveal-path', async (_event, targetPath: string) => {
    shell.showItemInFolder(targetPath)
  })

  return async () => {
    disposing = true
    const notifyShutdown = (message: string | null) => {
      const window = getMainWindow()
      if (
        window &&
        !window.isDestroyed() &&
        !window.webContents.isDestroyed()
      ) {
        window.webContents.send('liferaft:shutdown-pending', message)
      }
    }
    try {
      // Let exports remove their own temporary files, and let existing native
      // choosers settle, before their catalogue and database handles are closed.
      if (inflightIpc.size > 0) {
        notifyShutdown(
          'Finishing current work before quitting. Finish or cancel any open file chooser to continue.'
        )
      }
      await Promise.allSettled([...inflightIpc])
      notifyShutdown(null)
      for (const active of [...activeImports.values()]) {
        try {
          await removeArchiveIndex(active.archive)
        } catch (error) {
          rememberCleanupFailure(active.archive, error)
          throw error
        }
      }
      await Promise.all([...cleanupJobs.values()])
    } catch (error) {
      disposing = false
      notifyShutdown(null)
      throw error
    }

    activeImports.clear()
    ipcMain.removeHandler('liferaft:select-mbox-files')
    ipcMain.removeHandler('liferaft:list-archives')
    ipcMain.removeHandler('liferaft:get-storage-info')
    ipcMain.removeHandler('liferaft:start-import')
    ipcMain.removeHandler('liferaft:cancel-import')
    ipcMain.removeHandler('liferaft:delete-archive-index')
    ipcMain.removeHandler('liferaft:search')
    ipcMain.removeHandler('liferaft:load-message-preview')
    ipcMain.removeHandler('liferaft:export-attachment')
    ipcMain.removeHandler('liferaft:export-all-attachments')
    ipcMain.removeHandler('liferaft:export-message')
    ipcMain.removeHandler('liferaft:reveal-path')
    ipcMain.removeHandler('liferaft:agent-access')
    ipcMain.removeHandler('liferaft:enable-agent-access')
    ipcMain.removeHandler('liferaft:revoke-agent-access')
  }
}

function requireIndexRevision(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new Error('This selection is out of date. Search the archive again.')
  }
  return value
}
