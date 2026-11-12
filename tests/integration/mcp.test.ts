import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { CatalogStore } from '../../src/main/catalog'
import { ArchiveDatabasePool } from '../../src/main/archive-db'
import { importMboxFile } from '../../src/utility/mbox-stream'
import { AgentAccessStore } from '../../src/mcp/access'
import { fictionalInvoiceMbox, fictionalInvoicePdf } from '../fixtures/invoice'

const serverPath = fileURLToPath(
  new URL('./fixtures/mcp-server.ts', import.meta.url)
)
const invoice = fictionalInvoicePdf()

async function prepareFixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'liferaft-mcp-native-')
  )
  const dataPath = path.join(directory, 'config', 'liferaft')
  const outputPath = path.join(directory, 'recovery')
  fs.mkdirSync(outputPath)
  const sourcePath = path.join(directory, 'fictional.mbox')
  const original = fictionalInvoiceMbox(true)
  fs.writeFileSync(sourcePath, original)
  const catalog = new CatalogStore({ baseDir: dataPath })
  const dbPath = catalog.getArchiveDbPath('archive-one')
  const summary = await importMboxFile(
    {
      archiveId: 'archive-one',
      archiveName: 'fictional.mbox',
      sourcePath,
      dbPath
    },
    () => {},
    () => false
  )
  catalog.upsertArchive({
    id: 'archive-one',
    name: 'fictional.mbox',
    sourcePath,
    dbPath,
    importedAt: '2026-11-12T00:00:00.000Z',
    lastIndexedAt: '2026-11-12T00:00:00.000Z',
    status: 'ready',
    ...summary
  })
  catalog.close()
  const access = new AgentAccessStore(dataPath)
  const grant = access.grant({
    archiveIds: ['archive-one'],
    exportDirectories: [outputPath],
    acknowledgeCloudSharing: true
  })
  return {
    directory,
    dataPath,
    outputPath,
    sourcePath,
    original,
    access,
    grant
  }
}

interface WireResponse {
  id?: number
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

class WireClient {
  private nextId = 1
  private buffer = ''
  private modern = false
  private readonly waiting = new Map<
    number,
    {
      resolve: (response: WireResponse) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  readonly invalidOutput: string[] = []
  readonly child: ChildProcessWithoutNullStreams

  constructor(dataPath: string, pauseExport = false) {
    const executable = pauseExport
      ? undefined
      : process.env.LIFERAFT_TEST_MCP_EXECUTABLE
    const argumentsOverride: unknown = JSON.parse(
      process.env.LIFERAFT_TEST_MCP_ARGS ?? '["--mcp"]'
    )
    if (
      !Array.isArray(argumentsOverride) ||
      argumentsOverride.some((argument) => typeof argument !== 'string')
    ) {
      throw new Error('LIFERAFT_TEST_MCP_ARGS must be a JSON string array')
    }
    this.child = spawn(
      executable ?? process.execPath,
      executable
        ? argumentsOverride
        : [
            '--import',
            'tsx',
            serverPath,
            dataPath,
            ...(pauseExport ? ['--pause-export'] : [])
          ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, XDG_CONFIG_HOME: path.dirname(dataPath) }
      }
    )
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let newline
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        try {
          const response = JSON.parse(line) as WireResponse
          if (response.id === undefined) continue
          const request = this.waiting.get(response.id)
          if (request) {
            clearTimeout(request.timer)
            this.waiting.delete(response.id)
            request.resolve(response)
          }
        } catch {
          this.invalidOutput.push(line)
        }
      }
    })
    // Consume diagnostics, but never turn paths or mail content into test logs.
    this.child.stderr.resume()
    this.child.on('exit', (code) => {
      for (const request of this.waiting.values()) {
        clearTimeout(request.timer)
        request.reject(
          new Error(`MCP fixture exited before its response (${code})`)
        )
      }
      this.waiting.clear()
    })
  }

  request(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<WireResponse> {
    const id = this.nextId++
    if (this.modern) {
      params = {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'liferaft-fixture',
            version: '1.0.0'
          },
          'io.modelcontextprotocol/clientCapabilities': {}
        }
      }
    }
    const response = new Promise<WireResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error(`MCP fixture did not answer ${method}`))
      }, 10000)
      this.waiting.set(id, { resolve, reject, timer })
    })
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    )
    return response
  }

  async initialise(protocolVersion: string) {
    if (protocolVersion === '2026-07-28') {
      this.modern = true
      const response = await this.request('server/discover')
      assert.equal(response.error, undefined)
      assert.ok(
        (response.result?.supportedVersions as string[]).includes(
          protocolVersion
        )
      )
      return
    }
    this.modern = false
    const response = await this.request('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'liferaft-fixture', version: '1.0.0' }
    })
    assert.equal(response.error, undefined)
    assert.equal(response.result?.protocolVersion, protocolVersion)
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) +
        '\n'
    )
  }

  async call(name: string, args: Record<string, unknown> = {}) {
    const response = await this.request('tools/call', { name, arguments: args })
    assert.equal(response.error, undefined)
    return response.result as {
      isError?: boolean
      structuredContent: Record<string, unknown>
    }
  }

  async close() {
    if (!this.child.pid) return
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    const closed = new Promise<void>((resolve, reject) => {
      let forced = false
      const timer = setTimeout(() => {
        forced = true
        this.child.kill('SIGKILL')
      }, 5000)
      this.child.once('exit', (code) => {
        clearTimeout(timer)
        if (forced)
          reject(
            new Error(
              'MCP fixture did not exit after stdin EOF; its owned process was killed and exit was observed'
            )
          )
        else if (code === 0) resolve()
        else reject(new Error(`MCP fixture exited ${code}`))
      })
    })
    this.child.stdin.end()
    await closed
    assert.deepEqual(this.invalidOutput, [])
  }
}

