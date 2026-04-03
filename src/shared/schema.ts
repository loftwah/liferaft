export const CATALOG_SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS archives (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_path TEXT NOT NULL,
    db_path TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    status TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    attachment_count INTEGER NOT NULL DEFAULT 0,
    last_indexed_at TEXT,
    last_error TEXT
  );
`

export const ARCHIVE_SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    archive_id TEXT NOT NULL,
    subject TEXT,
    from_text TEXT,
    to_text TEXT,
    cc_text TEXT,
    date TEXT,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    mbox_offset_start INTEGER NOT NULL,
    mbox_offset_end INTEGER NOT NULL,
    snippet TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(from_text);
  CREATE INDEX IF NOT EXISTS idx_messages_has_attachments ON messages(has_attachments);
  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename TEXT,
    content_type TEXT,
    content_transfer_encoding TEXT,
    size_estimate INTEGER NOT NULL DEFAULT 0,
    offset_start INTEGER NOT NULL,
    offset_end INTEGER NOT NULL,
    body_offset_start INTEGER NOT NULL,
    body_offset_end INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
  CREATE VIRTUAL TABLE IF NOT EXISTS fts_messages USING fts5(
    message_id UNINDEXED,
    subject,
    attachment_names,
    sender,
    recipients,
    body,
    tokenize = 'porter unicode61'
  );
`

export interface IndexedMessageRecord {
  subject: string
  fromText: string
  toText: string
  ccText: string
  date: string | null
  snippet: string
  bodyText: string
  mboxOffsetStart: number
  mboxOffsetEnd: number
}

export interface IndexedAttachmentRecord {
  filename: string | null
  contentType: string | null
  contentTransferEncoding: string | null
  sizeEstimate: number
  offsetStart: number
  offsetEnd: number
  bodyOffsetStart: number
  bodyOffsetEnd: number
}
