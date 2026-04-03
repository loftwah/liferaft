import type BetterSqlite3 from 'better-sqlite3'
import Database from '@shared/sqlite-runtime'
import type { ArchiveSummary } from '@shared/contracts'

export class ArchiveDatabasePool {
  private readonly databases = new Map<string, BetterSqlite3.Database>()

  getDatabase(archive: ArchiveSummary): BetterSqlite3.Database {
    const existing = this.databases.get(archive.id)
    if (existing) {
      return existing
    }

    const db = new Database(archive.dbPath, {
      fileMustExist: true
    })
    db.pragma('foreign_keys = ON')
    this.databases.set(archive.id, db)
    return db
  }

  closeArchive(archiveId: string): void {
    const db = this.databases.get(archiveId)
    if (!db) {
      return
    }

    db.close()
    this.databases.delete(archiveId)
  }

  closeAll(): void {
    for (const db of this.databases.values()) {
      db.close()
    }

    this.databases.clear()
  }
}
