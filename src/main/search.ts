import type Database from 'better-sqlite3'
import type {
  ArchiveSummary,
  SearchQuery,
  SearchResultRow
} from '@shared/contracts'
import {
  buildFtsMatchQuery,
  extractSearchTerms,
  localDateEndToIso,
  localDateStartToIso
} from '@shared/search'
import { ArchiveDatabasePool } from './archive-db'
import { CatalogStore } from './catalog'

interface MessageSearchRow {
  id: number
  archive_id: string
  subject: string | null
  from_text: string | null
  to_text: string | null
  date: string | null
  snippet: string | null
  has_attachments: number
  rank: number
}

interface AttachmentSearchRow extends MessageSearchRow {
  attachment_id: number
  filename: string | null
  content_type: string | null
  size_estimate: number
}

export class SearchService {
  constructor(
    private readonly catalog: CatalogStore,
    private readonly pool: ArchiveDatabasePool
  ) {}

  search(query: SearchQuery): SearchResultRow[] {
    const archives = this.getTargetArchives(query.filters.archiveIds)
    const perArchiveLimit = Math.max(80, query.limit ?? 250)
    const matchQuery = buildFtsMatchQuery(query.text)
    const terms = extractSearchTerms(query.text).map((term) =>
      term.toLowerCase()
    )
    const preferAttachments = Boolean(query.preferAttachments)

    if (preferAttachments) {
      const attachmentRows = this.searchAttachmentResults(
        archives,
        query,
        matchQuery,
        terms,
        perArchiveLimit
      )

      if (attachmentRows.length > 0) {
        return attachmentRows.slice(0, query.limit ?? 250)
      }
    }

    const combined: SearchResultRow[] = []

    for (const archive of archives) {
      const db = this.pool.getDatabase(archive)
      const rows = matchQuery
        ? this.searchWithText(db, archive, query, matchQuery, perArchiveLimit)
        : this.searchWithoutText(db, archive, query, perArchiveLimit)

      combined.push(...rows)
    }

    return combined
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          compareDatesDesc(left.date, right.date) ||
          left.subject.localeCompare(right.subject)
      )
      .slice(0, query.limit ?? 250)
  }

  private searchAttachmentResults(
    archives: ArchiveSummary[],
    query: SearchQuery,
    matchQuery: string | null,
    terms: string[],
    limit: number
  ): SearchResultRow[] {
    const combined: SearchResultRow[] = []

    for (const archive of archives) {
      const db = this.pool.getDatabase(archive)
      const rows = matchQuery
        ? this.searchAttachmentsWithText(
            db,
            archive,
            query,
            matchQuery,
            Math.max(limit, 140)
          )
        : this.searchAttachmentsWithoutText(
            db,
            archive,
            query,
            Math.max(limit, 140)
          )

      combined.push(...rows)
    }

    return combined
      .sort((left, right) => this.compareAttachmentResults(left, right, terms))
      .map((row, index) => ({
        ...row,
        rank: index + 1
      }))
  }

  private compareAttachmentResults(
    left: SearchResultRow,
    right: SearchResultRow,
    terms: string[]
  ): number {
    const leftAttachmentScore = scoreAttachmentResult(left, terms)
    const rightAttachmentScore = scoreAttachmentResult(right, terms)
    if (leftAttachmentScore !== rightAttachmentScore) {
      return rightAttachmentScore - leftAttachmentScore
    }

    if (left.rank !== right.rank) {
      return left.rank - right.rank
    }

    return (
      compareDatesDesc(left.date, right.date) ||
      (left.attachmentFilename ?? '').localeCompare(
        right.attachmentFilename ?? ''
      )
    )
  }

  private getTargetArchives(selectedArchiveIds: string[]): ArchiveSummary[] {
    const archives = this.catalog
      .listArchives()
      .filter((archive) => archive.status === 'ready')
    if (selectedArchiveIds.length === 0) {
      return archives
    }

    const selected = new Set(selectedArchiveIds)
    return archives.filter((archive) => selected.has(archive.id))
  }

  private buildFilterClause(
    query: SearchQuery,
    params: Array<string | number>
  ): string {
    const clauses: string[] = []

    if (query.filters.hasAttachments) {
      clauses.push('m.has_attachments = 1')
    }

    if (query.filters.sender.trim()) {
      clauses.push("LOWER(COALESCE(m.from_text, '')) LIKE ?")
      params.push(`%${query.filters.sender.trim().toLowerCase()}%`)
    }

    if (query.filters.dateFrom) {
      clauses.push("COALESCE(m.date, '') >= ?")
      params.push(
        localDateStartToIso(query.filters.dateFrom) ?? query.filters.dateFrom
      )
    }

    if (query.filters.dateTo) {
      clauses.push("COALESCE(m.date, '') <= ?")
      params.push(
        localDateEndToIso(query.filters.dateTo) ?? query.filters.dateTo
      )
    }

    return clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : ''
  }

  private searchWithText(
    db: Database.Database,
    archive: ArchiveSummary,
    query: SearchQuery,
    matchQuery: string,
    limit: number
  ): SearchResultRow[] {
    const params: Array<string | number> = [matchQuery]
    const filterClause = this.buildFilterClause(query, params)
    params.push(limit)

    let rows: MessageSearchRow[]
    try {
      rows = db
        .prepare(
          `SELECT
             m.id,
             m.archive_id,
             m.subject,
             m.from_text,
             m.to_text,
             m.date,
             COALESCE(snippet(fts_messages, 5, '<mark>', '</mark>', ' … ', 18), m.snippet) AS snippet,
             m.has_attachments,
             bm25(fts_messages, 12.0, 8.0, 4.0, 4.0, 1.0) AS rank
           FROM fts_messages
           JOIN messages m ON m.id = fts_messages.message_id
           WHERE fts_messages MATCH ?${filterClause}
           ORDER BY rank
           LIMIT ?`
        )
        .all(...params) as MessageSearchRow[]
    } catch {
      return []
    }

    return rows.map((row) => this.mapMessageRow(row, archive.name))
  }

  private searchWithoutText(
    db: Database.Database,
    archive: ArchiveSummary,
    query: SearchQuery,
    limit: number
  ): SearchResultRow[] {
    const params: Array<string | number> = []
    const filterClause = this.buildFilterClause(query, params)
    params.push(limit)

    const rows = db
      .prepare(
        `SELECT
           m.id,
           m.archive_id,
           m.subject,
           m.from_text,
           m.to_text,
           m.date,
           m.snippet,
           m.has_attachments,
           999999.0 AS rank
         FROM messages m
         WHERE 1 = 1${filterClause}
         ORDER BY COALESCE(m.date, '') DESC, m.id DESC
         LIMIT ?`
      )
      .all(...params) as MessageSearchRow[]

    return rows.map((row, index) => ({
      ...this.mapMessageRow(row, archive.name),
      rank: index + 1
    }))
  }

  private searchAttachmentsWithText(
    db: Database.Database,
    archive: ArchiveSummary,
    query: SearchQuery,
    matchQuery: string,
    limit: number
  ): SearchResultRow[] {
    const params: Array<string | number> = [matchQuery]
    const filterClause = this.buildFilterClause(query, params)
    params.push(limit)

    let rows: AttachmentSearchRow[]
    try {
      rows = db
        .prepare(
          `SELECT
             m.id,
             m.archive_id,
             m.subject,
             m.from_text,
             m.to_text,
             m.date,
             COALESCE(snippet(fts_messages, 5, '<mark>', '</mark>', ' … ', 18), m.snippet) AS snippet,
             m.has_attachments,
             bm25(fts_messages, 12.0, 8.0, 4.0, 4.0, 1.0) AS rank,
             a.id AS attachment_id,
             a.filename,
             a.content_type,
             a.size_estimate
           FROM fts_messages
           JOIN messages m ON m.id = fts_messages.message_id
           JOIN attachments a ON a.message_id = m.id
           WHERE fts_messages MATCH ?${filterClause}
           ORDER BY rank
           LIMIT ?`
        )
        .all(...params) as AttachmentSearchRow[]
    } catch {
      return []
    }

    return rows.map((row) => this.mapAttachmentRow(row, archive.name))
  }

  private searchAttachmentsWithoutText(
    db: Database.Database,
    archive: ArchiveSummary,
    query: SearchQuery,
    limit: number
  ): SearchResultRow[] {
    const params: Array<string | number> = []
    const filterClause = this.buildFilterClause(query, params)
    params.push(limit)

    const rows = db
      .prepare(
        `SELECT
           m.id,
           m.archive_id,
           m.subject,
           m.from_text,
           m.to_text,
           m.date,
           m.snippet,
           m.has_attachments,
           999999.0 AS rank,
           a.id AS attachment_id,
           a.filename,
           a.content_type,
           a.size_estimate
         FROM messages m
         JOIN attachments a ON a.message_id = m.id
         WHERE 1 = 1${filterClause}
         ORDER BY COALESCE(m.date, '') DESC, m.id DESC, a.id DESC
         LIMIT ?`
      )
      .all(...params) as AttachmentSearchRow[]

    return rows.map((row, index) => ({
      ...this.mapAttachmentRow(row, archive.name),
      rank: index + 1
    }))
  }

  private mapMessageRow(
    row: MessageSearchRow,
    archiveName: string
  ): SearchResultRow {
    return {
      resultId: `message:${row.archive_id}:${row.id}`,
      kind: 'message',
      id: row.id,
      archiveId: row.archive_id,
      archiveName,
      subject: row.subject ?? '(no subject)',
      fromText: row.from_text ?? '',
      toText: row.to_text ?? '',
      date: row.date,
      snippet: row.snippet ?? '',
      hasAttachments: row.has_attachments === 1,
      attachmentId: null,
      attachmentFilename: null,
      attachmentContentType: null,
      attachmentSizeEstimate: null,
      rank: row.rank
    }
  }

  private mapAttachmentRow(
    row: AttachmentSearchRow,
    archiveName: string
  ): SearchResultRow {
    return {
      resultId: `attachment:${row.archive_id}:${row.attachment_id}`,
      kind: 'attachment',
      id: row.id,
      archiveId: row.archive_id,
      archiveName,
      subject: row.subject ?? '(no subject)',
      fromText: row.from_text ?? '',
      toText: row.to_text ?? '',
      date: row.date,
      snippet: row.snippet ?? '',
      hasAttachments: true,
      attachmentId: row.attachment_id,
      attachmentFilename: row.filename,
      attachmentContentType: row.content_type,
      attachmentSizeEstimate: row.size_estimate,
      rank: row.rank
    }
  }
}

