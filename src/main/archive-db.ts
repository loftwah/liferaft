import type BetterSqlite3 from 'better-sqlite3'
import fs from 'node:fs'
import Database from '@shared/sqlite-runtime'
import type { ArchiveSummary } from '@shared/contracts'

export class ArchiveDatabasePool {
  private readonly databases = new Map<
    string,
    {
      db: BetterSqlite3.Database
      path: string
      dev: number
      ino: number
    }
  >()

  constructor(private readonly options: { readonly?: boolean } = {}) {}

  getDatabase(archive: ArchiveSummary): BetterSqlite3.Database {
    const stat = fs.statSync(archive.dbPath)
    const existing = this.databases.get(archive.id)
    if (
      existing &&
      existing.path === archive.dbPath &&
      existing.dev === stat.dev &&
      existing.ino === stat.ino
    ) {
      return existing.db
    }
    this.closeArchive(archive.id)

    const db = new Database(archive.dbPath, {
      fileMustExist: true,
      readonly: this.options.readonly ?? false
    })
    db.pragma('foreign_keys = ON')
    if (this.options.readonly) {
      db.pragma('query_only = ON')
    }
    this.databases.set(archive.id, {
      db,
      path: archive.dbPath,
      dev: stat.dev,
      ino: stat.ino
    })
    return db
  }

  closeArchive(archiveId: string): void {
    const db = this.databases.get(archiveId)
    if (!db) {
      return
    }

    db.db.close()
    this.databases.delete(archiveId)
  }

  closeAll(): void {
    for (const db of this.databases.values()) {
      db.db.close()
    }

    this.databases.clear()
  }
}
