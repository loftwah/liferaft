import fs from 'node:fs'
import path from 'node:path'
import { PassThrough, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { BrowserWindow as ElectronBrowserWindow } from 'electron'
import type { ExportResult } from '@shared/contracts'
import { buildSafeFilename } from '@shared/filenames'
import { MboxRdUnescapeTransform } from '@shared/mbox'
import { ArchiveDatabasePool } from './archive-db'
import { CatalogStore } from './catalog'
import { dialog, shell } from './electron-runtime'

interface AttachmentExportRow {
  id: number
  message_id: number
  filename: string | null
  content_type: string | null
  content_transfer_encoding: string | null
  body_offset_start: number
  body_offset_end: number
}

interface MessageExportRow {
  id: number
  subject: string | null
  mbox_offset_start: number
  mbox_offset_end: number
}

export class ExportService {
  constructor(
    private readonly catalog: CatalogStore,
    private readonly pool: ArchiveDatabasePool
  ) {}

  async exportAttachment(
    window: ElectronBrowserWindow,
    archiveId: string,
    attachmentId: number
  ): Promise<ExportResult> {
    const attachment = this.getAttachment(archiveId, attachmentId)
    const defaultPath = buildSafeFilename(
      attachment.filename,
      'attachment',
      attachment.content_type ?? undefined
    )

    const save = await dialog.showSaveDialog(window, {
      defaultPath
    })

    if (save.canceled || !save.filePath) {
      return { cancelled: true }
    }

    await this.writeAttachment(archiveId, attachment, save.filePath)
    return { cancelled: false, path: save.filePath }
  }

  async exportAllAttachments(
    window: ElectronBrowserWindow,
    archiveId: string,
    messageId: number
  ): Promise<ExportResult> {
    const archive = this.mustGetArchive(archiveId)
    const db = this.pool.getDatabase(archive)
    const attachments = db
      .prepare(
        `SELECT id, message_id, filename, content_type, content_transfer_encoding, body_offset_start, body_offset_end
         FROM attachments
         WHERE message_id = ?
         ORDER BY id`
      )
      .all(messageId) as AttachmentExportRow[]

    if (attachments.length === 0) {
      return { cancelled: true }
    }

    const target = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory']
    })

    if (target.canceled || target.filePaths.length === 0) {
      return { cancelled: true }
    }

    const directory = target.filePaths[0]
    const paths: string[] = []
    const usedNames = new Set<string>()

    for (const attachment of attachments) {
      const filePath = uniquePath(
        directory,
        buildSafeFilename(
          attachment.filename,
          'attachment',
          attachment.content_type ?? undefined
        ),
        usedNames
      )
      await this.writeAttachment(archiveId, attachment, filePath)
      paths.push(filePath)
    }

    return { cancelled: false, paths }
  }

  async exportMessage(
    window: ElectronBrowserWindow,
    archiveId: string,
    messageId: number
  ): Promise<ExportResult> {
    const archive = this.mustGetArchive(archiveId)
    const db = this.pool.getDatabase(archive)
    const message = db
      .prepare(
        `SELECT id, subject, mbox_offset_start, mbox_offset_end
         FROM messages
         WHERE id = ?`
      )
      .get(messageId) as MessageExportRow | undefined

    if (!message) {
      throw new Error('Message not found')
    }

    const save = await dialog.showSaveDialog(window, {
      defaultPath:
        buildSafeFilename(message.subject ?? 'message', 'message') + '.eml'
    })

    if (save.canceled || !save.filePath) {
      return { cancelled: true }
    }

    await pipeline(
      fs.createReadStream(archive.sourcePath, {
        start: message.mbox_offset_start,
        end: message.mbox_offset_end - 1
      }),
      new MboxRdUnescapeTransform(),
      fs.createWriteStream(save.filePath)
    )

    return { cancelled: false, path: save.filePath }
  }

  revealPath(targetPath: string): Promise<void> {
    shell.showItemInFolder(targetPath)
    return Promise.resolve()
  }

  private getAttachment(
    archiveId: string,
    attachmentId: number
  ): AttachmentExportRow {
    const archive = this.mustGetArchive(archiveId)
    const db = this.pool.getDatabase(archive)
    const attachment = db
      .prepare(
        `SELECT id, message_id, filename, content_type, content_transfer_encoding, body_offset_start, body_offset_end
         FROM attachments
         WHERE id = ?`
      )
      .get(attachmentId) as AttachmentExportRow | undefined

    if (!attachment) {
      throw new Error('Attachment not found')
    }

    return attachment
  }

  private mustGetArchive(archiveId: string) {
    const archive = this.catalog.getArchiveById(archiveId)
    if (!archive) {
      throw new Error('Archive not found')
    }

    return archive
  }

  private async writeAttachment(
    archiveId: string,
    attachment: AttachmentExportRow,
    filePath: string
  ): Promise<void> {
    const archive = this.mustGetArchive(archiveId)
    await pipeline(
      fs.createReadStream(archive.sourcePath, {
        start: attachment.body_offset_start,
        end: attachment.body_offset_end - 1
      }),
      new MboxRdUnescapeTransform(),
      decoderForTransferEncoding(attachment.content_transfer_encoding),
      fs.createWriteStream(filePath)
    )
  }
}

function uniquePath(
  directory: string,
  filename: string,
  usedNames: Set<string>
): string {
  const extension = path.extname(filename)
  const stem = extension ? filename.slice(0, -extension.length) : filename
  let candidate = filename
  let counter = 1

  while (
    usedNames.has(candidate) ||
    fs.existsSync(path.join(directory, candidate))
  ) {
    candidate = `${stem}-${counter}${extension}`
    counter += 1
  }

  usedNames.add(candidate)
  return path.join(directory, candidate)
}

function decoderForTransferEncoding(encoding: string | null): Transform {
  const normalized = (encoding ?? '').trim().toLowerCase()

  if (normalized === 'base64') {
    return new Base64DecodeTransform()
  }

  if (normalized === 'quoted-printable') {
    return new QuotedPrintableDecodeTransform()
  }

  return new PassThrough()
}

class Base64DecodeTransform extends Transform {
  private carry = ''

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    const sanitized = `${this.carry}${chunk.toString('utf8')}`.replace(
      /\s+/g,
      ''
    )
    const usableLength = sanitized.length - (sanitized.length % 4)

    if (usableLength > 0) {
      this.push(Buffer.from(sanitized.slice(0, usableLength), 'base64'))
    }

    this.carry = sanitized.slice(usableLength)
    callback()
  }

  override _flush(callback: (error?: Error | null) => void): void {
    if (this.carry.length > 0) {
      this.push(Buffer.from(this.carry, 'base64'))
    }

    callback()
  }
}

class QuotedPrintableDecodeTransform extends Transform {
  private chunks: Buffer[] = []

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.chunks.push(chunk)
    callback()
  }

  override _flush(callback: (error?: Error | null) => void): void {
    const source = Buffer.concat(this.chunks).toString('utf8')
    const normalized = source.replace(/=\r?\n/g, '')
    const bytes: number[] = []

    for (let index = 0; index < normalized.length; index += 1) {
      if (
        normalized[index] === '=' &&
        /^[0-9A-Fa-f]{2}$/.test(normalized.slice(index + 1, index + 3))
      ) {
        bytes.push(Number.parseInt(normalized.slice(index + 1, index + 3), 16))
        index += 2
      } else {
        bytes.push(normalized.charCodeAt(index))
      }
    }

    this.push(Buffer.from(bytes))
    callback()
  }
}
