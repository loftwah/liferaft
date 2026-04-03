import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  startTransition
} from 'react'
import { Virtuoso } from 'react-virtuoso'
import DOMPurify from 'dompurify'
import type {
  ArchiveSummary,
  AttachmentSummary,
  ExportResult,
  ImportProgressEvent,
  SearchFilters,
  SearchResultRow
} from '@shared/contracts'
import { formatSnippetHtml } from '@shared/search-snippet'
import { useLiferaftStore } from './store'

type PreviewMode = 'formatted' | 'plain'

export function App() {
  const {
    archives,
    results,
    selectedMessage,
    preview,
    storageInfo,
    uiError,
    progress,
    isSearching,
    isMutatingArchives,
    isLoadingPreview,
    query,
    filters,
    initialize,
    setQuery,
    patchFilters,
    resetFilters,
    runSearch,
    selectMessage,
    beginImport,
    cancelImport,
    deleteArchiveIndex,
    reindexArchive,
    clearAllArchiveIndexes,
    clearUiError
  } = useLiferaftStore()
  const [previewMode, setPreviewMode] = useState<PreviewMode>('formatted')
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [showRefinements, setShowRefinements] = useState(false)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void runSearch()
    }, 140)

    return () => {
      window.clearTimeout(handle)
    }
  }, [deferredQuery, filters, runSearch])

  useEffect(() => {
    setPreviewMode(preview?.html ? 'formatted' : 'plain')
  }, [preview])

  useEffect(() => {
    if (!exportNotice) {
      return
    }

    const handle = window.setTimeout(() => {
      setExportNotice(null)
    }, 3200)

    return () => {
      window.clearTimeout(handle)
    }
  }, [exportNotice])

  const readyArchives = useMemo(
    () => archives.filter((archive) => archive.status === 'ready'),
    [archives]
  )
  const indexingArchives = useMemo(
    () => archives.filter((archive) => archive.status === 'indexing'),
    [archives]
  )
  const indexedMessageCount = useMemo(
    () =>
      readyArchives.reduce((total, archive) => total + archive.messageCount, 0),
    [readyArchives]
  )
  const activeFilterCount = useMemo(
    () =>
      [
        filters.archiveIds.length > 0,
        Boolean(filters.sender.trim()),
        Boolean(filters.dateFrom),
        Boolean(filters.dateTo),
        filters.hasAttachments
      ].filter(Boolean).length,
    [filters]
  )
  const primaryResultKind = results[0]?.kind ?? 'message'

  const handleExportResult = async (
    resultPromise: Promise<ExportResult>,
    successLabel: string
  ) => {
    const result = await resultPromise
    if (result.cancelled) {
      return
    }

    const revealTarget = result.path ?? result.paths?.[0]
    if (revealTarget) {
      await window.liferaft.revealPath(revealTarget)
      setExportNotice(`${successLabel} ready in Finder.`)
    }
  }

  const resetSearchUi = () => {
    setQuery('')
    resetFilters()
  }

  return (
    <div className="app-frame">
      <aside className="sidebar panel">
        <div className="sidebar-header">
          <div>
            <div className="eyebrow">Liferaft</div>
            <h1 className="app-title">Local mail recovery</h1>
          </div>
          <button className="primary-button" onClick={() => void beginImport()}>
            Import .mbox
          </button>
        </div>

        <div className="storage-card">
          <div className="section-title">Local Index</div>
          <div className="storage-stats">
            <div>
              <strong>{formatBytes(storageInfo?.totalIndexBytes ?? 0)}</strong>
              <span> on disk</span>
            </div>
            <div>
              <strong>{archives.length}</strong>
              <span> archive{archives.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div className="mt-2 text-sm text-[var(--muted)]">
            Finished indexes reopen instantly. If you quit mid-index, unfinished
            work is discarded.
          </div>
          {storageInfo ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="secondary-button"
                onClick={() =>
                  void window.liferaft.revealPath(storageInfo.dataPath)
                }
                type="button"
              >
                Reveal storage
              </button>
              <button
                className="secondary-button"
                disabled={archives.length === 0 || isMutatingArchives}
                onClick={() => void clearAllArchiveIndexes()}
                type="button"
              >
                Clear all indexes
              </button>
            </div>
          ) : null}
        </div>

        {uiError ? (
          <div className="error-banner">
            <div>{uiError}</div>
            <button
              type="button"
              className="inline-action"
              onClick={clearUiError}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="sidebar-section-header">
          <div>
            <div className="section-title">Archives</div>
            <div className="mt-1 text-sm text-[var(--muted)]">
              {readyArchives.length} ready, {indexingArchives.length} indexing
            </div>
          </div>
        </div>

        <div className="archive-list">
          {archives.length === 0 ? (
            <EmptyState
              title="No mail indexed yet"
              body="Import one or more .mbox files to build a local search index."
            />
          ) : (
            archives.map((archive) => (
              <ArchiveCard
                key={archive.id}
                archive={archive}
                progress={progress[archive.id]}
                selected={filters.archiveIds.includes(archive.id)}
                onToggle={() => {
                  const selected = new Set(filters.archiveIds)
                  if (selected.has(archive.id)) {
                    selected.delete(archive.id)
                  } else {
                    selected.add(archive.id)
                  }

                  startTransition(() => {
                    patchFilters({
                      archiveIds: [...selected]
                    })
                  })
                }}
                onCancel={() => void cancelImport(archive.id)}
                onDelete={() => void deleteArchiveIndex(archive.id)}
                onReindex={() => void reindexArchive(archive.id)}
              />
            ))
          )}
        </div>
      </aside>

      <main className="workspace">
        <section className="toolbar panel">
          <div className="toolbar-row">
            <label className="search-box">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search mail, people, body text, or attachment names"
              />
            </label>
            <button
              className="secondary-button"
              onClick={() => setShowRefinements((value) => !value)}
              type="button"
            >
              {showRefinements || activeFilterCount > 0
                ? 'Hide refinements'
                : 'Refine'}
            </button>
            <button
              className="secondary-button"
              disabled={!query && activeFilterCount === 0}
              onClick={resetSearchUi}
              type="button"
            >
              Reset
            </button>
          </div>

          <div className="toolbar-meta">
            <span>
              {isSearching
                ? 'Refreshing results…'
                : `${indexedMessageCount.toLocaleString()} indexed messages across ${readyArchives.length} ready archives`}
            </span>
            <span>
              Search operators: <code>from:</code> <code>has:attachment</code>{' '}
              <code>after:</code> <code>before:</code> <code>filename:</code>{' '}
              <code>filetype:</code>
            </span>
          </div>

          {showRefinements || activeFilterCount > 0 ? (
            <div className="refinement-grid">
              <label className="field">
                <span>Sender contains</span>
                <input
                  value={filters.sender}
                  onChange={(event) =>
                    patchFilters({ sender: event.target.value })
                  }
                  placeholder="name or address"
                />
              </label>
              <label className="field">
                <span>After</span>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) =>
                    patchFilters({ dateFrom: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Before</span>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) =>
                    patchFilters({ dateTo: event.target.value })
                  }
                />
              </label>
              <label className="checkbox-row refinement-toggle">
                <input
                  type="checkbox"
                  checked={filters.hasAttachments}
                  onChange={(event) =>
                    patchFilters({ hasAttachments: event.target.checked })
                  }
                />
                <span>Only messages with attachments</span>
              </label>
            </div>
          ) : null}

          <div className="chip-row">
            {buildFilterChips(filters, archives).map((chip) => (
              <span key={chip} className="tag">
                {chip}
              </span>
            ))}
            {buildFilterChips(filters, archives).length === 0 ? (
              <span className="text-sm text-[var(--muted)]">
                Refine only when you need it. Start with a plain search.
              </span>
            ) : null}
          </div>
        </section>

        <section className="content-grid">
          <section className="results-panel panel">
            <div className="panel-header">
              <div>
                <div className="section-title">Results</div>
                <div className="panel-subtitle">
                  {results.length} matching{' '}
                  {primaryResultKind === 'attachment'
                    ? 'attachment'
                    : 'message'}
                  {results.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>

            <div className="panel-body">
              {results.length === 0 ? (
                <div className="panel-empty">
                  <EmptyState
                    title="Nothing matches yet"
                    body="Try a broader search, remove refinements, or import another archive."
                  />
                </div>
              ) : (
                <Virtuoso
                  data={results}
                  itemContent={(_index, message) => (
                    <MessageRow
                      key={message.resultId}
                      message={message}
                      selected={selectedMessage?.resultId === message.resultId}
                      onSelect={() => void selectMessage(message)}
                      onExportAttachment={(archiveId, attachmentId) =>
                        void handleExportResult(
                          window.liferaft.exportAttachment(
                            archiveId,
                            attachmentId
                          ),
                          'Attachment export'
                        )
                      }
                    />
                  )}
                />
              )}
            </div>
          </section>

          <section className="preview-pane panel">
            <div className="panel-header">
              <div>
                <div className="section-title">Preview</div>
                <div className="panel-subtitle">
                  Inspect the message, then export only what you need.
                </div>
              </div>
              {preview ? (
                <div className="flex gap-2">
                  <button
                    className={
                      previewMode === 'formatted'
                        ? 'segmented-active'
                        : 'segmented-button'
                    }
                    onClick={() => setPreviewMode('formatted')}
                    disabled={!preview.html}
                    type="button"
                  >
                    Formatted
                  </button>
                  <button
                    className={
                      previewMode === 'plain'
                        ? 'segmented-active'
                        : 'segmented-button'
                    }
                    onClick={() => setPreviewMode('plain')}
                    type="button"
                  >
                    Plain
                  </button>
                </div>
              ) : null}
            </div>

            {isLoadingPreview ? (
              <div className="panel-empty">Loading message preview…</div>
            ) : preview ? (
              <div className="preview-layout">
                {exportNotice ? (
                  <div className="export-notice">{exportNotice}</div>
                ) : null}

                <div className="preview-header">
                  <div>
                    <div className="eyebrow">Subject</div>
                    <h2 className="preview-title">
                      {preview.subject || '(no subject)'}
                    </h2>
                  </div>
                  <div className="preview-actions">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void handleExportResult(
                          window.liferaft.exportMessage(
                            preview.archiveId,
                            preview.id
                          ),
                          'Message export'
                        )
                      }
                      type="button"
                    >
                      Export .eml
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void handleExportResult(
                          window.liferaft.exportAllAttachments(
                            preview.archiveId,
                            preview.id
                          ),
                          'Attachments export'
                        )
                      }
                      disabled={preview.attachments.length === 0}
                      type="button"
                    >
                      Export all attachments
                    </button>
                  </div>
                </div>

                <dl className="preview-metadata">
                  <dt>From</dt>
                  <dd>{preview.fromText || 'Unknown sender'}</dd>
                  <dt>To</dt>
                  <dd>{preview.toText || 'No visible recipients'}</dd>
                  {preview.ccText ? (
                    <>
                      <dt>Cc</dt>
                      <dd>{preview.ccText}</dd>
                    </>
                  ) : null}
                  <dt>Date</dt>
                  <dd>
                    {preview.date ? formatDate(preview.date) : 'Unknown date'}
                  </dd>
                  <dt>Archive</dt>
                  <dd>{preview.archiveName}</dd>
                </dl>

                <div className="preview-content-grid">
                  <div className="message-surface">
                    <MessageBody
                      mode={previewMode}
                      html={preview.html}
                      text={preview.text}
                    />
                  </div>
                  <div className="attachment-rail">
                    <div className="section-title">Attachments</div>
                    <div className="attachment-list">
                      {preview.attachments.length === 0 ? (
                        <div className="attachment-empty">
                          No attachments in this message.
                        </div>
                      ) : (
                        preview.attachments.map((attachment) => (
                          <AttachmentCard
                            key={attachment.id}
                            archiveId={preview.archiveId}
                            attachment={attachment}
                            onExport={(archiveId, attachmentId) =>
                              void handleExportResult(
                                window.liferaft.exportAttachment(
                                  archiveId,
                                  attachmentId
                                ),
                                'Attachment export'
                              )
                            }
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="panel-empty">
                <EmptyState
                  title="Choose a message"
                  body="Search across indexed mail, then open a result to inspect headers and export attachments."
                />
              </div>
            )}
          </section>
        </section>
      </main>
    </div>
  )
}

function ArchiveCard({
  archive,
  progress,
  selected,
  onToggle,
  onCancel,
  onDelete,
  onReindex
}: {
  archive: ArchiveSummary
  progress?: ImportProgressEvent
  selected: boolean
  onToggle: () => void
  onCancel: () => void
  onDelete: () => void
  onReindex: () => void
}) {
  const percent =
    progress && progress.totalBytes > 0
      ? Math.min(
          100,
          Math.round((progress.bytesProcessed / progress.totalBytes) * 100)
        )
      : 0
  const liveMessageCount =
    archive.status === 'indexing'
      ? (progress?.messagesProcessed ?? archive.messageCount)
      : archive.messageCount

  return (
    <div
      className={`archive-card ${selected ? 'archive-card-selected' : ''}`}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="archive-card-header">
        <div className="min-w-0">
          <div className="truncate font-medium">{archive.name}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            {liveMessageCount.toLocaleString()} messages ·{' '}
            {formatBytes(archive.indexSizeBytes)}
          </div>
        </div>
        <div className={`status-pill status-${archive.status}`}>
          {archive.status}
        </div>
      </div>
      <div className="archive-path">{archive.sourcePath}</div>

      {progress && archive.status === 'indexing' ? (
        <div className="archive-progress">
          <div className="progress-copy">
            <span>{percent}% complete</span>
            <span>{formatEta(progress.etaSeconds)}</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="progress-copy">
            <span>
              {progress.messagesProcessed.toLocaleString()} messages scanned
            </span>
            <span className="text-[var(--muted)]">Building a local index</span>
          </div>
        </div>
      ) : null}

      <div className="archive-actions">
        {archive.status === 'indexing' ? (
          <button
            className="inline-action"
            onClick={(event) => {
              event.stopPropagation()
              onCancel()
            }}
            type="button"
          >
            Cancel
          </button>
        ) : (
          <>
            <button
              className="inline-action"
              onClick={(event) => {
                event.stopPropagation()
                onReindex()
              }}
              type="button"
            >
              Reindex
            </button>
            <button
              className="inline-action danger-action"
              onClick={(event) => {
                event.stopPropagation()
                onDelete()
              }}
              type="button"
            >
              Remove index
            </button>
          </>
        )}
      </div>

      {archive.lastError ? (
        <div className="mt-3 text-xs text-red-700">{archive.lastError}</div>
      ) : null}
    </div>
  )
}

function MessageRow({
  message,
  selected,
  onSelect,
  onExportAttachment
}: {
  message: SearchResultRow
  selected: boolean
  onSelect: () => void
  onExportAttachment: (archiveId: string, attachmentId: number) => void
}) {
  return (
    <div
      className={`message-row ${selected ? 'message-row-selected' : ''}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {message.kind === 'attachment' ? (
            <div className="attachment-result-name">
              {message.attachmentFilename || 'Unnamed attachment'}
            </div>
          ) : null}
          <div className="truncate text-base font-medium">
            {message.kind === 'attachment'
              ? message.subject || '(no subject)'
              : message.subject || '(no subject)'}
          </div>
          <div className="mt-1 truncate text-sm text-[var(--muted)]">
            {message.fromText}
          </div>
        </div>
        <div className="text-right text-xs text-[var(--muted)]">
          <div>{message.date ? formatDate(message.date) : 'Unknown date'}</div>
          <div>{message.archiveName}</div>
        </div>
      </div>
      <div
        className="mt-2 line-clamp-2 text-sm text-[var(--muted)]"
        dangerouslySetInnerHTML={{
          __html: message.snippet
            ? formatSnippetHtml(message.snippet)
            : '&nbsp;'
        }}
      />
      <div className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]">
        {message.kind === 'attachment' ? (
          <>
            <span className="tag">
              {message.attachmentContentType || 'Attachment'}
            </span>
            {message.attachmentSizeEstimate != null ? (
              <span>{formatBytes(message.attachmentSizeEstimate)}</span>
            ) : null}
          </>
        ) : message.hasAttachments ? (
          <span className="tag">Attachment</span>
        ) : null}
        {message.toText ? (
          <span className="truncate">To {message.toText}</span>
        ) : null}
        {message.kind === 'attachment' && message.attachmentId != null ? (
          <button
            className="inline-action ml-auto"
            onClick={(event) => {
              event.stopPropagation()
              onExportAttachment(message.archiveId, message.attachmentId!)
            }}
            type="button"
          >
            Export
          </button>
        ) : null}
      </div>
    </div>
  )
}

function MessageBody({
  mode,
  html,
  text
}: {
  mode: PreviewMode
  html: string | null
  text: string
}) {
  if (mode === 'formatted' && html) {
    const safeHtml = DOMPurify.sanitize(html, {
      USE_PROFILES: {
        html: true
      },
      FORBID_TAGS: ['img', 'picture', 'source']
    })

    return (
      <div className="message-body">
        <div className="message-body-note">
          Inline and remote images are hidden in preview.
        </div>
        <div
          className="mail-html message-body-content"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      </div>
    )
  }

  return (
    <pre className="message-body-text">
      {text || 'No readable text body available.'}
    </pre>
  )
}

function AttachmentCard({
  archiveId,
  attachment,
  onExport
}: {
  archiveId: string
  attachment: AttachmentSummary
  onExport: (archiveId: string, attachmentId: number) => void
}) {
  return (
    <div className="attachment-card">
      <div className="font-medium">
        {attachment.filename || 'Unnamed attachment'}
      </div>
      <div className="mt-1 text-xs text-[var(--muted)]">
        {attachment.contentType || 'Unknown type'} ·{' '}
        {formatBytes(attachment.sizeEstimate)}
      </div>
      <button
        className="secondary-button mt-3 w-full"
        onClick={() => onExport(archiveId, attachment.id)}
        type="button"
      >
        Export attachment
      </button>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="font-['Avenir_Next','Segoe_UI',sans-serif] text-xl font-semibold">
        {title}
      </div>
      <div className="mt-2 text-sm text-[var(--muted)]">{body}</div>
    </div>
  )
}

function buildFilterChips(
  filters: SearchFilters,
  archives: ArchiveSummary[]
): string[] {
  const chips: string[] = []

  if (filters.archiveIds.length > 0) {
    const selectedArchives = archives
      .filter((archive) => filters.archiveIds.includes(archive.id))
      .map((archive) => archive.name)
    if (selectedArchives.length > 0) {
      chips.push(
        selectedArchives.length === 1
          ? `Archive: ${selectedArchives[0]}`
          : `${selectedArchives.length} archives`
      )
    }
  }

  if (filters.sender.trim()) {
    chips.push(`Sender: ${filters.sender.trim()}`)
  }

  if (filters.dateFrom) {
    chips.push(`After ${filters.dateFrom}`)
  }

  if (filters.dateTo) {
    chips.push(`Before ${filters.dateTo}`)
  }

  if (filters.hasAttachments) {
    chips.push('Has attachments')
  }

  return chips
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function formatBytes(value: number): string {
  if (value <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let amount = value
  let unitIndex = 0

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }

  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatEta(value: number | null): string {
  if (value == null || value < 15) {
    return 'Estimating time left…'
  }

  if (value < 60) {
    return 'Less than a minute left'
  }

  const minutes = Math.round(value / 60)
  if (minutes < 60) {
    return `About ${minutes} min left`
  }

  const hours = Math.floor(minutes / 60)
  const remainderMinutes = minutes % 60
  if (remainderMinutes === 0) {
    return `About ${hours} hr left`
  }

  return `About ${hours} hr ${remainderMinutes} min left`
}
