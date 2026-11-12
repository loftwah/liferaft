import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Database } from 'bun:sqlite'
import type { ArchiveDatabasePool } from '../src/main/archive-db'
import type { CatalogStore } from '../src/main/catalog'
import { ExportService } from '../src/main/exporter'
import { MessagePreviewService } from '../src/main/message-preview'
import {
  captureSourceSnapshot,
  getArchiveRecoveryIdentity,
  writeArchiveRangeAtomically
} from '../src/shared/recovery-files'
import { decoderForTransferEncoding } from '../src/shared/transfer-decoder'
import { ARCHIVE_SCHEMA } from '../src/shared/schema'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
})

function fixture(content = 'original archive contents') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liferaft-recovery-'))
  cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }))
  const sourcePath = path.join(directory, 'archive.mbox')
  fs.writeFileSync(sourcePath, content)
  return {
    directory,
    sourcePath,
    destinationPath: path.join(directory, 'recovered.eml'),
    offsetStart: 0,
    offsetEnd: Buffer.byteLength(content)
  }
}

function expectNoTemporaryFiles(directory: string) {
  expect(
    fs.readdirSync(directory).filter((name) => name.startsWith('.liferaft-'))
  ).toEqual([])
}

describe('atomic recovery writes', () => {
  test('never overwrites the source archive, an existing file, or a symlink target', async () => {
    const input = fixture()
    const original = fs.readFileSync(input.sourcePath)
    await expect(
      writeArchiveRangeAtomically({
        ...input,
        destinationPath: input.sourcePath
      })
    ).rejects.toThrow('already exists')
    fs.writeFileSync(input.destinationPath, 'existing document')
    await expect(writeArchiveRangeAtomically(input)).rejects.toThrow(
      'already exists'
    )
    const link = path.join(input.directory, 'link.eml')
    fs.symlinkSync(input.sourcePath, link)
    await expect(
      writeArchiveRangeAtomically({ ...input, destinationPath: link })
    ).rejects.toThrow('already exists')
    expect(fs.readFileSync(input.sourcePath)).toEqual(original)
    expect(fs.readFileSync(input.destinationPath, 'utf8')).toBe(
      'existing document'
    )
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expectNoTemporaryFiles(input.directory)
  })

  test('two concurrent exports cannot replace each other', async () => {
    const input = fixture()
    const outcomes = await Promise.allSettled([
      writeArchiveRangeAtomically(input),
      writeArchiveRangeAtomically(input)
    ])
    expect(
      outcomes.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    expect(
      outcomes.filter((result) => result.status === 'rejected')
    ).toHaveLength(1)
    expect(fs.readFileSync(input.destinationPath)).toEqual(
      fs.readFileSync(input.sourcePath)
    )
    expectNoTemporaryFiles(input.directory)
  })

  test('missing sources and invalid ranges leave no output', async () => {
    const input = fixture()
    for (const offsets of [
      { offsetStart: -1, offsetEnd: 1 },
      { offsetStart: 2, offsetEnd: 1 },
      { offsetStart: 0, offsetEnd: input.offsetEnd + 1 }
    ]) {
      await expect(
        writeArchiveRangeAtomically({ ...input, ...offsets })
      ).rejects.toThrow('byte range')
      expect(fs.existsSync(input.destinationPath)).toBe(false)
    }
    await expect(
      writeArchiveRangeAtomically({
        ...input,
        sourcePath: path.join(input.directory, 'missing.mbox')
      })
    ).rejects.toThrow()
    expect(fs.existsSync(input.destinationPath)).toBe(false)
    expectNoTemporaryFiles(input.directory)
  })

  test('changed sources are rejected both before and during extraction', async () => {
    const input = fixture()
    const expectedSource = await captureSourceSnapshot(input.sourcePath)
    fs.utimesSync(input.sourcePath, new Date(1_000), new Date(1_000))
    await expect(
      writeArchiveRangeAtomically({ ...input, expectedSource })
    ).rejects.toThrow('archive has changed')
    await expect(
      writeArchiveRangeAtomically({
        ...input,
        transforms: [
          new Transform({
            transform(chunk, _encoding, callback) {
              fs.truncateSync(input.sourcePath, 1)
              callback(null, chunk)
            }
          })
        ]
      })
    ).rejects.toThrow('changed during recovery')
    expect(fs.existsSync(input.destinationPath)).toBe(false)
    expectNoTemporaryFiles(input.directory)
  })

  test('failed decoding, cancellation, and revoked grants discard partial output', async () => {
    const input = fixture('UERG')
    const failure = new Transform({
      transform(_chunk, _encoding, callback) {
        callback(new Error('decoder failure'))
      }
    })
    await expect(
      writeArchiveRangeAtomically({ ...input, transforms: [failure] })
    ).rejects.toThrow('decoder failure')
    const controller = new AbortController()
    await expect(
      writeArchiveRangeAtomically({
        ...input,
        signal: controller.signal,
        validateBeforeCommit: () => controller.abort()
      })
    ).rejects.toThrow()
    await expect(
      writeArchiveRangeAtomically({
        ...input,
        validateBeforeCommit: () => {
          throw new Error('grant revoked')
        }
      })
    ).rejects.toThrow('grant revoked')
    expect(fs.existsSync(input.destinationPath)).toBe(false)
    expectNoTemporaryFiles(input.directory)
  })

  test('zero-length attachments remain empty and extraction respects bounds', async () => {
    const input = fixture()
    await expect(
      writeArchiveRangeAtomically({ ...input, maxBytes: 1 })
    ).rejects.toThrow('size limit')
    await writeArchiveRangeAtomically({
      ...input,
      offsetStart: 5,
      offsetEnd: 5
    })
    expect(fs.statSync(input.destinationPath).size).toBe(0)
    expectNoTemporaryFiles(input.directory)
  })
})

async function decode(encoding: string, chunks: Buffer[]) {
  const output: Buffer[] = []
  await pipeline(
    Readable.from(chunks),
    decoderForTransferEncoding(encoding),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output.push(chunk)
        callback()
      }
    })
  )
  return Buffer.concat(output)
}

