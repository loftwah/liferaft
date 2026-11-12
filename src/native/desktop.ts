import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { z } from 'zod'
import { ArchiveDatabasePool } from '../main/archive-db'
import { CatalogStore } from '../main/catalog'
import { ExportService } from '../main/exporter'
import { MessagePreviewService } from '../main/message-preview'
import { SearchService } from '../main/search'
import { AgentAccessStore } from '../mcp/access'
import { ExportJournal } from './export-journal'
import type { ArchiveSummary, ImportProgressEvent } from '@shared/contracts'
import { getArchiveRecoveryIdentity } from '@shared/recovery-files'
import { parseSearchInput } from '@shared/search'
import { buildSafeFilename } from '@shared/filenames'
import { isMboxSeparatorLine } from '@shared/mbox'

const id = z.string().min(1).max(128)
const revision = z.uuid()
const filePath = z.string().max(4096).refine(path.isAbsolute)
const messageId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const reference = { archiveId: id, indexRevision: revision, messageId }
const request = z.discriminatedUnion('op', [
  z.object({ op: z.literal('archives') }),
  z.object({ op: z.literal('import'), sourcePath: filePath }),
  z.object({ op: z.literal('reindex'), archiveId: id }),
  z.object({ op: z.literal('cancelImport'), archiveId: id }),
  z.object({ op: z.literal('remove'), archiveId: id }),
  z.object({
    op: z.literal('search'),
    text: z.string().max(1024),
    archiveId: id.nullable(),
    sender: z.string().max(256),
    dateFrom: z.string().max(10),
    dateTo: z.string().max(10),
    hasAttachments: z.boolean(),
    preferAttachments: z.boolean()
  }),
  z.object({ op: z.literal('preview'), ...reference }),
  z.object({
    op: z.literal('recover'),
    ...reference,
    attachmentId: messageId.nullable(),
    destination: filePath
  }),
  z.object({
    op: z.literal('recoverAll'),
    ...reference,
    destination: filePath
  }),
  z.object({ op: z.literal('access') }),
  z.object({
    op: z.literal('grant'),
    archiveIds: z.array(id).min(1).max(32),
    destination: filePath,
    acknowledged: z.literal(true)
  }),
  z.object({ op: z.literal('revoke') })
])
const envelope = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  request
})

export type ImportWorkerMessage =
  | {
      progress: Pick<
        ImportProgressEvent,
        | 'bytesProcessed'
        | 'totalBytes'
        | 'messagesProcessed'
        | 'attachmentsProcessed'
        | 'etaSeconds'
      >
    }
  | { result: { messageCount: number; attachmentCount: number } }
  | { error: string }

const MAX_REQUEST = 32 * 1024
const MAX_REPLY = 8 * 1024 * 1024
const display = (text: string, limit = 512) => {
  const prefix = text.slice(0, limit)
  return prefix.replace(/[\uD800-\uDBFF]$/, '')
}
const errorMessage = (error: unknown) =>
  display(
    error instanceof Error
      ? error.message
      : 'Liferaft could not complete this operation.',
    2048
  )

