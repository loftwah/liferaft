import { CatalogStore } from '../../../src/main/catalog'
import { ArchiveDatabasePool } from '../../../src/main/archive-db'
import { AgentAccessStore } from '../../../src/mcp/access'
import { startMcpServer } from '../../../src/mcp/server'
import { ExportService } from '../../../src/main/exporter'
import fs from 'node:fs'
import path from 'node:path'

const dataPath = process.argv[2]
if (!dataPath) throw new Error('Test data path is required')
const pauseExport = process.argv.includes('--pause-export')
if (pauseExport) {
  const recover = ExportService.prototype.exportAttachmentTo
  ExportService.prototype.exportAttachmentTo = async function (
    archive,
    id,
    destination,
    options = {}
  ) {
    return recover.call(this, archive, id, destination, {
      ...options,
      validateBeforeCommit: async () => {
        await options.validateBeforeCommit?.()
        fs.writeFileSync(path.join(dataPath, 'export-paused'), 'ready')
        const signal = options.signal!
        signal.throwIfAborted()
        await new Promise<void>((_resolve, reject) => {
          const abort = () => {
            clearTimeout(timer)
            reject(new Error('Test export cancelled'))
          }
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort)
            reject(new Error('Test export did not receive cancellation'))
          }, 5000)
          signal.addEventListener('abort', abort, { once: true })
        })
      }
    })
  }
}
const catalog = new CatalogStore({ baseDir: dataPath, readonly: true })
const pool = new ArchiveDatabasePool({ readonly: true })
const handle = startMcpServer({
  catalog,
  pool,
  access: new AgentAccessStore(dataPath),
  version: '0.0.0-test',
  onClose: () => {
    catalog.close()
    // Mimic Electron quitting immediately when the integrator receives onClose.
    if (pauseExport) process.exit(0)
  }
})
process.once('SIGTERM', () => {
  void handle.close()
})
process.once('SIGINT', () => {
  void handle.close()
})
