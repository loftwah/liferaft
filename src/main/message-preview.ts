import { pipeline } from 'node:stream/promises'
import { MailParser } from 'mailparser'
import type { MessagePreview } from '@shared/contracts'
import { MboxRdUnescapeTransform } from '@shared/mbox'
import {
  getArchiveRecoveryIdentity,
  sameSource,
  withSourceRange,
  type SourceReadOptions
} from '@shared/recovery-files'
import type { ArchiveDatabasePool } from './archive-db'
import type { CatalogStore } from './catalog'

const MAX_PREVIEW_BYTES = 64 * 1024 * 1024

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
    messageId: number,
    options: SourceReadOptions & {
      expectedIndexRevision?: string
      attachmentLimit?: number
    } = {}
  ): Promise<MessagePreview> {
    const archive = this.catalog.getArchiveById(archiveId)
    if (!archive) {
      throw new Error('Archive not found')
    }
    if (archive.status !== 'ready') {
      throw new Error(
        'Wait for this archive to finish indexing before previewing it.'
      )
    }

    const db = this.pool.getDatabase(archive)
    const identity = getArchiveRecoveryIdentity(db)
    if (
      (options.expectedIndexRevision &&
        options.expectedIndexRevision !== identity.indexRevision) ||
      (options.expectedSource &&
        !sameSource(options.expectedSource, identity.sourceSnapshot))
    ) {
      throw new Error(
        'This selection is out of date. Search the archive again before previewing it.'
      )
    }
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
    const maxBytes = Math.min(
      options.maxBytes ?? MAX_PREVIEW_BYTES,
      MAX_PREVIEW_BYTES
    )
    if (message.mbox_offset_end - message.mbox_offset_start > maxBytes) {
      throw new Error(
        'This message is too large to preview safely. Export it as an .eml file instead.'
      )
    }

    const attachmentLimit = options.attachmentLimit ?? -1
    if (
      attachmentLimit !== -1 &&
      (!Number.isInteger(attachmentLimit) ||
        attachmentLimit < 1 ||
        attachmentLimit > 100)
    ) {
      throw new Error('The attachment preview limit is invalid.')
    }
    const attachments = db
      .prepare(
        `SELECT id, message_id, filename, content_type, content_transfer_encoding, size_estimate
         FROM attachments
         WHERE message_id = ?
         ORDER BY id
         LIMIT ?`
      )
      .all(messageId, attachmentLimit) as AttachmentRow[]

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
        data.content.resume()
        data.release()
      }
    })

    await withSourceRange(
      archive.sourcePath,
      message.mbox_offset_start,
      message.mbox_offset_end,
      async (source) => {
        await pipeline(source, new MboxRdUnescapeTransform(), parser, {
          signal: options.signal
        })
      },
      { ...options, expectedSource: identity.sourceSnapshot, maxBytes }
    )
    const current = this.catalog.getArchiveById(archiveId)
    if (
      current?.status !== 'ready' ||
      getArchiveRecoveryIdentity(db).indexRevision !== identity.indexRevision
    ) {
      throw new Error(
        'The archive index changed during preview. Search the archive again.'
      )
    }

    return {
      id: message.id,
      indexRevision: identity.indexRevision,
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
