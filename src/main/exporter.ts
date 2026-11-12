import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow as ElectronBrowserWindow } from 'electron'
import type { ExportResult } from '@shared/contracts'
import { buildSafeFilename } from '@shared/filenames'
import { MboxRdUnescapeTransform } from '@shared/mbox'
import {
  getArchiveRecoveryIdentity,
  sameSource,
  writeArchiveRangeAtomically,
  type ArchiveExportOptions
} from '@shared/recovery-files'
import { decoderForTransferEncoding } from '@shared/transfer-decoder'
import type { ArchiveDatabasePool } from './archive-db'
import type { CatalogStore } from './catalog'

export type { ArchiveExportOptions } from '@shared/recovery-files'

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
    attachmentId: number,
    indexRevision: string
  ): Promise<ExportResult> {
    const { identity } = this.getRecoveryArchive(archiveId, {
      expectedIndexRevision: indexRevision
    })
    const attachment = this.getAttachment(archiveId, attachmentId)
    const defaultPath = buildSafeFilename(
      attachment.filename,
      'attachment',
      attachment.content_type ?? undefined
    )

    const { dialog } = await import('./electron-runtime')
    const save = await dialog.showSaveDialog(window, {
      defaultPath
    })

    if (save.canceled || !save.filePath) {
      return { cancelled: true }
    }

    return this.exportAttachmentTo(archiveId, attachmentId, save.filePath, {
      expectedIndexRevision: identity.indexRevision,
      expectedSource: identity.sourceSnapshot
    })
  }

  async exportAllAttachments(
    window: ElectronBrowserWindow,
    archiveId: string,
    messageId: number,
    indexRevision: string
  ): Promise<ExportResult> {
    const { db, identity } = this.getRecoveryArchive(archiveId, {
      expectedIndexRevision: indexRevision
    })
    const attachments = db
      .prepare(
        `SELECT id, message_id, filename, content_type, content_transfer_encoding, body_offset_start, body_offset_end
         FROM attachments
         WHERE message_id = ?
         ORDER BY id`
      )
      .all(messageId) as AttachmentExportRow[]

    if (attachments.length === 0) {
      return { cancelled: false, paths: [] }
    }

    const { dialog } = await import('./electron-runtime')
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
      try {
        await this.exportAttachmentTo(archiveId, attachment.id, filePath, {
          expectedIndexRevision: identity.indexRevision,
          expectedSource: identity.sourceSnapshot
        })
        paths.push(filePath)
      } catch (error) {
        return {
          cancelled: false,
          paths,
          error: `Export stopped after ${paths.length} of ${attachments.length} attachments. ${error instanceof Error ? error.message : 'Please try again.'}`
        }
      }
    }

    return { cancelled: false, paths }
  }

  async exportMessage(
    window: ElectronBrowserWindow,
    archiveId: string,
    messageId: number,
    indexRevision: string
  ): Promise<ExportResult> {
    const { identity } = this.getRecoveryArchive(archiveId, {
      expectedIndexRevision: indexRevision
    })
    const message = this.getMessage(archiveId, messageId)

    const { dialog } = await import('./electron-runtime')
    const save = await dialog.showSaveDialog(window, {
      defaultPath:
        buildSafeFilename(message.subject ?? 'message', 'message') + '.eml'
    })

    if (save.canceled || !save.filePath) {
      return { cancelled: true }
    }

    return this.exportMessageTo(archiveId, messageId, save.filePath, {
      expectedIndexRevision: identity.indexRevision,
      expectedSource: identity.sourceSnapshot
    })
  }

  async revealPath(targetPath: string): Promise<void> {
    const { shell } = await import('./electron-runtime')
    shell.showItemInFolder(targetPath)
  }

  async exportAttachmentTo(
    archiveId: string,
    attachmentId: number,
    destinationPath: string,
    options: ArchiveExportOptions = {}
  ): Promise<ExportResult> {
    const { archive, identity } = this.getRecoveryArchive(archiveId, options)
    const attachment = this.getAttachment(archiveId, attachmentId)
    await writeArchiveRangeAtomically({
      ...options,
      sourcePath: archive.sourcePath,
      offsetStart: attachment.body_offset_start,
      offsetEnd: attachment.body_offset_end,
      destinationPath,
      expectedSource: identity.sourceSnapshot,
      transforms: [
        new MboxRdUnescapeTransform(),
        decoderForTransferEncoding(attachment.content_transfer_encoding)
      ],
      validateBeforeCommit: async () => {
        this.getRecoveryArchive(archiveId, {
          expectedIndexRevision: identity.indexRevision,
          expectedSource: identity.sourceSnapshot
        })
        await options.validateBeforeCommit?.()
      }
    })
    return { cancelled: false, path: destinationPath }
  }

  async exportMessageTo(
    archiveId: string,
    messageId: number,
    destinationPath: string,
    options: ArchiveExportOptions = {}
  ): Promise<ExportResult> {
    const { archive, identity } = this.getRecoveryArchive(archiveId, options)
    const message = this.getMessage(archiveId, messageId)
    await writeArchiveRangeAtomically({
      ...options,
      sourcePath: archive.sourcePath,
      offsetStart: message.mbox_offset_start,
      offsetEnd: message.mbox_offset_end,
      destinationPath,
      expectedSource: identity.sourceSnapshot,
      transforms: [new MboxRdUnescapeTransform()],
      validateBeforeCommit: async () => {
        this.getRecoveryArchive(archiveId, {
          expectedIndexRevision: identity.indexRevision,
          expectedSource: identity.sourceSnapshot
        })
        await options.validateBeforeCommit?.()
      }
    })
    return { cancelled: false, path: destinationPath }
  }

  private getAttachment(
    archiveId: string,
    attachmentId: number
  ): AttachmentExportRow {
    const { db } = this.getRecoveryArchive(archiveId)
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

  private getMessage(archiveId: string, messageId: number): MessageExportRow {
    const { db } = this.getRecoveryArchive(archiveId)
    const message = db
      .prepare(
        `SELECT id, subject, mbox_offset_start, mbox_offset_end
         FROM messages
         WHERE id = ?`
      )
      .get(messageId) as MessageExportRow | undefined
    if (!message) throw new Error('Message not found')
    return message
  }

  private getRecoveryArchive(
    archiveId: string,
    options: ArchiveExportOptions = {}
  ) {
    const archive = this.catalog.getArchiveById(archiveId)
    if (!archive) {
      throw new Error('Archive not found')
    }

    if (archive.status !== 'ready') {
      throw new Error(
        'Wait for this archive to finish indexing before recovery.'
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
        'This selection is out of date. Search the archive again before recovery.'
      )
    }
    return { archive, db, identity }
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