export async function runDesktop(dataPath: string) {
  const catalog = new CatalogStore({ baseDir: dataPath })
  const pool = new ArchiveDatabasePool({ readonly: true })
  const preview = new MessagePreviewService(catalog, pool)
  const search = new SearchService(catalog, pool)
  const journal = new ExportJournal(dataPath)
  journal.cleanInterrupted()
  const exporter = new ExportService(catalog, pool, journal.track)
  const access = new AgentAccessStore(dataPath)
  const controller = new AbortController()
  const imports = new Map<
    string,
    {
      cancel: Int32Array
      done: Promise<void>
      progress?: Extract<ImportWorkerMessage, { progress: unknown }>['progress']
    }
  >()
  const indexes = path.join(dataPath, 'archives')
  const ownedIndex = (file: string) =>
    path.dirname(file) === indexes &&
    /^[0-9a-f-]{36}(?:\.[0-9a-f-]{36})?\.sqlite$/i.test(path.basename(file))

  const removeFiles = (file: string) => {
    if (!ownedIndex(file))
      throw new Error('This index is outside the Liferaft data folder.')
    for (const suffix of ['', '-wal', '-shm'])
      fs.rmSync(file + suffix, { force: true })
  }

  // Legacy rows and grants remain in place. An interrupted build keeps the
  // preceding index path in its row. Only versioned, unreferenced Rune indexes
  // in Liferaft's own archive directory are collected here.
  const references = new Set(catalog.listArchives().map((a) => a.dbPath))
  for (const name of fs.readdirSync(indexes)) {
    const file = path.join(indexes, name.replace(/-(?:wal|shm)$/, ''))
    if (
      name.split('.').length === 3 &&
      ownedIndex(file) &&
      !references.has(file)
    ) {
      removeFiles(file)
    }
  }
  for (const archive of catalog.listArchives()) {
    if (archive.status === 'indexing') {
      catalog.upsertArchive({
        ...archive,
        status: 'failed',
        lastError:
          'Indexing stopped before completion. Reindex this archive to continue.'
      })
    }
  }

  const getArchive = (archiveId: string) => {
    const archive = catalog.getArchiveById(archiveId)
    if (!archive) throw new Error('This archive is no longer in the catalogue.')
    return archive
  }

  function startImport(input: string, existing?: ArchiveSummary) {
    if (imports.size >= 1)
      throw new Error('Wait for the current archive to finish indexing.')
    const sourcePath = fs.realpathSync(input)
    if (!fs.statSync(sourcePath).isFile())
      throw new Error('Choose a regular MBOX archive.')
    const source = fs.openSync(sourcePath, 'r')
    try {
      const prefix = Buffer.alloc(5)
      if (
        fs.readSync(source, prefix, 0, prefix.length, 0) !== prefix.length ||
        !isMboxSeparatorLine(prefix)
      ) {
        throw new Error(
          'This file does not start with an MBOX message separator. Choose an extracted MBOX file.'
        )
      }
    } finally {
      fs.closeSync(source)
    }
    const previous = existing ?? catalog.getArchiveBySourcePath(sourcePath)
    const archiveId = previous?.id ?? randomUUID()
    const pending = path.join(indexes, `${archiveId}.${randomUUID()}.sqlite`)
    if (!ownedIndex(pending))
      throw new Error('The catalogue contains an invalid archive identity.')
    const archive = {
      id: archiveId,
      name: path.basename(sourcePath),
      sourcePath,
      dbPath: previous?.dbPath ?? catalog.getArchiveDbPath(archiveId),
      importedAt: previous?.importedAt ?? new Date().toISOString(),
      status: 'indexing' as const,
      messageCount: previous?.messageCount ?? 0,
      attachmentCount: previous?.attachmentCount ?? 0,
      lastIndexedAt: previous?.lastIndexedAt
    }
    pool.closeArchive(archiveId)
    catalog.upsertArchive(archive)
    const cancel = new Int32Array(new SharedArrayBuffer(4))
    let outcome: Exclude<ImportWorkerMessage, { progress: unknown }> | undefined
    let worker: Worker
    try {
      worker = new Worker(new URL(import.meta.url), {
        workerData: {
          cancel,
          job: {
            archiveId,
            archiveName: archive.name,
            sourcePath,
            dbPath: pending
          }
        }
      })
    } catch (error) {
      catalog.upsertArchive({
        ...archive,
        status: 'failed',
        lastError: errorMessage(error)
      })
      throw error
    }
    const active: typeof imports extends Map<string, infer T> ? T : never = {
      cancel,
      done: new Promise((resolve, reject) => {
        worker.on('message', (message: ImportWorkerMessage) => {
          if ('progress' in message) active.progress = message.progress
          else outcome = message
        })
        worker.on('error', (error) => {
          outcome = { error: errorMessage(error) }
        })
        worker.once('exit', (code) => {
          try {
            if (Atomics.load(cancel, 0)) {
              removeFiles(pending)
              if (previous) catalog.upsertArchive(previous)
              else catalog.deleteArchive(archiveId)
            } else if (code === 0 && outcome && 'result' in outcome) {
              catalog.upsertArchive({
                ...archive,
                ...outcome.result,
                dbPath: pending,
                status: 'ready',
                lastIndexedAt: new Date().toISOString()
              })
              if (previous && ownedIndex(previous.dbPath)) {
                try {
                  removeFiles(previous.dbPath)
                } catch (error) {
                  console.error(
                    'Could not remove the superseded index:',
                    errorMessage(error)
                  )
                }
              }
            } else {
              removeFiles(pending)
              catalog.upsertArchive({
                ...archive,
                status: 'failed',
                lastError:
                  outcome && 'error' in outcome
                    ? outcome.error
                    : 'The indexer stopped unexpectedly. Reindex to try again.'
              })
            }
            resolve()
          } catch (error) {
            reject(error)
          } finally {
            imports.delete(archiveId)
          }
        })
      })
    }
    imports.set(archiveId, active)
    void active.done.catch((error: unknown) => {
      catalog.upsertArchive({
        ...archive,
        status: 'failed',
        lastError: errorMessage(error)
      })
    })
  }

  function accessStatus() {
    try {
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
        error: null
      }
    } catch (error) {
      return {
        enabled: false,
        archiveIds: [],
        exportDirectories: [],
        error: errorMessage(error)
      }
    }
  }

  function needsReindex(archive: ArchiveSummary) {
    if (archive.status !== 'ready') return false
    try {
      getArchiveRecoveryIdentity(pool.getDatabase(archive))
      return false
    } catch {
      return true
    }
  }

  async function dispatch(input: z.infer<typeof request>) {
    switch (input.op) {
      case 'archives': {
        const all = catalog.listArchives()
        return all.map((archive) => {
          const {
            id,
            name,
            status,
            messageCount,
            attachmentCount,
            lastError,
            indexSizeBytes
          } = archive
          return {
            id,
            name: display(name),
            status,
            messageCount,
            attachmentCount,
            lastError,
            indexSizeBytes,
            needsReindex: needsReindex(archive),
            progress: imports.get(id)?.progress
          }
        })
      }
      case 'import':
        startImport(input.sourcePath)
        return null
      case 'reindex': {
        const archive = getArchive(input.archiveId)
        startImport(archive.sourcePath, archive)
        return null
      }
      case 'cancelImport': {
        const active = imports.get(input.archiveId)
        if (active) Atomics.store(active.cancel, 0, 1)
        return null
      }
      case 'remove': {
        const archive = getArchive(input.archiveId)
        if (imports.has(archive.id))
          throw new Error('Cancel indexing before removing this index.')
        pool.closeArchive(archive.id)
        removeFiles(archive.dbPath)
        catalog.deleteArchive(archive.id)
        return null
      }
      case 'search': {
        const candidates = input.archiveId
          ? [getArchive(input.archiveId)]
          : catalog.listArchives()
        const indexed = candidates.filter(
          (archive) => archive.status === 'ready'
        )
        const compatible = indexed.filter((archive) => !needsReindex(archive))
        const skipped = indexed.length - compatible.length
        if (skipped && !compatible.length)
          throw new Error('Reindex the selected archives before searching.')
        const parsed = parseSearchInput(input.text)
        const hasAttachments =
          input.hasAttachments || Boolean(parsed.filters.hasAttachments)
        const rows =
          compatible.length === 0
            ? []
            : search.search({
                text: parsed.text,
                limit: 501,
                preferAttachments:
                  input.preferAttachments ||
                  parsed.preferAttachments ||
                  (hasAttachments && parsed.text.trim().length > 0),
                filters: {
                  ...parsed.filters,
                  archiveIds: compatible.map((archive) => archive.id),
                  hasAttachments,
                  sender: [input.sender, parsed.filters.sender]
                    .filter(Boolean)
                    .join(' '),
                  dateFrom: parsed.filters.dateFrom ?? input.dateFrom,
                  dateTo: parsed.filters.dateTo ?? input.dateTo
                }
              })
        return {
          capped: rows.length > 500,
          skipped,
          rows: rows.slice(0, 500).map((row) => ({
            ...row,
            archiveName: display(row.archiveName),
            subject: display(row.subject),
            fromText: display(row.fromText),
            toText: display(row.toText),
            date: row.date && display(row.date, 64),
            snippet: display(row.snippet.replace(/<\/?mark>/g, '')),
            attachmentFilename:
              row.attachmentFilename && display(row.attachmentFilename),
            messageFilename:
              buildSafeFilename(display(row.subject, 50), 'message') + '.eml',
            suggestedFilename: row.attachmentId
              ? buildSafeFilename(
                  row.attachmentFilename ?? null,
                  'attachment',
                  row.attachmentContentType ?? undefined
                )
              : null,
            attachmentContentType:
              row.attachmentContentType &&
              display(row.attachmentContentType, 120)
          }))
        }
      }
      case 'preview': {
        const { hasHtml, ...message } = await preview.loadPreview(
          input.archiveId,
          input.messageId,
          {
            expectedIndexRevision: input.indexRevision,
            maxBytes: 16 * 1024 * 1024,
            attachmentLimit: 100,
            signal: controller.signal
          }
        )
        const text =
          message.text.trim() ||
          (hasHtml
            ? 'This HTML message has no readable text in the preview. Recover the original .eml to inspect it.'
            : '')
        return {
          ...message,
          subject: display(message.subject),
          archiveName: display(message.archiveName),
          fromText: display(message.fromText),
          toText: display(message.toText),
          ccText: display(message.ccText),
          date: message.date && display(message.date, 64),
          text: display(text, 24_000),
          truncated: text.length > 24_000,
          attachments: message.attachments.map((a) => ({
            ...a,
            filename: a.filename && display(a.filename),
            suggestedFilename: buildSafeFilename(
              a.filename,
              'attachment',
              a.contentType ?? undefined
            ),
            contentType: a.contentType && display(a.contentType, 120)
          }))
        }
      }
      case 'recover': {
        const options = {
          expectedIndexRevision: input.indexRevision,
          signal: controller.signal
        }
        return input.attachmentId
          ? exporter.exportAttachmentTo(
              input.archiveId,
              input.attachmentId,
              input.destination,
              options
            )
          : exporter.exportMessageTo(
              input.archiveId,
              input.messageId,
              input.destination,
              options
            )
      }
      case 'recoverAll':
        return exporter.exportAllAttachmentsTo(
          input.archiveId,
          input.messageId,
          input.destination,
          {
            expectedIndexRevision: input.indexRevision,
            signal: controller.signal
          }
        )
      case 'access':
        return accessStatus()
      case 'grant':
        for (const archiveId of input.archiveIds) {
          const archive = getArchive(archiveId)
          if (archive.status !== 'ready')
            throw new Error(
              'Wait for the selected archives to finish indexing.'
            )
          getArchiveRecoveryIdentity(pool.getDatabase(archive))
        }
        access.grant({
          archiveIds: input.archiveIds,
          exportDirectories: [input.destination],
          acknowledgeCloudSharing: input.acknowledged
        })
        return accessStatus()
      case 'revoke':
        access.revoke()
        return accessStatus()
    }
  }

  let queue = Promise.resolve()
  let pending = Buffer.alloc(0)
  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    controller.abort()
    process.stdin.destroy()
    for (const active of imports.values()) Atomics.store(active.cancel, 0, 1)
  }
  const reply = async (frame: unknown) => {
    if (closing) return
    const json = JSON.stringify(frame)
    if (Buffer.byteLength(json) > MAX_REPLY)
      throw new Error(
        'Too many items to display. Narrow the search or archive selection.'
      )
    await new Promise<void>((resolve, reject) =>
      process.stdout.write(json + '\n', (error) =>
        error ? reject(error) : resolve()
      )
    )
  }

  process.stdout.on('error', close)
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, close)

  await new Promise<void>((resolve, reject) => {
    let processing = false
    process.stdin.on('data', (chunk: Buffer) => {
      if (closing) return
      pending = Buffer.concat([pending, chunk])
      const end = pending.indexOf(10)
      if (
        pending.length > MAX_REQUEST + 1 ||
        (end !== -1 && end !== pending.length - 1) ||
        processing
      ) {
        reject(new Error('Invalid or concurrent desktop request.'))
        return
      }
      if (end === -1) return
      try {
        const { id, request } = envelope.parse(
          JSON.parse(pending.subarray(0, end).toString('utf8'))
        )
        pending = Buffer.alloc(0)
        processing = true
        queue = (async () => {
          let response: unknown
          try {
            response = { id, result: await dispatch(request) }
          } catch (error) {
            response = { id, error: errorMessage(error) }
          }
          processing = false
          try {
            await reply(response)
          } catch (error) {
            await reply({ id, error: errorMessage(error) })
          }
        })()
        void queue.catch(reject)
      } catch (error) {
        reject(error)
      }
    })
    process.stdin.once('end', () => {
      close()
      resolve()
    })
    process.stdin.once('close', resolve)
    process.stdin.once('error', reject)
  }).finally(async () => {
    close()
    await queue.catch(() => {})
    await Promise.allSettled([...imports.values()].map(({ done }) => done))
    pool.closeAll()
    catalog.close()
  })
}
