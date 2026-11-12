import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from '../../src/shared/sqlite-runtime'
import { CatalogStore } from '../../src/main/catalog'
import { ArchiveDatabasePool } from '../../src/main/archive-db'
import { SearchService } from '../../src/main/search'
import { MessagePreviewService } from '../../src/main/message-preview'
import { ExportService } from '../../src/main/exporter'
import { importMboxFile } from '../../src/utility/mbox-stream'
import {
  captureSourceSnapshot,
  getArchiveRecoveryIdentity,
  sameSource
} from '../../src/shared/recovery-files'

function fixture(message: string) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'liferaft-import-check-')
  )
  const sourcePath = path.join(directory, 'fictional.mbox')
  const dbPath = path.join(directory, 'index.sqlite')
  const original = Buffer.from(message)
  fs.writeFileSync(sourcePath, original)
  return {
    directory,
    original,
    job: {
      archiveId: 'fictional',
      archiveName: 'fictional.mbox',
      sourcePath,
      dbPath
    }
  }
}

const mail = [
  'From alice@example.test Thu Nov 12 00:00:00 2026',
  'Subject: A fictional invoice',
  'From: Alice <alice@example.test>',
  'To: Bob <bob@example.test>',
  'Date: Thu, 12 Nov 2026 00:00:00 +0000',
  '',
  'Archive recovery fixture. No private mail.',
  ''
].join('\r\n')

test('import commits source identity and changes the revision on reindex', async () => {
  const f = fixture(mail)
  try {
    const before = await captureSourceSnapshot(f.job.sourcePath)
    const result = await importMboxFile(
      f.job,
      () => {},
      () => false
    )
    assert.deepEqual(result, { messageCount: 1, attachmentCount: 0 })
    let db = new Database(f.job.dbPath)
    const first = getArchiveRecoveryIdentity(db)
    assert.ok(sameSource(first.sourceSnapshot, before))
    db.close()
    await importMboxFile(
      f.job,
      () => {},
      () => false
    )
    db = new Database(f.job.dbPath)
    try {
      assert.notEqual(
        getArchiveRecoveryIdentity(db).indexRevision,
        first.indexRevision
      )
    } finally {
      db.close()
    }
    assert.deepEqual(fs.readFileSync(f.job.sourcePath), f.original)
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true })
  }
})

test('cancelled and changed-source imports never advertise a complete recovery index', async () => {
  for (const mode of ['cancel', 'changed'] as const) {
    const f = fixture(mail)
    try {
      let called = false
      await assert.rejects(
        importMboxFile(
          f.job,
          () => {},
          () => {
            if (mode === 'cancel') return true
            if (!called) {
              called = true
              fs.appendFileSync(f.job.sourcePath, '\r\nChanged while indexing.')
            }
            return false
          }
        ),
        mode === 'cancel' ? /cancelled/ : /changed/
      )
      const db = new Database(f.job.dbPath)
      try {
        assert.throws(() => getArchiveRecoveryIdentity(db), /rebuilt/)
        // The importer closed its connection even on failure.
        db.pragma('wal_checkpoint(TRUNCATE)')
      } finally {
        db.close()
      }
      if (mode === 'cancel')
        assert.deepEqual(fs.readFileSync(f.job.sourcePath), f.original)
    } finally {
      fs.rmSync(f.directory, { recursive: true, force: true })
    }
  }
})

test(
  'a large attachment stream is drained and indexing finishes without duplicating attachment bytes in the index',
  { timeout: 15000 },
  async () => {
    const bytes = Buffer.alloc(1024 * 1024, 0x41)
    const encoded = bytes
      .toString('base64')
      .match(/.{1,76}/g)!
      .join('\r\n')
    const f = fixture(
      [
        'From alice@example.test Thu Nov 12 00:00:00 2026',
        'Subject: Large fictional attachment',
        'Content-Type: multipart/mixed; boundary="large-fixture"',
        '',
        '--large-fixture',
        'Content-Type: text/plain',
        '',
        'The attachment is for testing.',
        '--large-fixture',
        'Content-Type: application/octet-stream; name="fixture.bin"',
        'Content-Disposition: attachment; filename="fixture.bin"',
        'Content-Transfer-Encoding: base64',
        '',
        encoded,
        '--large-fixture--',
        ''
      ].join('\r\n')
    )
    try {
      assert.deepEqual(
        await importMboxFile(
          f.job,
          () => {},
          () => false
        ),
        { messageCount: 1, attachmentCount: 1 }
      )
      assert.ok(fs.statSync(f.job.dbPath).size < 128 * 1024)
      assert.deepEqual(fs.readFileSync(f.job.sourcePath), f.original)
    } finally {
      fs.rmSync(f.directory, { recursive: true, force: true })
    }
  }
)

test('desktop search selections cannot preview or export a different item after reindex', async () => {
  const f = fixture(mail)
  const catalog = new CatalogStore({ baseDir: path.join(f.directory, 'data') })
  const pool = new ArchiveDatabasePool()
  try {
    await importMboxFile(
      f.job,
      () => {},
      () => false
    )
    catalog.upsertArchive({
      id: f.job.archiveId,
      name: f.job.archiveName,
      sourcePath: f.job.sourcePath,
      dbPath: f.job.dbPath,
      importedAt: '2026-11-12T00:00:00.000Z',
      status: 'ready',
      messageCount: 1,
      attachmentCount: 0
    })
    const search = new SearchService(catalog, pool)
    const query = {
      text: 'invoice',
      filters: {
        archiveIds: [],
        hasAttachments: false,
        sender: '',
        dateFrom: '',
        dateTo: ''
      }
    }
    const [first] = search.search(query)
    assert.ok(first?.indexRevision)
    const previews = new MessagePreviewService(catalog, pool)
    const preview = await previews.loadPreview(first.archiveId, first.id, {
      expectedIndexRevision: first.indexRevision
    })
    assert.equal(preview.indexRevision, first.indexRevision)
    pool.closeAll()
    await importMboxFile(
      f.job,
      () => {},
      () => false
    )
    const [current] = search.search(query)
    assert.notEqual(current.indexRevision, first.indexRevision)
    assert.notEqual(current.resultId, first.resultId)
    await assert.rejects(
      previews.loadPreview(first.archiveId, first.id, {
        expectedIndexRevision: first.indexRevision
      }),
      /out of date/
    )
    const destination = path.join(f.directory, 'stale.eml')
    const exports = new ExportService(catalog, pool)
    await assert.rejects(
      exports.exportMessageTo(first.archiveId, first.id, destination, {
        expectedIndexRevision: first.indexRevision
      }),
      /out of date/
    )
    assert.equal(fs.existsSync(destination), false)
    assert.deepEqual(fs.readFileSync(f.job.sourcePath), f.original)
  } finally {
    pool.closeAll()
    catalog.close()
    fs.rmSync(f.directory, { recursive: true, force: true })
  }
})
