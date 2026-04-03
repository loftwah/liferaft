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
    | 'queued'
    | 'starting'
    | 'indexing'
    | 'completed'
    | 'failed'
    | 'cancelled'
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
  archiveId: string
  archiveName: string
  subject: string
  fromText: string
  toText: string
  ccText: string
  date: string | null
  html: string | null
  text: string
  attachments: AttachmentSummary[]
}

export interface ExportResult {
  cancelled: boolean
  path?: string
  paths?: string[]
}

export interface LiferaftApi {
  selectMboxFiles: () => Promise<string[]>
  startImport: (paths: string[]) => Promise<ArchiveSummary[]>
  cancelImport: (archiveId: string) => Promise<void>
  deleteArchiveIndex: (archiveId: string) => Promise<void>
  listArchives: () => Promise<ArchiveSummary[]>
  getStorageInfo: () => Promise<StorageSummary>
  searchMessages: (query: SearchQuery) => Promise<SearchResultRow[]>
  loadMessagePreview: (
    archiveId: string,
    messageId: number
  ) => Promise<MessagePreview>
  exportAttachment: (
    archiveId: string,
    attachmentId: number
  ) => Promise<ExportResult>
  exportAllAttachments: (
    archiveId: string,
    messageId: number
  ) => Promise<ExportResult>
  exportMessage: (archiveId: string, messageId: number) => Promise<ExportResult>
  revealPath: (path: string) => Promise<void>
  onImportProgress: (
    listener: (event: ImportProgressEvent) => void
  ) => () => void
}