describe('attachment transfer decoding', () => {
  test('quoted-printable preserves raw binary bytes and split escape sequences', async () => {
    const encoded = Buffer.concat([
      Buffer.from('=00=FF=\r\nA=3D=\n'),
      Buffer.from([0xc3, 0xa9, 0xff]),
      Buffer.from('=broken=')
    ])
    const expected = Buffer.concat([
      Buffer.from([0, 255, 65, 61, 0xc3, 0xa9, 0xff]),
      Buffer.from('=broken=')
    ])
    expect(
      await decode(
        'quoted-printable',
        Array.from(encoded, (byte) => Buffer.from([byte]))
      )
    ).toEqual(expected)
  })

  test('base64 decodes split blocks and rejects damaged content', async () => {
    expect(
      (
        await decode('base64', [Buffer.from('U'), Buffer.from('ER\r\nG')])
      ).toString()
    ).toBe('PDF')
    expect(
      (
        await decode('base64', [
          Buffer.from('aG'),
          Buffer.from('k='),
          Buffer.from('\r\n')
        ])
      ).toString()
    ).toBe('hi')
    for (const encoded of ['!', 'A', 'UE==AAAA', 'U=RG', 'UE=']) {
      await expect(decode('base64', [Buffer.from(encoded)])).rejects.toThrow(
        'base64'
      )
    }
  })
})

