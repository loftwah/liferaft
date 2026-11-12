import { randomUUID } from 'node:crypto'
import { MailParser } from 'mailparser'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import {
  isAttachmentPart,
  getAttachmentFilename,
  getMultipartBoundary,
  parseHeaderBlock
} from '@shared/mime'
import {
  ARCHIVE_SCHEMA,
  type IndexedAttachmentRecord,
  type IndexedMessageRecord
} from '@shared/schema'
import { isMboxSeparatorLine, unescapeMboxRdLine } from '@shared/mbox'
import Database from '@shared/sqlite-runtime'
import { captureSourceSnapshot, withSourceRange } from '@shared/recovery-files'

export const MAX_INDEXED_MESSAGE_BYTES = 64 * 1024 * 1024

export interface ImporterProgress {
  bytesProcessed: number
  totalBytes: number
  messagesProcessed: number
  attachmentsProcessed: number
  etaSeconds: number | null
}

export interface ImportJob {
  archiveId: string
  archiveName: string
  sourcePath: string
  dbPath: string
}

interface FinalizedMessage {
  buffer: Buffer
  startOffset: number
  endOffset: number
}

interface ParsedMessage {
  message: IndexedMessageRecord
  attachments: IndexedAttachmentRecord[]
}

interface LineSegment {
  line: Buffer
  offset: number
}

interface PendingAttachment {
  filename: string | null
  contentType: string | null
  contentTransferEncoding: string | null
  offsetStart: number
  bodyOffsetStart: number
  bodyOffsetEnd: number
}

export async function importMboxFile(
  job: ImportJob,
  onProgress: (progress: ImporterProgress) => void,
  isCancelled: () => boolean
): Promise<{ messageCount: number; attachmentCount: number }> {
  const sourceSnapshot = await captureSourceSnapshot(job.sourcePath)
  const db = new Database(job.dbPath)
  try {
    db.exec(ARCHIVE_SCHEMA)
    db.exec(
      'DELETE FROM archive_metadata; DELETE FROM attachments; DELETE FROM messages; DELETE FROM fts_messages; VACUUM;'
    )

    const insertMessage = db.prepare(
      `INSERT INTO messages (
      archive_id,
      subject,
      from_text,
      to_text,
      cc_text,
      date,
      has_attachments,
      mbox_offset_start,
      mbox_offset_end,
      snippet
    ) VALUES (
      @archiveId,
      @subject,
      @fromText,
      @toText,
      @ccText,
      @date,
      @hasAttachments,
      @mboxOffsetStart,
      @mboxOffsetEnd,
      @snippet
    )`
    )
    const insertAttachment = db.prepare(
      `INSERT INTO attachments (
      message_id,
      filename,
      content_type,
      content_transfer_encoding,
      size_estimate,
      offset_start,
      offset_end,
      body_offset_start,
      body_offset_end
    ) VALUES (
      @messageId,
      @filename,
      @contentType,
      @contentTransferEncoding,
      @sizeEstimate,
      @offsetStart,
      @offsetEnd,
      @bodyOffsetStart,
      @bodyOffsetEnd
    )`
    )
    const insertFts = db.prepare(
      `INSERT INTO fts_messages (message_id, subject, attachment_names, sender, recipients, body)
     VALUES (@messageId, @subject, @attachmentNames, @sender, @recipients, @body)`
    )

    const persistMessage = db.transaction((parsed: ParsedMessage) => {
      const messageResult = insertMessage.run({
        archiveId: job.archiveId,
        subject: parsed.message.subject,
        fromText: parsed.message.fromText,
        toText: parsed.message.toText,
        ccText: parsed.message.ccText,
        date: parsed.message.date,
        hasAttachments: parsed.attachments.length > 0 ? 1 : 0,
        mboxOffsetStart: parsed.message.mboxOffsetStart,
        mboxOffsetEnd: parsed.message.mboxOffsetEnd,
        snippet: parsed.message.snippet
      })

      const messageId = Number(messageResult.lastInsertRowid)
      for (const attachment of parsed.attachments) {
        insertAttachment.run({
          messageId,
          filename: attachment.filename,
          contentType: attachment.contentType,
          contentTransferEncoding: attachment.contentTransferEncoding,
          sizeEstimate: attachment.sizeEstimate,
          offsetStart: attachment.offsetStart,
          offsetEnd: attachment.offsetEnd,
          bodyOffsetStart: attachment.bodyOffsetStart,
          bodyOffsetEnd: attachment.bodyOffsetEnd
        })
      }

      insertFts.run({
        messageId,
        subject: parsed.message.subject,
        attachmentNames: parsed.attachments
          .map((attachment) => attachment.filename ?? '')
          .join(' '),
        sender: parsed.message.fromText,
        recipients: [parsed.message.toText, parsed.message.ccText]
          .filter(Boolean)
          .join(' '),
        body: parsed.message.bodyText
      })
    })

    const totalBytes = sourceSnapshot.size
    let bytesProcessed = 0
    let messagesProcessed = 0
    let attachmentsProcessed = 0
    let lastProgressAt = Date.now()
    const startedAt = Date.now()

    const emitProgress = (force = false) => {
      if (!force && Date.now() - lastProgressAt < 150) {
        return
      }

      lastProgressAt = Date.now()
      const elapsed = Math.max(1, Date.now() - startedAt) / 1000
      const bytesPerSecond = bytesProcessed / elapsed
      const etaSeconds =
        bytesPerSecond > 0
          ? Math.max(
              0,
              Math.round((totalBytes - bytesProcessed) / bytesPerSecond)
            )
          : null

      onProgress({
        bytesProcessed,
        totalBytes,
        messagesProcessed,
        attachmentsProcessed,
        etaSeconds
      })
    }

    await withSourceRange(
      job.sourcePath,
      0,
      totalBytes,
      async (source) =>
        streamMbox(
          source,
          async (message) => {
            if (isCancelled()) throw new Error('Import cancelled')
            let parsed: ParsedMessage
            try {
              parsed = await parseMessage(job.archiveId, message)
            } catch {
              throw new Error(
                `Could not read message ${messagesProcessed + 1}. Reimport after checking the archive.`
              )
            }
            persistMessage(parsed)
            messagesProcessed += 1
            attachmentsProcessed += parsed.attachments.length
            emitProgress()
          },
          (processedBytes) => {
            if (isCancelled()) throw new Error('Import cancelled')
            bytesProcessed = processedBytes
            emitProgress()
          }
        ),
      { expectedSource: sourceSnapshot }
    )

    if (isCancelled()) throw new Error('Import cancelled')
    db.transaction(() => {
      const write = db.prepare(
        'INSERT INTO archive_metadata (key, value) VALUES (?, ?)'
      )
      write.run('source_snapshot', JSON.stringify(sourceSnapshot))
      write.run('index_revision', randomUUID())
    })()
    emitProgress(true)
    return {
      messageCount: messagesProcessed,
      attachmentCount: attachmentsProcessed
    }
  } finally {
    db.close()
  }
}

