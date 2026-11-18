import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from '../../src/shared/sqlite-runtime'
import { importMboxFile } from '../../src/utility/mbox-stream'
import { getArchiveRecoveryIdentity } from '../../src/shared/recovery-files'

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
