import fs from 'node:fs'
import type { ImportProgressEvent } from '@shared/contracts'
import { importMboxFile } from './mbox-stream'

interface StartMessage {
  type: 'start'
  payload: {
    archiveId: string
    archiveName: string
    sourcePath: string
    dbPath: string
  }
}

let cancelled = false

process.parentPort?.on('message', async (event) => {
  const message = event.data as StartMessage | { type: 'cancel' }

  if (message.type === 'cancel') {
    cancelled = true
    return
  }

  if (message.type !== 'start') {
    return
  }

  const { archiveId, archiveName, sourcePath, dbPath } = message.payload

  try {
    const progress = (
      phase: ImportProgressEvent['phase'],
      event: Partial<ImportProgressEvent>
    ) => {
      process.parentPort?.postMessage({
        archiveId,
        phase,
        bytesProcessed: 0,
        totalBytes: 0,
        messagesProcessed: 0,
        attachmentsProcessed: 0,
        etaSeconds: null,
        currentFile: sourcePath,
        ...event
      } satisfies ImportProgressEvent)
    }

    progress('starting', {
      totalBytes: fs.statSync(sourcePath).size
    })

    const result = await importMboxFile(
      { archiveId, archiveName, sourcePath, dbPath },
      (jobProgress) => {
        progress('indexing', jobProgress)
      },
      () => cancelled
    )

    if (cancelled) {
      progress('cancelled', {})
      process.exit(0)
      return
    }

    progress('completed', {
      bytesProcessed: fs.statSync(sourcePath).size,
      totalBytes: fs.statSync(sourcePath).size,
      messagesProcessed: result.messageCount,
      attachmentsProcessed: result.attachmentCount,
      etaSeconds: 0
    })
    process.exit(0)
  } catch (error) {
    process.parentPort?.postMessage({
      archiveId,
      phase: cancelled ? 'cancelled' : 'failed',
      bytesProcessed: 0,
      totalBytes: 0,
      messagesProcessed: 0,
      attachmentsProcessed: 0,
      etaSeconds: null,
      currentFile: sourcePath,
      error: error instanceof Error ? error.message : 'Import failed'
    } satisfies ImportProgressEvent)
    process.exit(cancelled ? 0 : 1)
  }
})
