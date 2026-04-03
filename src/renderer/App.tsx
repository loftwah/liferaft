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
import { detectAttachmentSearchIntent } from '@shared/search'
import { useLiferaftStore } from './store'

type PreviewMode = 'formatted' | 'plain'
const liferaftIconUrl = new URL(
  './assets/icons/liferaft-icon-128.png',
  import.meta.url
).href

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
  const [focusedAttachmentId, setFocusedAttachmentId] = useState<number | null>(
    null
  )
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

  useEffect(() => {
    setFocusedAttachmentId(
      selectedMessage?.kind === 'attachment'
        ? (selectedMessage.attachmentId ?? null)
        : null
    )
  }, [selectedMessage?.resultId])

  useEffect(() => {
    if (!preview) {
      setFocusedAttachmentId(null)
      return
    }

    setFocusedAttachmentId((current) => {
      if (
        selectedMessage?.kind === 'attachment' &&
        selectedMessage.attachmentId != null
      ) {
        return selectedMessage.attachmentId
      }

      if (
        current &&
        preview.attachments.some((entry) => entry.id === current)
      ) {
        return current
      }

      return preview.attachments[0]?.id ?? null
    })
  }, [preview, selectedMessage])

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
  const indexedAttachmentCount = useMemo(
    () =>
      readyArchives.reduce(
        (total, archive) => total + archive.attachmentCount,
        0
      ),
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
  const attachmentSearchMode = useMemo(
    () => detectAttachmentSearchIntent(query) || filters.hasAttachments,
    [filters.hasAttachments, query]
  )
  const filterChips = useMemo(
    () => buildFilterChips(filters, archives),
    [archives, filters]
  )
  const selectedAttachment = useMemo(
    () =>
      preview?.attachments.find(
        (attachment) => attachment.id === focusedAttachmentId
      ) ?? null,
    [focusedAttachmentId, preview]
  )
  const orderedAttachments = useMemo(() => {
    if (!preview) {
      return []
    }

    if (!focusedAttachmentId) {
      return preview.attachments
    }

    return [...preview.attachments].sort((left, right) => {
      if (left.id === focusedAttachmentId) {
        return -1
      }
      if (right.id === focusedAttachmentId) {
        return 1
      }
      return left.id - right.id
    })
  }, [focusedAttachmentId, preview])

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

  const resultModeCopy = attachmentSearchMode
    ? 'Attachment-first ranking is active for this search.'
    : 'Searching messages and attachment names together.'

  return (
    <div className="app-frame">
      <aside className="scope-rail panel">
        <div className="rail-header">
          <div className="brand-block">
            <img
              alt=""
              aria-hidden="true"
              className="brand-mark"
              src={liferaftIconUrl}
            />
            <div className="brand-copy">
              <div className="eyebrow">Liferaft</div>
              <h1 className="app-title">Attachment recovery</h1>
              <p className="rail-subtitle">
                Local, read-only indexing for .mbox archives.
              </p>
            </div>
          </div>
          <button className="primary-button" onClick={() => void beginImport()}>
            Import .mbox
          </button>
        </div>

        <section className="trust-panel">
          <div className="trust-panel-header">
            <div>
              <div className="section-title">Index status</div>
              <div className="trust-summary">
                {indexedAttachmentCount.toLocaleString()} attachments across{' '}
                {readyArchives.length} ready archive
                {readyArchives.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <div className="trust-metrics">
            <div className="metric">
              <strong>{indexedMessageCount.toLocaleString()}</strong>
              <span>messages indexed</span>
            </div>
            <div className="metric">
              <strong>{formatBytes(storageInfo?.totalIndexBytes ?? 0)}</strong>
              <span>local storage</span>
            </div>
          </div>

          <div className="trust-list">
            <div>Indexes stay on this machine.</div>
            <div>Source mail is never modified.</div>
            <div>Exports only write the items you choose.</div>
          </div>

          {storageInfo ? (
            <div className="panel-actions">
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
                Clear indexes
              </button>
            </div>
          ) : null}
        </section>

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

        <section className="archive-panel">
          <div className="panel-section-header">
            <div>
              <div className="section-title">Archive scope</div>
              <div className="panel-caption">
                {readyArchives.length} ready, {indexingArchives.length} indexing
              </div>
            </div>
            {filters.archiveIds.length > 0 ? (
              <span className="status-chip">
                {filters.archiveIds.length} selected
              </span>
            ) : null}
          </div>

          <div className="archive-list">
            {archives.length === 0 ? (
              <EmptyState
                title="No local archive index"
                body="Import one or more .mbox files to start recovering attachments."
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
        </section>
      </aside>

      <main className="workspace">
        <section className="search-panel panel">
          <div className="search-bar-row">
            <label className="search-box">
              <span className="sr-only">Search indexed mail</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a filename, sender, subject, or phrase near the file"
              />
            </label>
            <button
              className="secondary-button"
              onClick={() => setShowRefinements((value) => !value)}
              type="button"
            >
              {showRefinements || activeFilterCount > 0
                ? 'Hide filters'
                : 'Filter'}
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

          <div className="search-status-row">
            <div className="search-status-primary">
              {isSearching
                ? 'Refreshing matches…'
                : `${indexedAttachmentCount.toLocaleString()} indexed attachments · ${indexedMessageCount.toLocaleString()} messages`}
            </div>
            <div className="search-status-secondary">
              Shortcuts: <code>from:</code> <code>has:attachment</code>{' '}
              <code>after:</code> <code>before:</code> <code>filename:</code>{' '}
              <code>filetype:</code>
            </div>
          </div>

          <div
            className={`search-mode-banner ${
              attachmentSearchMode ? 'search-mode-banner-attachment' : ''
            }`}
          >
            <strong>
              {attachmentSearchMode
                ? 'Attachment-first search'
                : 'Mixed message search'}
            </strong>
            <span>{resultModeCopy}</span>
          </div>

          {showRefinements || activeFilterCount > 0 ? (
            <div className="refinement-grid">
              <label className="field">
                <span>Sender</span>
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
              <label className="checkbox-row">
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
            {filterChips.length > 0 ? (
              filterChips.map((chip) => (
                <span key={chip} className="filter-chip">
                  {chip}
                </span>
              ))
            ) : (
              <span className="search-hint">
                Start broad. Add filters only when the result set is noisy.
              </span>
            )}
          </div>
        </section>

        <section className="content-grid">
          <section className="results-panel panel">
            <div className="panel-header">
              <div>
                <div className="section-title">Matches</div>
                <div className="panel-subtitle">
                  {results.length.toLocaleString()} result
                  {results.length === 1 ? '' : 's'} ·{' '}
                  {attachmentSearchMode
                    ? 'ranked for likely attachment recovery'
                    : 'ranked across message text and attachment names'}
                </div>
              </div>
            </div>

            <div className="panel-body">
              {results.length === 0 ? (
                <div className="panel-empty">
                  <EmptyState
                    title={
                      readyArchives.length === 0
                        ? 'Import an archive to begin'
                        : attachmentSearchMode
                          ? 'No attachment matches yet'
                          : 'No matching mail yet'
                    }
                    body={
                      readyArchives.length === 0
                        ? 'Liferaft only searches local indexes. Import an .mbox archive first.'
                        : attachmentSearchMode
                          ? 'Try a broader filename, remove a filter, or search the sender or subject around the file.'
                          : 'Try a broader search, narrow the archive scope, or use attachment-focused terms like filename: or filetype:.'
                    }
                  />
                </div>
              ) : (
                <Virtuoso
                  data={results}
                  itemContent={(index, result) => (
                    <MessageRow
                      key={result.resultId}
                      message={result}
                      selected={selectedMessage?.resultId === result.resultId}
                      isBestMatch={index === 0}
                      attachmentSearchMode={attachmentSearchMode}
                      onSelect={() => void selectMessage(result)}
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
                <div className="section-title">Verify and export</div>
                <div className="panel-subtitle">
                  Confirm provenance first, then export the exact file.
                </div>
              </div>
            </div>

            {isLoadingPreview ? (
              <div className="panel-empty">Loading message evidence…</div>
            ) : preview ? (
              <div className="preview-layout">
                {exportNotice ? (
                  <div className="export-notice">{exportNotice}</div>
                ) : null}

                {selectedAttachment ? (
                  <AttachmentFocusCard
                    attachment={selectedAttachment}
                    archiveId={preview.archiveId}
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
                ) : preview.attachments.length > 0 ? (
                  <div className="attachment-focus-card">
                    <div className="attachment-focus-header">
                      <div>
                        <div className="eyebrow">Message evidence</div>
                        <div className="attachment-focus-title">
                          {preview.attachments.length} attachment
                          {preview.attachments.length === 1 ? '' : 's'} in this
                          message
                        </div>
                      </div>
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
                        type="button"
                      >
                        Export all
                      </button>
                    </div>
                    <div className="attachment-focus-meta">
                      Open an attachment below to inspect it before export.
                    </div>
                  </div>
                ) : (
                  <div className="attachment-focus-card attachment-focus-empty">
                    <div className="attachment-focus-title">
                      No attachments in this message
                    </div>
                    <div className="attachment-focus-meta">
                      You can still export the message as an <code>.eml</code>{' '}
                      file for record keeping.
                    </div>
                  </div>
                )}

                <div className="evidence-grid">
                  <div className="evidence-panel">
                    <div className="section-title">Provenance</div>
                    <dl className="metadata-grid">
                      {selectedAttachment ? (
                        <>
                          <dt>Attachment</dt>
                          <dd>
                            {selectedAttachment.filename ||
                              'Unnamed attachment'}
                          </dd>
                          <dt>Type</dt>
                          <dd>
                            {simplifyContentType(
                              selectedAttachment.contentType
                            )}{' '}
                            · {formatBytes(selectedAttachment.sizeEstimate)}
                          </dd>
                        </>
                      ) : null}
                      <dt>Subject</dt>
                      <dd>{preview.subject || '(no subject)'}</dd>
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
                        {preview.date
                          ? formatDate(preview.date)
                          : 'Unknown date'}
                      </dd>
                      <dt>Archive</dt>
                      <dd>{preview.archiveName}</dd>
                    </dl>
                  </div>

                  <div className="evidence-panel evidence-actions">
                    <div className="section-title">Export</div>
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
                    <div className="panel-caption">
                      Exports create copies only. Indexed source mail is never
                      changed.
                    </div>
                  </div>
                </div>

                <div className="preview-content-grid">
                  <aside className="attachment-rail">
                    <div className="attachment-rail-header">
                      <div>
                        <div className="section-title">
                          Attachments in message
                        </div>
                        <div className="panel-caption">
                          Select a file to verify before export.
                        </div>
                      </div>
                    </div>
                    <div className="attachment-list">
                      {orderedAttachments.length === 0 ? (
                        <div className="attachment-empty">
                          No attachments in this message.
                        </div>
                      ) : (
                        orderedAttachments.map((attachment) => (
                          <AttachmentListItem
                            key={attachment.id}
                            attachment={attachment}
                            archiveId={preview.archiveId}
                            selected={attachment.id === focusedAttachmentId}
                            onSelect={(attachmentId) =>
                              setFocusedAttachmentId(attachmentId)
                            }
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
                  </aside>

                  <div className="message-panel">
                    <div className="message-panel-header">
                      <div>
                        <div className="section-title">Message preview</div>
                        <div className="panel-caption">
                          Use the body only to confirm context around the file.
                        </div>
                      </div>
                      <div className="segmented-group">
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
                    </div>
                    <div className="message-surface">
                      <MessageBody
                        mode={previewMode}
                        html={preview.html}
                        text={preview.text}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="panel-empty">
                <EmptyState
                  title="Select a result to verify it"
                  body="Open a likely match to inspect the message, confirm provenance, and export the exact attachment."
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
  const liveAttachmentCount =
    archive.status === 'indexing'
      ? (progress?.attachmentsProcessed ?? archive.attachmentCount)
      : archive.attachmentCount

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
      <div className="archive-card-row">
        <div
          className={`archive-toggle ${selected ? 'archive-toggle-selected' : ''}`}
        />
        <div className="archive-card-main">
          <div className="archive-card-header">
            <div className="archive-name">{archive.name}</div>
            <div className={`status-chip status-${archive.status}`}>
              {archive.status}
            </div>
          </div>
          <div className="archive-stats">
            <span>{liveMessageCount.toLocaleString()} messages</span>
            <span>{liveAttachmentCount.toLocaleString()} attachments</span>
            <span>{formatBytes(archive.indexSizeBytes)}</span>
          </div>
          <div className="archive-path">{archive.sourcePath}</div>
        </div>
      </div>

      {progress && archive.status === 'indexing' ? (
        <div className="archive-progress">
          <div className="progress-copy">
            <span>{percent}% indexed</span>
            <span>{formatEta(progress.etaSeconds)}</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="progress-copy">
            <span>{progress.currentFile || 'Scanning archive'}</span>
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
            Cancel import
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
        <div className="archive-error">{archive.lastError}</div>
      ) : null}
    </div>
  )
}

function MessageRow({
  message,
  selected,
  isBestMatch,
  attachmentSearchMode,
  onSelect,
  onExportAttachment
}: {
  message: SearchResultRow
  selected: boolean
  isBestMatch: boolean
  attachmentSearchMode: boolean
  onSelect: () => void
  onExportAttachment: (archiveId: string, attachmentId: number) => void
}) {
  const title =
    message.kind === 'attachment'
      ? (message.attachmentFilename ?? 'Unnamed attachment')
      : message.subject || '(no subject)'

  return (
    <div
      className={`result-row ${selected ? 'result-row-selected' : ''}`}
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
      <div className="result-row-head">
        <div className="result-row-main">
          <div className="result-row-badges">
            {isBestMatch ? (
              <span className="result-badge result-badge-strong">
                Best match
              </span>
            ) : null}
            <span className="result-badge">
              {message.kind === 'attachment' ? 'Attachment' : 'Message'}
            </span>
            {message.kind === 'attachment' && message.attachmentContentType ? (
              <span className="result-badge result-badge-subtle">
                {simplifyContentType(message.attachmentContentType)}
              </span>
            ) : null}
            {attachmentSearchMode &&
            message.kind === 'message' &&
            message.hasAttachments ? (
              <span className="result-badge result-badge-subtle">
                Contains attachments
              </span>
            ) : null}
          </div>

          <div className="result-row-title">{title}</div>

          <div className="result-row-subtitle">
            {message.kind === 'attachment'
              ? `In message: ${message.subject || '(no subject)'}`
              : message.fromText || 'Unknown sender'}
          </div>
        </div>

        <div className="result-row-side">
          <div>
            {message.date ? formatCompactDate(message.date) : 'Unknown date'}
          </div>
          <div>{message.archiveName}</div>
          {message.kind === 'attachment' &&
          message.attachmentSizeEstimate != null ? (
            <div>{formatBytes(message.attachmentSizeEstimate)}</div>
          ) : null}
        </div>
      </div>

      <div className="result-row-meta">
        {message.fromText ? <span>From {message.fromText}</span> : null}
        {message.toText ? <span>To {message.toText}</span> : null}
        {message.kind === 'attachment' && message.attachmentFilename ? (
          <span className="result-row-archive">
            Archive {message.archiveName}
          </span>
        ) : null}
      </div>

      <div
        className="result-row-snippet"
        dangerouslySetInnerHTML={{
          __html: message.snippet
            ? formatSnippetHtml(message.snippet)
            : 'No surrounding text captured.'
        }}
      />

      {message.kind === 'attachment' && message.attachmentId != null ? (
        <div className="result-row-actions">
          <button
            className="inline-action"
            onClick={(event) => {
              event.stopPropagation()
              onExportAttachment(message.archiveId, message.attachmentId!)
            }}
            type="button"
          >
            Export attachment
          </button>
        </div>
      ) : null}
    </div>
  )
}

function AttachmentFocusCard({
  archiveId,
  attachment,
  onExport
}: {
  archiveId: string
  attachment: AttachmentSummary
  onExport: (archiveId: string, attachmentId: number) => void
}) {
  return (
    <div className="attachment-focus-card">
      <div className="attachment-focus-header">
        <div>
          <div className="eyebrow">Selected attachment</div>
          <div className="attachment-focus-title">
            {attachment.filename || 'Unnamed attachment'}
          </div>
        </div>
        <button
          className="primary-button"
          onClick={() => onExport(archiveId, attachment.id)}
          type="button"
        >
          Export attachment
        </button>
      </div>

      <div className="attachment-focus-meta">
        <span>{simplifyContentType(attachment.contentType)}</span>
        <span>{formatBytes(attachment.sizeEstimate)}</span>
      </div>
    </div>
  )
}

function AttachmentListItem({
  archiveId,
  attachment,
  selected,
  onSelect,
  onExport
}: {
  archiveId: string
  attachment: AttachmentSummary
  selected: boolean
  onSelect: (attachmentId: number) => void
  onExport: (archiveId: string, attachmentId: number) => void
}) {
  return (
    <div
      className={`attachment-list-item ${
        selected ? 'attachment-list-item-selected' : ''
      }`}
      onClick={() => onSelect(attachment.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(attachment.id)
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="attachment-list-item-title">
        {attachment.filename || 'Unnamed attachment'}
      </div>
      <div className="attachment-list-item-meta">
        <span>{simplifyContentType(attachment.contentType)}</span>
        <span>{formatBytes(attachment.sizeEstimate)}</span>
      </div>
      <button
        className="inline-action"
        onClick={(event) => {
          event.stopPropagation()
          onExport(archiveId, attachment.id)
        }}
        type="button"
      >
        Export
      </button>
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-body">{body}</div>
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
          ? `Archive ${selectedArchives[0]}`
          : `${selectedArchives.length} archives`
      )
    }
  }

  if (filters.sender.trim()) {
    chips.push(`Sender ${filters.sender.trim()}`)
  }

  if (filters.dateFrom) {
    chips.push(`After ${filters.dateFrom}`)
  }

  if (filters.dateTo) {
    chips.push(`Before ${filters.dateTo}`)
  }

  if (filters.hasAttachments) {
    chips.push('Attachments only')
  }

  return chips
}

function simplifyContentType(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown type'
  }

  const normalized = value.split(';', 1)[0]?.trim().toLowerCase() ?? value

  if (normalized === 'application/pdf') {
    return 'PDF'
  }

  if (normalized === 'image/jpeg') {
    return 'JPEG image'
  }

  if (normalized === 'image/png') {
    return 'PNG image'
  }

  if (normalized.startsWith('image/')) {
    return `${normalized.replace('image/', '').toUpperCase()} image`
  }

  if (normalized === 'message/rfc822') {
    return 'Email message'
  }

  if (
    normalized ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'Word document'
  }

  if (normalized === 'application/msword') {
    return 'Word document'
  }

  if (
    normalized ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'Excel spreadsheet'
  }

  if (normalized === 'application/vnd.ms-excel') {
    return 'Excel spreadsheet'
  }

  if (normalized === 'text/csv') {
    return 'CSV'
  }

  if (normalized === 'application/zip') {
    return 'ZIP archive'
  }

  return normalized
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

function formatCompactDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium'
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