async function streamMbox(
  stream: Readable,
  onMessage: (message: FinalizedMessage) => Promise<void>,
  onBytes: (bytesProcessed: number) => void
): Promise<void> {
  let buffered = Buffer.alloc(0)
  let bytesProcessed = 0
  let currentBuffers: Buffer[] = []
  let currentBytes = 0
  const append = (line: Buffer) => {
    currentBytes += line.length
    if (currentBytes > MAX_INDEXED_MESSAGE_BYTES) {
      throw new Error(
        'A message exceeds the 64 MiB indexing limit. Split or remove that message from a separate copy of the archive.'
      )
    }
    currentBuffers.push(Buffer.from(line))
  }
  let currentStartOffset = 0
  let currentOpen = false
  let dataStartOffset = 0

  for await (const rawChunk of stream) {
    const chunk = rawChunk as Buffer
    const data = buffered.length > 0 ? Buffer.concat([buffered, chunk]) : chunk
    dataStartOffset = bytesProcessed - buffered.length
    bytesProcessed += chunk.length

    let lineStart = 0
    for (let index = 0; index < data.length; index += 1) {
      if (data[index] !== 0x0a) {
        continue
      }

      const line = data.subarray(lineStart, index + 1)
      const lineOffset = dataStartOffset + lineStart

      if (isMboxSeparatorLine(line)) {
        if (currentOpen) {
          await onMessage({
            buffer: Buffer.concat(currentBuffers),
            startOffset: currentStartOffset,
            endOffset: lineOffset
          })
        }

        currentOpen = true
        currentBuffers = []
        currentBytes = 0
        currentStartOffset = lineOffset + line.length
      } else {
        if (!currentOpen) {
          currentOpen = true
          currentStartOffset = lineOffset
        }

        append(line)
      }

      lineStart = index + 1
    }

    buffered = Buffer.from(data.subarray(lineStart))
    if (currentBytes + buffered.length > MAX_INDEXED_MESSAGE_BYTES) {
      throw new Error(
        'A message exceeds the 64 MiB indexing limit. Use a separate, smaller archive copy.'
      )
    }
    onBytes(bytesProcessed)
  }

  if (buffered.length > 0) {
    if (!currentOpen) {
      currentOpen = true
      currentStartOffset = dataStartOffset
    }

    append(buffered)
  }

  if (currentOpen && currentBuffers.length > 0) {
    await onMessage({
      buffer: Buffer.concat(currentBuffers),
      startOffset: currentStartOffset,
      endOffset: bytesProcessed
    })
  }
}

