import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type BetterSqlite3 from 'better-sqlite3'
import { CATALOG_SCHEMA } from '@shared/schema'
import type {
  ArchiveStatus,
  ArchiveSummary,
  StorageSummary
} from '@shared/contracts'
import Database from '@shared/sqlite-runtime'

interface ArchiveRow {
  id: string
  name: string
  source_path: string
  db_path: string
  imported_at: string
  status: ArchiveStatus
  message_count: number
  attachment_count: number
  last_indexed_at: string | null
  last_error: string | null
}

export interface ArchiveUpdateInput {
  id: string
  name: string
  sourcePath: string
  dbPath: string
  importedAt: string
  status: ArchiveStatus
  messageCount?: number
  attachmentCount?: number
  lastIndexedAt?: string | null
  lastError?: string | null
}

export class CatalogStore {
  private readonly db: BetterSqlite3.Database
  private readonly baseDir: string
  private readonly archivesDir: string

  constructor(options: { baseDir?: string; readonly?: boolean } = {}) {
    this.baseDir =
      options.baseDir ??
      (
        createRequire(import.meta.url)(
          'electron/main'
        ) as typeof import('electron/main')
      ).app.getPath('userData')
    this.archivesDir = path.join(this.baseDir, 'archives')
    if (!options.readonly) {
      fs.mkdirSync(this.archivesDir, { recursive: true })
    }
    this.db = new Database(path.join(this.baseDir, 'catalog.sqlite'), {
      readonly: options.readonly ?? false,
      fileMustExist: options.readonly ?? false
    })
    if (options.readonly) {
      this.db.pragma('query_only = ON')
    } else {
      this.db.exec(CATALOG_SCHEMA)
    }
  }

  close(): void {
    this.db.close()
  }

  getArchiveDbPath(archiveId: string): string {
    return path.join(this.archivesDir, `${archiveId}.sqlite`)
  }

  listArchives(): ArchiveSummary[] {
    return (
      this.db
        .prepare(
          `SELECT id, name, source_path, db_path, imported_at, status, message_count, attachment_count, last_indexed_at, last_error
         FROM archives
         ORDER BY datetime(imported_at) DESC`
        )
        .all() as ArchiveRow[]
    ).map((row) => mapArchiveRow(row))
  }

  getArchiveById(archiveId: string): ArchiveSummary | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, source_path, db_path, imported_at, status, message_count, attachment_count, last_indexed_at, last_error
         FROM archives
         WHERE id = ?`
      )
      .get(archiveId) as ArchiveRow | undefined

    return row ? mapArchiveRow(row) : undefined
  }

  getArchiveBySourcePath(sourcePath: string): ArchiveSummary | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, source_path, db_path, imported_at, status, message_count, attachment_count, last_indexed_at, last_error
         FROM archives
         WHERE source_path = ?`
      )
      .get(sourcePath) as ArchiveRow | undefined

    return row ? mapArchiveRow(row) : undefined
  }

  upsertArchive(input: ArchiveUpdateInput): void {
    this.db
      .prepare(
        `INSERT INTO archives (id, name, source_path, db_path, imported_at, status, message_count, attachment_count, last_indexed_at, last_error)
         VALUES (@id, @name, @sourcePath, @dbPath, @importedAt, @status, @messageCount, @attachmentCount, @lastIndexedAt, @lastError)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           source_path = excluded.source_path,
           db_path = excluded.db_path,
           imported_at = excluded.imported_at,
           status = excluded.status,
           message_count = excluded.message_count,
           attachment_count = excluded.attachment_count,
           last_indexed_at = excluded.last_indexed_at,
           last_error = excluded.last_error`
      )
      .run({
        ...input,
        messageCount: input.messageCount ?? 0,
        attachmentCount: input.attachmentCount ?? 0,
        lastIndexedAt: input.lastIndexedAt ?? null,
        lastError: input.lastError ?? null
      })
  }

  deleteArchive(archiveId: string): void {
    this.db.prepare('DELETE FROM archives WHERE id = ?').run(archiveId)
  }

  getStorageSummary(): StorageSummary {
    const archives = this.listArchives()
    return {
      dataPath: this.baseDir,
      totalIndexBytes: archives.reduce(
        (total, archive) => total + archive.indexSizeBytes,
        0
      ),
      archiveCount: archives.length
    }
  }
}

function mapArchiveRow(row: ArchiveRow): ArchiveSummary {
  return {
    id: row.id,
    name: row.name,
    sourcePath: row.source_path,
    dbPath: row.db_path,
    indexSizeBytes: getSqliteArtifactBytes(row.db_path),
    importedAt: row.imported_at,
    status: row.status,
    messageCount: row.message_count,
    attachmentCount: row.attachment_count,
    lastIndexedAt: row.last_indexed_at,
    lastError: row.last_error
  }
}

function getSqliteArtifactBytes(dbPath: string): number {
  const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
  return candidates.reduce((total, candidate) => {
    try {
      return total + fs.statSync(candidate).size
    } catch {
      return total
    }
  }, 0)
}
