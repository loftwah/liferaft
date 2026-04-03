import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { buildSafeFilename } from '../src/shared/filenames'
import { isMboxSeparatorLine, unescapeMboxRdLine } from '../src/shared/mbox'
import { formatSnippetHtml } from '../src/shared/search-snippet'
import {
  buildFtsMatchQuery,
  detectAttachmentSearchIntent,
  localDateEndToIso,
  localDateStartToIso,
  parseSearchInput
} from '../src/shared/search'
import { ARCHIVE_SCHEMA } from '../src/shared/schema'
import {
  extractAttachmentParts,
  normalizeMessage
} from '../src/utility/mbox-stream'

const SAMPLE_MESSAGE = Buffer.from(
  [
    'Subject: Budget docs',
    'From: Alice <alice@example.com>',
    'To: Bob <bob@example.com>',
    'Date: Tue, 01 Apr 2025 10:00:00 +0000',
    'Content-Type: multipart/mixed; boundary="mix"',
    '',
    '--mix',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    'The file is attached.',
    '>From escaped line',
    '--mix',
    'Content-Type: application/pdf; name="invoice.pdf"',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    '',
    'UERG',
    '--mix--',
    ''
  ].join('\r\n'),
  'utf8'
)

describe('mbox helpers', () => {
  test('detects separators and preserves escaped From lines', () => {
    expect(
      isMboxSeparatorLine(
        Buffer.from('From sender@example.com Fri Apr 4 10:00:00 2025\n')
      )
    ).toBe(true)
    expect(isMboxSeparatorLine(Buffer.from('>From escaped line\n'))).toBe(false)
    expect(
      unescapeMboxRdLine(Buffer.from('>From escaped line\n')).toString('utf8')
    ).toBe('From escaped line\n')
    expect(
      unescapeMboxRdLine(Buffer.from('>>From quoted line\n')).toString('utf8')
    ).toBe('>From quoted line\n')
  })

  test('normalizes MBOX-RD content before preview parsing', () => {
    const normalized = normalizeMessage(
      Buffer.from('Header: value\r\n\r\n>From kept\r\n', 'utf8')
    )
    expect(normalized.toString('utf8')).toContain('\r\n\r\nFrom kept\r\n')
  })

  test('extracts attachment offsets from MIME parts', () => {
    const attachments = extractAttachmentParts(SAMPLE_MESSAGE, 100)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]?.filename).toBe('invoice.pdf')
    expect(attachments[0]?.contentTransferEncoding?.toLowerCase()).toBe(
      'base64'
    )

    const start = attachments[0]!.bodyOffsetStart - 100
    const end = attachments[0]!.bodyOffsetEnd - 100
    expect(SAMPLE_MESSAGE.subarray(start, end).toString('utf8')).toContain(
      'UERG'
    )
  })

  test('handles malformed multipart boundaries without throwing', () => {
    const malformed = Buffer.from(
      'Subject: broken\r\nContent-Type: multipart/mixed; boundary="oops"\r\n\r\n--oops\r\nContent-Type: text/plain\r\n\r\nhello',
      'utf8'
    )

    expect(() => extractAttachmentParts(malformed, 0)).not.toThrow()
  })
})