async function parseMessage(
  _archiveId: string,
  finalized: FinalizedMessage
): Promise<ParsedMessage> {
  const normalized = normalizeMessage(finalized.buffer)
  const attachments = extractAttachmentParts(
    finalized.buffer,
    finalized.startOffset
  )
  const parser = new MailParser({
    streamAttachments: true,
    skipHtmlToText: true
  })

  let subject = ''
  let fromText = ''
  let toText = ''
  let ccText = ''
  let date: string | null = null
  let text = ''

  parser.on('headers', (headers) => {
    subject = stringifyHeader(headers.get('subject'))
    fromText = stringifyAddressField(headers.get('from'))
    toText = stringifyAddressField(headers.get('to'))
    ccText = stringifyAddressField(headers.get('cc'))
    const headerDate = headers.get('date')
    date = headerDate instanceof Date ? headerDate.toISOString() : null
  })

  parser.on('data', (data) => {
    if (data.type === 'text') {
      text = data.text ?? ''
    } else if (data.type === 'attachment') {
      data.content.resume()
      data.release()
    }
  })

  await pipeline(Readable.from([normalized]), parser)

  if (!subject || !fromText || !toText || !date) {
    const fallback = fallbackParseHeaders(normalized)
    subject ||= fallback.subject
    fromText ||= fallback.fromText
    toText ||= fallback.toText
    ccText ||= fallback.ccText
    date ||= fallback.date
    text ||= fallback.bodyText
  }

  const cleanText = compactWhitespace(text)
  return {
    message: {
      subject,
      fromText,
      toText,
      ccText,
      date,
      snippet: cleanText.slice(0, 240),
      bodyText: cleanText,
      mboxOffsetStart: finalized.startOffset,
      mboxOffsetEnd: finalized.endOffset
    },
    attachments
  }
}

export function normalizeMessage(buffer: Buffer): Buffer {
  const lines = splitLines(buffer)
  return Buffer.concat(lines.map(({ line }) => unescapeMboxRdLine(line)))
}

