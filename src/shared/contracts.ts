export type ArchiveStatus = 'ready' | 'indexing' | 'failed' | 'cancelled'

export interface ArchiveSummary {
  id: string
  name: string
  sourcePath: string
  dbPath: string
  indexSizeBytes: number
  importedAt: string
  status: ArchiveStatus
  messageCount: number
  attachmentCount: number
  lastIndexedAt?: string | null
  lastError?: string | null
}

export interface StorageSummary {
  dataPath: string
  totalIndexBytes: number
  archiveCount: number
}

export interface ImportProgressEvent {
  archiveId: string
  phase:
    'queued' | 'starting' | 'indexing' | 'completed' | 'failed' | 'cancelled'
  bytesProcessed: number
  totalBytes: number
  messagesProcessed: number
  attachmentsProcessed: number
  etaSeconds: number | null
  currentFile: string
  error?: string
}

export interface SearchFilters {
  archiveIds: string[]
  hasAttachments: boolean
  filenames?: string[]
  extensions?: string[]
  sender: string
  dateFrom: string
  dateTo: string
}

export interface SearchQuery {
  text: string
  filters: SearchFilters
  preferAttachments?: boolean
  limit?: number
}

export interface SearchResultRow {
  resultId: string
  indexRevision: string
  kind: 'message' | 'attachment'
  id: number
  archiveId: string
  archiveName: string
  subject: string
  fromText: string
  toText: string
  date: string | null
  snippet: string
  hasAttachments: boolean
  attachmentId?: number | null
  attachmentFilename?: string | null
  attachmentContentType?: string | null
  attachmentSizeEstimate?: number | null
  rank: number
}

export interface AttachmentSummary {
  id: number
  messageId: number
  filename: string | null
  contentType: string | null
  contentTransferEncoding: string | null
  sizeEstimate: number
}

export interface MessagePreview {
  id: number
  indexRevision: string
  archiveId: string
  archiveName: string
  subject: string
  fromText: string
  toText: string
  ccText: string
  date: string | null
  hasHtml: boolean
  text: string
  attachments: AttachmentSummary[]
}

export interface ExportResult {
  cancelled: boolean
  path?: string
  paths?: string[]
  error?: string
}