describe('database and export safety', () => {
  test('creates FTS-backed archive tables and ranks matches', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liferaft-test-'))
    const dbPath = path.join(tempDir, 'archive.sqlite')
    const db = new Database(dbPath)
    db.exec(ARCHIVE_SCHEMA)

    db.prepare(
      `INSERT INTO messages (
        id, archive_id, subject, from_text, to_text, cc_text, date, has_attachments, mbox_offset_start, mbox_offset_end, snippet
      ) VALUES (
        1, 'archive-1', 'Invoice attached', 'Alice', 'Bob', '', '2025-04-01T10:00:00.000Z', 1, 0, 100, 'invoice inside'
      )`
    ).run()
    db.prepare(
      `INSERT INTO fts_messages (message_id, subject, attachment_names, sender, recipients, body)
       VALUES (1, 'Invoice attached', 'invoice.pdf', 'Alice', 'Bob', 'Please see the attached invoice')`
    ).run()

    const row = db
      .prepare(
        `SELECT bm25(fts_messages, 12.0, 8.0, 4.0, 4.0, 1.0) AS rank
         FROM fts_messages
         WHERE fts_messages MATCH ?`
      )
      .get('invoice') as { rank: number } | undefined

    expect(row).toBeDefined()
    expect(row!.rank).toBeLessThan(0)
    db.close()
  })

  test('sanitizes filenames for export', () => {
    expect(
      buildSafeFilename('../../secret?.pdf', 'attachment', 'application/pdf')
    ).toBe('....secret.pdf')
    expect(buildSafeFilename('', 'attachment', 'application/pdf')).toBe(
      'attachment.pdf'
    )
  })

  test('builds safe FTS queries from punctuation-heavy input', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liferaft-search-'))
    const dbPath = path.join(tempDir, 'archive.sqlite')
    const db = new Database(dbPath)
    db.exec(ARCHIVE_SCHEMA)

    db.prepare(
      `INSERT INTO messages (
        id, archive_id, subject, from_text, to_text, cc_text, date, has_attachments, mbox_offset_start, mbox_offset_end, snippet
      ) VALUES (
        1, 'archive-1', 'Invoice final', 'Alice <alice@example.com>', 'Bob', '', '2025-04-01T10:00:00.000Z', 1, 0, 100, 'invoice final pdf'
      )`
    ).run()
    db.prepare(
      `INSERT INTO fts_messages (message_id, subject, attachment_names, sender, recipients, body)
       VALUES (1, 'Invoice final', 'invoice-final.pdf', 'Alice alice@example.com', 'Bob', 'Attached final invoice PDF')`
    ).run()

    const query = buildFtsMatchQuery('invoice (final).pdf alice@example.com')
    const row = db
      .prepare(
        `SELECT message_id
         FROM fts_messages
         WHERE fts_messages MATCH ?`
      )
      .get(query) as { message_id: number } | undefined

    expect(query).toBe(
      '"invoice" AND "final" AND "pdf" AND "alice@example.com"'
    )
    expect(row?.message_id).toBe(1)
    db.close()
  })

  test('converts local date filters into inclusive ISO bounds', () => {
    const start = localDateStartToIso('2025-04-01')
    const end = localDateEndToIso('2025-04-01')

    expect(start).toBeDefined()
    expect(end).toBeDefined()
    expect(start!).toMatch(/T/)
    expect(end!).toMatch(/T/)
    expect(new Date(end!).getTime()).toBeGreaterThan(new Date(start!).getTime())
  })

  test('parses Gmail-style search operators into filters', () => {
    const parsed = parseSearchInput(
      'from:alice@example.com has:attachment after:2025-04-01 before:2025-04-10 filetype:pdf budget'
    )

    expect(parsed.text).toBe('pdf budget')
    expect(parsed.filters.sender).toBe('alice@example.com')
    expect(parsed.filters.hasAttachments).toBe(true)
    expect(parsed.filters.dateFrom).toBe('2025-04-01')
    expect(parsed.filters.dateTo).toBe('2025-04-09')
    expect(parsed.preferAttachments).toBe(true)
  })

  test('detects attachment hunting intent from filename-style queries', () => {
    expect(detectAttachmentSearchIntent('passport scan pdf')).toBe(true)
    expect(detectAttachmentSearchIntent('filename:invoice-final.pdf')).toBe(
      true
    )
    expect(detectAttachmentSearchIntent('meeting notes from alice')).toBe(false)
  })

  test('escapes search snippets while preserving highlight tags', () => {
    expect(
      formatSnippetHtml('<img src=x onerror=alert(1)><mark>invoice</mark>')
    ).toBe('&lt;img src=x onerror=alert(1)&gt;<mark>invoice</mark>')
  })
})