export function extractAttachmentParts(
  buffer: Buffer,
  messageStartOffset: number
): IndexedAttachmentRecord[] {
  const lines = splitLines(buffer)
  let index = 0
  const rootHeaderLines: string[] = []

  while (index < lines.length) {
    const text = lineToText(lines[index].line)
    index += 1
    if (text === '') {
      break
    }

    rootHeaderLines.push(text)
  }

  const rootHeaders = parseHeaderBlock(rootHeaderLines)
  const rootBodyStart =
    index < lines.length
      ? messageStartOffset +
        lines[index - 1].offset +
        lines[index - 1].line.length
      : messageStartOffset + buffer.length
  const rootBoundary = getMultipartBoundary(rootHeaders.contentType)

  if (!rootBoundary) {
    if (!isAttachmentPart(rootHeaders)) {
      return []
    }

    return [
      {
        filename: getAttachmentFilename(rootHeaders),
        contentType: rootHeaders.contentType,
        contentTransferEncoding: rootHeaders.contentTransferEncoding,
        sizeEstimate: Math.max(
          0,
          messageStartOffset + buffer.length - rootBodyStart
        ),
        offsetStart: messageStartOffset,
        offsetEnd: messageStartOffset + buffer.length,
        bodyOffsetStart: rootBodyStart,
        bodyOffsetEnd: messageStartOffset + buffer.length
      }
    ]
  }

  const attachments: IndexedAttachmentRecord[] = []
  const boundaries: string[] = [rootBoundary]
  let parsingHeaders = false
  let currentPartHeaderLines: string[] = []
  let currentPartStart = rootBodyStart
  let pendingAttachment: PendingAttachment | null = null

  for (; index < lines.length; index += 1) {
    const segment = lines[index]
    const text = lineToText(segment.line)
    const boundaryMatch = matchBoundary(text, boundaries)

    if (boundaryMatch) {
      if (pendingAttachment) {
        attachments.push({
          filename: pendingAttachment.filename,
          contentType: pendingAttachment.contentType,
          contentTransferEncoding: pendingAttachment.contentTransferEncoding,
          sizeEstimate: Math.max(
            0,
            pendingAttachment.bodyOffsetEnd - pendingAttachment.bodyOffsetStart
          ),
          offsetStart: pendingAttachment.offsetStart,
          offsetEnd: messageStartOffset + segment.offset,
          bodyOffsetStart: pendingAttachment.bodyOffsetStart,
          bodyOffsetEnd: pendingAttachment.bodyOffsetEnd
        })
        pendingAttachment = null
      }

      boundaries.length = boundaryMatch.level + (boundaryMatch.closing ? 0 : 1)
      if (!boundaryMatch.closing) {
        boundaries[boundaryMatch.level] =
          boundaries[boundaryMatch.level] ?? boundaryMatch.boundary
        parsingHeaders = true
        currentPartHeaderLines = []
        currentPartStart =
          messageStartOffset + segment.offset + segment.line.length
      }
      continue
    }

    if (parsingHeaders) {
      if (text === '') {
        const headers = parseHeaderBlock(currentPartHeaderLines)
        const childBoundary = getMultipartBoundary(headers.contentType)
        const bodyStart =
          messageStartOffset + segment.offset + segment.line.length
        if (childBoundary) {
          boundaries.push(childBoundary)
          parsingHeaders = false
          continue
        }

        if (isAttachmentPart(headers)) {
          pendingAttachment = {
            filename: getAttachmentFilename(headers),
            contentType: headers.contentType,
            contentTransferEncoding: headers.contentTransferEncoding,
            offsetStart: currentPartStart,
            bodyOffsetStart: bodyStart,
            bodyOffsetEnd: bodyStart
          }
        } else {
          pendingAttachment = null
        }

        parsingHeaders = false
      } else {
        currentPartHeaderLines.push(text)
      }
      continue
    }

    if (pendingAttachment) {
      pendingAttachment.bodyOffsetEnd =
        messageStartOffset + segment.offset + segment.line.length
    }
  }

  if (pendingAttachment) {
    attachments.push({
      filename: pendingAttachment.filename,
      contentType: pendingAttachment.contentType,
      contentTransferEncoding: pendingAttachment.contentTransferEncoding,
      sizeEstimate: Math.max(
        0,
        pendingAttachment.bodyOffsetEnd - pendingAttachment.bodyOffsetStart
      ),
      offsetStart: pendingAttachment.offsetStart,
      offsetEnd: messageStartOffset + buffer.length,
      bodyOffsetStart: pendingAttachment.bodyOffsetStart,
      bodyOffsetEnd: pendingAttachment.bodyOffsetEnd
    })
  }

  return attachments
}

export function splitLines(buffer: Buffer): LineSegment[] {
  const segments: LineSegment[] = []
  let lineStart = 0

  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0x0a) {
      continue
    }

    segments.push({
      line: buffer.subarray(lineStart, index + 1),
      offset: lineStart
    })
    lineStart = index + 1
  }

  if (lineStart < buffer.length) {
    segments.push({
      line: buffer.subarray(lineStart),
      offset: lineStart
    })
  }

  return segments
}

function lineToText(line: Buffer): string {
  return line.toString('utf8').replace(/\r?\n$/, '')
}

function matchBoundary(
  text: string,
  boundaries: string[]
): { level: number; boundary: string; closing: boolean } | null {
  for (let level = boundaries.length - 1; level >= 0; level -= 1) {
    const boundary = boundaries[level]
    if (text === `--${boundary}`) {
      return {
        level,
        boundary,
        closing: false
      }
    }

    if (text === `--${boundary}--`) {
      return {
        level,
        boundary,
        closing: true
      }
    }
  }

  return null
}

function fallbackParseHeaders(buffer: Buffer) {
  const headerText = buffer.toString('utf8')
  const [rawHeaders = '', rawBody = ''] = headerText.split(/\r?\n\r?\n/, 2)
  const lookup = (name: string) => {
    const match = rawHeaders.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))
    return match?.[1]?.trim() ?? ''
  }

  return {
    subject: lookup('Subject'),
    fromText: lookup('From'),
    toText: lookup('To'),
    ccText: lookup('Cc'),
    date: parseDateHeader(lookup('Date')),
    bodyText: compactWhitespace(rawBody)
  }
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function stringifyHeader(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (
    value &&
    typeof value === 'object' &&
    'value' in value &&
    typeof value.value === 'string'
  ) {
    return value.value
  }

  return ''
}

function stringifyAddressField(value: unknown): string {
  if (!value) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (
    typeof value === 'object' &&
    value &&
    'text' in value &&
    typeof value.text === 'string'
  ) {
    return value.text
  }

  return ''
}

function parseDateHeader(value: string): string | null {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}