test('native SQLite and stdio recover Alice’s PDF, reject scope expansion and observe revocation', async () => {
  const f = await prepareFixture()
  const client = new WireClient(f.dataPath)
  try {
    await client.initialise('2025-11-25')
    const tools = await client.request('tools/list')
    assert.equal((tools.result?.tools as unknown[]).length, 5)
    const listed = await client.call('liferaft_list_archives')
    assert.equal((listed.structuredContent.archives as unknown[]).length, 1)
    assert.ok(!JSON.stringify(listed).includes(f.sourcePath))
    const found = await client.call('liferaft_search', {
      query: 'invoice',
      sender: 'alice'
    })
    assert.equal(found.isError, undefined)
    const [match] = found.structuredContent.results as Array<{
      sourceRef: string
    }>
    const read = await client.call('liferaft_read_message', {
      sourceRef: match.sourceRef
    })
    assert.equal(
      read.structuredContent.dataClassification,
      'untrusted_archive_content'
    )
    assert.match(
      read.structuredContent.body as string,
      /deliberately untrusted/
    )
    const [attachment] = read.structuredContent.attachments as Array<{
      sourceRef: string
    }>
    const arbitraryPath = await client.request('tools/call', {
      name: 'liferaft_export_attachment',
      arguments: {
        sourceRef: attachment.sourceRef,
        directoryId: f.grant.exportDirectories[0].id,
        path: '../outside.pdf'
      }
    })
    assert.ok(arbitraryPath.error || arbitraryPath.result?.isError === true)
    assert.deepEqual(fs.readdirSync(f.outputPath), [])
    const denied = await client.call('liferaft_export_attachment', {
      sourceRef: attachment.sourceRef,
      directoryId: '../unapproved'
    })
    assert.equal(denied.isError, true)
    assert.equal(denied.structuredContent.code, 'scope_denied')
    assert.deepEqual(fs.readdirSync(f.outputPath), [])
    const recovered = await client.call('liferaft_export_attachment', {
      sourceRef: attachment.sourceRef,
      directoryId: f.grant.exportDirectories[0].id
    })
    assert.equal(recovered.structuredContent.status, 'exported')
    assert.deepEqual(
      fs.readFileSync(recovered.structuredContent.path as string),
      invoice
    )
    assert.deepEqual(fs.readFileSync(f.sourcePath), f.original)
    f.access.revoke()
    const revoked = await client.call('liferaft_read_message', {
      sourceRef: match.sourceRef
    })
    assert.equal(revoked.isError, true)
    assert.equal(revoked.structuredContent.code, 'access_disabled')
  } finally {
    await client.close()
    fs.rmSync(f.directory, { recursive: true, force: true })
  }
})

test('MCP uses current protocol and read-only native database handles', async () => {
  const f = await prepareFixture()
  const catalog = new CatalogStore({ baseDir: f.dataPath, readonly: true })
  const pool = new ArchiveDatabasePool({ readonly: true })
  const client = new WireClient(f.dataPath)
  try {
    assert.throws(
      () => catalog.deleteArchive('archive-one'),
      /readonly|read.only/i
    )
    const archive = catalog.getArchiveById('archive-one')!
    assert.throws(
      () => pool.getDatabase(archive).prepare('DELETE FROM messages').run(),
      /readonly|read.only/i
    )
    await client.initialise('2026-07-28')
    const found = await client.call('liferaft_search', {
      query: 'doesnotexist'
    })
    assert.deepEqual(found.structuredContent.results, [])
    assert.equal(found.structuredContent.completeness, 'complete')
  } finally {
    pool.closeAll()
    catalog.close()
    await client.close()
    fs.rmSync(f.directory, { recursive: true, force: true })
  }
})

test('stdio closes cleanly when the client disconnects before initialising', async () => {
  const f = await prepareFixture()
  const client = new WireClient(f.dataPath)
  try {
    await client.close()
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true })
  }
})

test('a modern protocol probe can fall back to a legacy connection without closing the catalogue', async () => {
  const f = await prepareFixture()
  const client = new WireClient(f.dataPath)
  try {
    await client.initialise('2026-07-28')
    await client.initialise('2025-11-25')
    const found = await client.call('liferaft_search', { query: 'invoice' })
    assert.equal(found.isError, undefined)
    assert.equal((found.structuredContent.results as unknown[]).length, 1)
  } finally {
    await client.close()
    fs.rmSync(f.directory, { recursive: true, force: true })
  }
})

test('disconnect waits for in-progress export cleanup before the host quits (controlled Node fixture)', async () => {
  const f = await prepareFixture()
  const client = new WireClient(f.dataPath, true)
  try {
    await client.initialise('2025-11-25')
    const found = await client.call('liferaft_search', {
      query: 'invoice',
      hasAttachments: true
    })
    const [match] = found.structuredContent.results as Array<{
      sourceRef: string
    }>
    const exporting = client
      .call('liferaft_export_attachment', {
        sourceRef: match.sourceRef,
        directoryId: f.grant.exportDirectories[0].id
      })
      .catch(() => undefined)
    const deadline = Date.now() + 5000
    while (!fs.existsSync(path.join(f.dataPath, 'export-paused'))) {
      if (Date.now() > deadline)
        throw new Error('Export did not reach the controlled publication point')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.ok(
      fs.readdirSync(f.outputPath).some((name) => name.startsWith('.liferaft-'))
    )
    await client.close()
    await exporting
    assert.deepEqual(fs.readdirSync(f.outputPath), [])
    assert.deepEqual(fs.readFileSync(f.sourcePath), f.original)
  } finally {
    await client.close()
    fs.rmSync(f.directory, { recursive: true, force: true })
  }
})
