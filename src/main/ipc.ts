import fs from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  BrowserWindow as ElectronBrowserWindow,
  OpenDialogOptions,
  UtilityProcess
} from 'electron'
import type { ArchiveSummary, ImportProgressEvent } from '@shared/contracts'
import { ArchiveDatabasePool } from './archive-db'
import { CatalogStore } from './catalog'
import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  utilityProcess
} from './electron-runtime'
import { ExportService } from './exporter'
import { MessagePreviewService } from './message-preview'
import { SearchService } from './search'

interface ActiveImport {
  archive: ArchiveSummary
  process: UtilityProcess
}

async function removeSqliteArtifacts(dbPath: string): Promise<void> {
  await Promise.allSettled([
    rm(dbPath, { force: true }),
    rm(`${dbPath}-wal`, { force: true }),
    rm(`${dbPath}-shm`, { force: true })
  ])
}

export function registerIpc(
  mainWindow: ElectronBrowserWindow,
  catalog: CatalogStore,
  pool: ArchiveDatabasePool
): () => void {
  const search = new SearchService(catalog, pool)
  const preview = new MessagePreviewService(catalog, pool)
  const exporter = new ExportService(catalog, pool)
  const activeImports = new Map<string, ActiveImport>()

  const broadcastProgress = (event: ImportProgressEvent) => {
    mainWindow.webContents.send('liferaft:import-progress', event)
  }

  ipcMain.handle('liferaft:select-mbox-files', async () => {
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

    return response.canceled ? [] : response.filePaths
  })

  ipcMain.handle('liferaft:list-archives', () => catalog.listArchives())
  ipcMain.handle('liferaft:get-storage-info', () => catalog.getStorageSummary())

  ipcMain.handle('liferaft:start-import', async (_event, paths: string[]) => {
    const archives: ArchiveSummary[] = []

    for (const sourcePath of paths) {
      const existing = catalog.getArchiveBySourcePath(sourcePath)
      if (existing && activeImports.has(existing.id)) {
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
        process: child
      })

      child.on('message', async (message: ImportProgressEvent) => {
        broadcastProgress(message)
        const active = activeImports.get(message.archiveId)
        if (!active) {
          return
        }

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
          activeImports.delete(message.archiveId)
          pool.closeArchive(message.archiveId)
          catalog.deleteArchive(message.archiveId)
          await removeSqliteArtifacts(active.archive.dbPath)
        }
      })

      child.once('exit', (code) => {
        const active = activeImports.get(archive.id)
        if (!active) {
          return
        }

        if (code === 0) {
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

  ipcMain.handle(
    'liferaft:cancel-import',
    async (_event, archiveId: string) => {
      const active = activeImports.get(archiveId)
      if (!active) {
        return
      }

      active.process.postMessage({
        type: 'cancel'
      })
    }
  )

  ipcMain.handle(
    'liferaft:delete-archive-index',
    async (_event, archiveId: string) => {
      const active = activeImports.get(archiveId)
      if (active) {
        active.process.kill()
        activeImports.delete(archiveId)
      }

      const archive = catalog.getArchiveById(archiveId)
      if (!archive) {
        return
      }

      pool.closeArchive(archiveId)
      catalog.deleteArchive(archiveId)
      await removeSqliteArtifacts(archive.dbPath)
    }
  )

  ipcMain.handle('liferaft:search', async (_event, query) =>
    search.search(query)
  )
  ipcMain.handle(
    'liferaft:load-message-preview',
    async (_event, archiveId: string, messageId: number) =>
      preview.loadPreview(archiveId, messageId)
  )
  ipcMain.handle(
    'liferaft:export-attachment',
    async (_event, archiveId: string, attachmentId: number) =>
      exporter.exportAttachment(mainWindow, archiveId, attachmentId)
  )
  ipcMain.handle(
    'liferaft:export-all-attachments',
    async (_event, archiveId: string, messageId: number) =>
      exporter.exportAllAttachments(mainWindow, archiveId, messageId)
  )
  ipcMain.handle(
    'liferaft:export-message',
    async (_event, archiveId: string, messageId: number) =>
      exporter.exportMessage(mainWindow, archiveId, messageId)
  )
  ipcMain.handle('liferaft:reveal-path', async (_event, targetPath: string) => {
    shell.showItemInFolder(targetPath)
  })

  return () => {
    for (const active of activeImports.values()) {
      active.process.kill()
      pool.closeArchive(active.archive.id)
      catalog.deleteArchive(active.archive.id)
      if (fs.existsSync(active.archive.dbPath)) {
        void removeSqliteArtifacts(active.archive.dbPath)
      }
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
  }
}
