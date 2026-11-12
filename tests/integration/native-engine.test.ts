import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { CatalogStore } from '../../src/main/catalog'
import type {
  SearchResultRow,
  MessagePreview
} from '../../src/shared/contracts'
import { fictionalInvoiceMbox, fictionalInvoicePdf } from '../fixtures/invoice'

type Archive = { id: string; status: string; needsReindex: boolean }
type Response<T> = { result?: T; error?: string }

test(
  'native pipe keeps catalogue identities and recovers exact bytes with a passive HTML preview',
  { timeout: 8000 },
  async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'liferaft-native-pipe-')
    )
    const data = path.join(dir, 'catalogue')
    const source = path.join(dir, 'fictional.mbox')
    const invalid = path.join(dir, 'wrong.png')
    const destination = path.join(dir, 'invoice.pdf')
    const html = Buffer.from(
      [
        'From test@example.test Thu Nov 12 00:00:00 2026',
        'Subject: HTML-only order',
        'From: Test <test@example.test>',
        'To: Bob <bob@example.test>',
        'Date: Thu, 12 Nov 2026 00:00:00 +0000',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>Fictional kelp delivery.</p><script>NeverRender</script><img src="https://example.test/pixel">',
        ''
      ].join('\r\n')
    )
    const invoice = fictionalInvoiceMbox()
    const archive = Buffer.concat([invoice, html])
    await fs.writeFile(source, archive)
    await fs.writeFile(invalid, 'A file that is not an archive')
    const legacyId = randomUUID()
    const legacy = new CatalogStore({ baseDir: data })
    legacy.upsertArchive({
      id: legacyId,
      name: 'fictional.mbox',
      sourcePath: source,
      dbPath: legacy.getArchiveDbPath(legacyId),
      importedAt: '2026-11-12T00:00:00.000Z',
      status: 'ready'
    })
    legacy.close()

    const engine = spawn(
      process.execPath,
      ['out/native/engine.mjs', '--desktop', data],
      {
        stdio: ['pipe', 'pipe', 'inherit']
      }
    )
    const exited = once(engine, 'close')
    const lines = createInterface({ input: engine.stdout })[
      Symbol.asyncIterator
    ]()
    let seq = 0
    async function request<T>(
      op: string,
      payload: Record<string, unknown> = {}
    ): Promise<Response<T>> {
      const id = ++seq
      engine.stdin.write(
        JSON.stringify({ id, request: { op, ...payload } }) + '\n'
      )
      const line = await lines.next()
      assert.equal(line.done, false)
      const response = JSON.parse(line.value)
      assert.equal(response.id, id)
      return response
    }
    const search = (text: string) =>
      request<{ rows: (SearchResultRow & { messageFilename: string })[] }>(
        'search',
        {
          text,
          archiveId: legacyId,
          sender: '',
          dateFrom: '',
          dateTo: '',
          hasAttachments: false,
          preferAttachments: false
        }
      )
    const waitForIndex = async () => {
      for (let i = 0; i < 80; i++) {
        const a = (await request<Archive[]>('archives')).result?.[0]
        if (a?.status !== 'indexing') {
          assert.deepEqual(a && [a.id, a.status, a.needsReindex], [
            legacyId,
            'ready',
            false
          ])
          return
        }
        await delay(25)
      }
      assert.fail('The indexer did not finish')
    }

    try {
      const before = (await request<Archive[]>('archives')).result
      assert.equal(before?.[0].needsReindex, true)
      assert.match((await search('kelp')).error ?? '', /reindex/i)
      assert.match(
        (await request('import', { sourcePath: invalid })).error ?? '',
        /MBOX message separator/
      )
      assert.equal(
        (await request('reindex', { archiveId: legacyId })).result,
        null
      )
      await waitForIndex()
      const hit = (await search('from:Test kelp')).result?.rows[0]
      assert.ok(hit)
      assert.equal(hit.subject, 'HTML-only order')
      assert.doesNotMatch(hit.snippet, /<\/?mark>/)
      const ref = {
        archiveId: legacyId,
        messageId: hit.id,
        indexRevision: hit.indexRevision
      }
      const { result } = await request<MessagePreview>('preview', ref)
      assert.match(result?.text ?? '', /Fictional kelp delivery/)
      assert.doesNotMatch(result?.text ?? '', /NeverRender|https:/)
      assert.equal(Object.hasOwn(result ?? {}, 'html'), false)

      const file = (await search('filename:invoice')).result?.rows[0]
      assert.equal(file?.attachmentFilename, 'invoice.pdf')
      assert.equal(file?.messageFilename, 'Invoice from Alice.eml')
      const args = {
        ...ref,
        messageId: file?.id,
        attachmentId: file?.attachmentId,
        destination
      }
      assert.equal(
        (await request<{ path: string }>('recover', args)).result?.path,
        destination
      )
      assert.deepEqual(await fs.readFile(destination), fictionalInvoicePdf())
      assert.match(
        (await request('recover', args)).error ?? '',
        /already exists/
      )
      const original = path.join(dir, 'original.eml')
      assert.equal(
        (
          await request<{ path: string }>('recover', {
            ...args,
            attachmentId: null,
            destination: original
          })
        ).result?.path,
        original
      )
      assert.deepEqual(
        await fs.readFile(original),
        invoice.subarray(invoice.indexOf(10) + 1)
      )
      assert.deepEqual(await fs.readFile(source), archive)
      assert.equal(
        (await request('reindex', { archiveId: legacyId })).result,
        null
      )
      await waitForIndex()
      assert.match((await request('preview', ref)).error ?? '', /out of date/)
      const indexFiles = await fs.readdir(path.join(data, 'archives'))
      assert.equal(
        indexFiles.filter((file) => file.endsWith('.sqlite')).length,
        1
      )
    } finally {
      engine.stdin.end()
      assert.deepEqual(await exited, [0, null])
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
)

