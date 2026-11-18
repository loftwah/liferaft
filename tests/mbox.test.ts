import { describe, expect, test } from 'bun:test'
import { buildSafeFilename } from '../src/shared/filenames'
import { isMboxSeparatorLine, unescapeMboxRdLine } from '../src/shared/mbox'
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

test('sanitizes filenames for export', () => {
  expect(
    buildSafeFilename('../../secret?.pdf', 'attachment', 'application/pdf')
  ).toBe('....secret.pdf')
  expect(buildSafeFilename('', 'attachment', 'application/pdf')).toBe(
    'attachment.pdf'
  )
})