async function services() {
  const content = [
    'Subject: Invoice for Alice',
    'From: Alice <alice@example.test>',
    'To: Bob <bob@example.test>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="invoice"',
    '',
    '--invoice',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'The invoice is attached.',
    '>From the accounts desk',
    '--invoice',
    'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'UERG',
    '--invoice--',
    ''
  ].join('\r\n')
  const input = fixture(content)
  const db = new Database(':memory:')
  cleanup.push(() => db.close())
  db.exec(ARCHIVE_SCHEMA)
  db.exec(
    'CREATE TABLE IF NOT EXISTS archive_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
  )
  const snapshot = await captureSourceSnapshot(input.sourcePath)
  db.prepare('INSERT INTO archive_metadata (key, value) VALUES (?, ?)').run(
    'source_snapshot',
    JSON.stringify(snapshot)
  )
  db.prepare('INSERT INTO archive_metadata (key, value) VALUES (?, ?)').run(
    'index_revision',
    'original-revision'
  )
  db.prepare(
    'INSERT INTO messages (id, archive_id, subject, from_text, to_text, mbox_offset_start, mbox_offset_end) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(1, 'archive', 'Invoice for Alice', 'Alice', 'Bob', 0, input.offsetEnd)
  const attachmentStart = content.indexOf('UERG')
  db.prepare(
    'INSERT INTO attachments (id, message_id, filename, content_type, content_transfer_encoding, offset_start, offset_end, body_offset_start, body_offset_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    1,
    1,
    'invoice.pdf',
    'application/pdf',
    'base64',
    attachmentStart,
    attachmentStart + 4,
    attachmentStart,
    attachmentStart + 4
  )
  const archive = {
    id: 'archive',
    name: 'Fictional invoice archive',
    sourcePath: input.sourcePath,
    dbPath: '',
    status: 'ready'
  }
  const catalog = {
    getArchiveById: (id: string) => (id === archive.id ? archive : undefined)
  } as unknown as CatalogStore
  const pool = { getDatabase: () => db } as unknown as ArchiveDatabasePool
  return {
    ...input,
    db,
    archive,
    snapshot,
    exports: new ExportService(catalog, pool),
    previews: new MessagePreviewService(catalog, pool)
  }
}

describe('recovery services', () => {
  test('recover the selected PDF and .eml while preserving the original', async () => {
    const input = await services()
    const original = fs.readFileSync(input.sourcePath)
    const attachment = path.join(input.directory, 'invoice.pdf')
    expect(
      await input.exports.exportAttachmentTo('archive', 1, attachment)
    ).toEqual({ cancelled: false, path: attachment })
    expect(fs.readFileSync(attachment, 'utf8')).toBe('PDF')
    await input.exports.exportMessageTo('archive', 1, input.destinationPath)
    expect(fs.readFileSync(input.destinationPath, 'utf8')).toContain(
      '\r\nFrom the accounts desk\r\n'
    )
    expect(fs.readFileSync(input.sourcePath)).toEqual(original)
  })

  test('preview gives bounded source text and attachment identity', async () => {
    const input = await services()
    const preview = await input.previews.loadPreview('archive', 1)
    expect(preview.text).toContain('The invoice is attached.')
    expect(preview.text).toContain('From the accounts desk')
    expect(preview.attachments[0]?.filename).toBe('invoice.pdf')
    await expect(
      input.previews.loadPreview('archive', 1, { maxBytes: 10 })
    ).rejects.toThrow('too large')
  })

  test('legacy indexes, reindexed selections, and changed source files cannot recover a different item', async () => {
    const input = await services()
    dbRevision(input.db, 'new-revision')
    await expect(
      input.exports.exportAttachmentTo('archive', 1, input.destinationPath, {
        expectedIndexRevision: 'original-revision'
      })
    ).rejects.toThrow('out of date')
    await expect(
      input.previews.loadPreview('archive', 1, {
        expectedIndexRevision: 'original-revision'
      })
    ).rejects.toThrow('out of date')
    fs.utimesSync(input.sourcePath, new Date(1_000), new Date(1_000))
    await expect(
      input.exports.exportAttachmentTo('archive', 1, input.destinationPath)
    ).rejects.toThrow('archive has changed')
    await expect(input.previews.loadPreview('archive', 1)).rejects.toThrow(
      'archive has changed'
    )
    input.db.exec('DROP TABLE archive_metadata')
    expect(() =>
      getArchiveRecoveryIdentity(
        input.db as unknown as Parameters<typeof getArchiveRecoveryIdentity>[0]
      )
    ).toThrow('Reimport')
    expect(fs.existsSync(input.destinationPath)).toBe(false)
    expectNoTemporaryFiles(input.directory)
  })
})

function dbRevision(db: Database, revision: string) {
  db.prepare('UPDATE archive_metadata SET value = ? WHERE key = ?').run(
    revision,
    'index_revision'
  )
}