test(
  'a restarted recovery engine removes a force-killed child’s owned temporary only',
  { timeout: 8000 },
  async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'liferaft-export-journal-')
    )
    const data = path.join(dir, 'catalogue')
    await fs.mkdir(path.join(dir, 'destination'))
    const destination = await fs.realpath(path.join(dir, 'destination'))
    const temporary = path.join(destination, `.liferaft-${randomUUID()}.tmp`)
    const unrelated = path.join(destination, `.liferaft-${randomUUID()}.tmp`)
    const saved = path.join(destination, 'already-recovered.pdf')
    await fs.writeFile(unrelated, 'Untracked file')
    await fs.writeFile(saved, fictionalInvoicePdf())
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
    import fs from 'node:fs'
    import path from 'node:path'
    import { ExportJournal } from './src/native/export-journal.ts'
    const [data, file] = process.argv.slice(1)
    const journal = new ExportJournal(data)
    journal.track(file, fs.statSync(path.dirname(file)))
    fs.writeFileSync(file, 'Interrupted recovery', { flag: 'wx' })
    console.log('ready')
    setInterval(() => {}, 1000)
  `,
        data,
        temporary
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] }
    )
    const childExit = once(child, 'close')
    try {
      const lines = createInterface({ input: child.stdout })[
        Symbol.asyncIterator
      ]()
      assert.deepEqual(await lines.next(), { value: 'ready', done: false })
      child.kill('SIGKILL')
      assert.deepEqual(await childExit, [null, 'SIGKILL'])
      assert.equal(await fs.readFile(temporary, 'utf8'), 'Interrupted recovery')

      const engine = spawn(
        process.execPath,
        ['out/native/engine.mjs', '--desktop', data],
        {
          stdio: ['pipe', 'pipe', 'inherit']
        }
      )
      const engineExit = once(engine, 'close')
      engine.stdin.end()
      assert.deepEqual(await engineExit, [0, null])
      await assert.rejects(fs.stat(temporary), { code: 'ENOENT' })
      assert.deepEqual(await fs.readFile(saved), fictionalInvoicePdf())
      assert.equal(await fs.readFile(unrelated, 'utf8'), 'Untracked file')
    } finally {
      child.kill('SIGKILL')
      await childExit
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
)
