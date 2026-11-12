import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { importMboxFile } from '../utility/mbox-stream'
import { CatalogStore } from '../main/catalog'
import { ArchiveDatabasePool } from '../main/archive-db'
import { AgentAccessStore } from '../mcp/access'
import { ExportJournal } from './export-journal'
import { startMcpServer } from '../mcp/server'
import { runDesktop, type ImportWorkerMessage } from './desktop'

async function main() {
  if (!isMainThread && parentPort) {
    const port = parentPort
    const { job, cancel } = workerData as {
      job: Parameters<typeof importMboxFile>[0]
      cancel: Int32Array
    }
    try {
      const result = await importMboxFile(
        job,
        (progress) =>
          port.postMessage({ progress } satisfies ImportWorkerMessage),
        () => Atomics.load(cancel, 0) !== 0
      )
      port.postMessage({ result } satisfies ImportWorkerMessage)
    } catch (error) {
      port.postMessage({
        error: error instanceof Error ? error.message : 'Indexing failed.'
      } satisfies ImportWorkerMessage)
    }
    return
  }

  const [mode, dataPath] = process.argv.slice(2)
  if (!dataPath || (mode !== '--desktop' && mode !== '--mcp'))
    throw new Error('Open the Liferaft application to start recovery.')
  if (mode === '--desktop') return runDesktop(dataPath)

  console.log = (...args) => console.error(...args)
  const catalog = new CatalogStore({ baseDir: dataPath, readonly: true })
  const pool = new ArchiveDatabasePool({ readonly: true })
  const journal = new ExportJournal(dataPath)
  journal.cleanInterrupted()
  const server = startMcpServer({
    catalog,
    pool,
    trackTemporary: journal.track,
    access: new AgentAccessStore(dataPath),
    version: '0.3.0',
    onClose: () => {
      pool.closeAll()
      catalog.close()
    }
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void server.close())
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Liferaft could not start.'
  )
  process.exitCode = 1
})