function scoreAttachmentResult(row: SearchResultRow, terms: string[]): number {
  const filename = (row.attachmentFilename ?? '').toLowerCase()
  const contentType = (row.attachmentContentType ?? '').toLowerCase()
  let score = 0

  for (const term of terms) {
    if (filename.includes(term)) {
      score += 8
    }
    if (contentType.includes(term)) {
      score += 5
    }
    if (
      term === 'pdf' &&
      (contentType.includes('pdf') || filename.endsWith('.pdf'))
    ) {
      score += 10
    }
  }

  if (contentType.includes('pdf') || filename.endsWith('.pdf')) {
    score += 2
  }

  if (filename.length > 0) {
    score += 0.5
  }

  score += recencySignal(row.date)
  return score
}

function recencySignal(date: string | null): number {
  if (!date) {
    return 0
  }

  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) {
    return 0
  }

  const ageDays = (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays <= 30) {
    return 1.5
  }
  if (ageDays <= 180) {
    return 0.75
  }
  if (ageDays <= 365) {
    return 0.25
  }
  return 0
}

function compareDatesDesc(left: string | null, right: string | null): number {
  const leftTime = left ? new Date(left).getTime() : Number.NEGATIVE_INFINITY
  const rightTime = right ? new Date(right).getTime() : Number.NEGATIVE_INFINITY
  return rightTime - leftTime
}
