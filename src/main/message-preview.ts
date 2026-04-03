import fs from 'node:fs'
import { once } from 'node:events'
import { MailParser } from 'mailparser'
import type { MessagePreview } from '@shared/contracts'
import { MboxRdUnescapeTransform } from '@shared/mbox'
import { ArchiveDatabasePool } from './archive-db'
import { CatalogStore } from './catalog'

interface MessageRow {
  id: number
  archive_id: string
  subject: string | null
  from_text: string | null
  to_text: string | null
  cc_text: string | null
  date: string | null
  mbox_offset_start: number
  mbox_offset_end: number
}

interface AttachmentRow {
  id: number
  message_id: number
  filename: string | null
  content_type: string | null
  content_transfer_encoding: string | null
  size_estimate: number
}

export class MessagePreviewService {
  constructor(
    private readonly catalog: CatalogStore,
    private readonly pool: ArchiveDatabasePool
  ) {}

  async loadPreview(
    archiveId: string,
    messageId: number
  ): Promise<MessagePreview> {
    const archive = this.catalog.getArchiveById(archiveId)
    if (!archive) {
      throw new Error('Archive not found')
    }

    const db = this.pool.getDatabase(archive)
    const message = db
      .prepare(
        `SELECT id, archive_id, subject, from_text, to_text, cc_text, date, mbox_offset_start, mbox_offset_end
         FROM messages
         WHERE id = ?`
      )
      .get(messageId) as MessageRow | undefined

    if (!message) {
      throw new Error('Message not found')
    }

    const attachments = db
      .prepare(
        `SELECT id, message_id, filename, content_type, content_transfer_encoding, size_estimate
         FROM attachments
         WHERE message_id = ?
         ORDER BY id`
      )
      .all(messageId) as AttachmentRow[]

    const parser = new MailParser({
      streamAttachments: true,
      skipHtmlToText: true
    })

    let html: string | null = null
    let text = ''

    parser.on('data', (data) => {
      if (data.type === 'text') {
        html = data.html ?? null
        text = data.text ?? ''
      } else if (data.type === 'attachment') {
        data.release()
      }
    })

    const stream = fs.createReadStream(archive.sourcePath, {
      start: message.mbox_offset_start,
      end: message.mbox_offset_end - 1
    })

    stream.pipe(new MboxRdUnescapeTransform()).pipe(parser)
    await Promise.race([
      once(parser, 'end'),
      once(parser, 'error').then(([error]) => {
        throw error
      })
    ])

    return {
      id: message.id,
      archiveId: archive.id,
      archiveName: archive.name,
      subject: message.subject ?? '(no subject)',
      fromText: message.from_text ?? '',
      toText: message.to_text ?? '',
      ccText: message.cc_text ?? '',
      date: message.date,
      html,
      text,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        messageId: attachment.message_id,
        filename: attachment.filename,
        contentType: attachment.content_type,
        contentTransferEncoding: attachment.content_transfer_encoding,
        sizeEstimate: attachment.size_estimate
      }))
    }
  }
}
