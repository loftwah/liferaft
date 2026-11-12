import { create } from 'zustand'
import type {
  ArchiveSummary,
  ImportProgressEvent,
  LiferaftApi,
  MessagePreview,
  SearchFilters,
  SearchResultRow,
  StorageSummary
} from '@shared/contracts'
import { parseSearchInput } from '@shared/search'

interface StoreState {
  archives: ArchiveSummary[]
  results: SearchResultRow[]
  selectedMessage: SearchResultRow | null
  preview: MessagePreview | null
  storageInfo: StorageSummary | null
  uiError: string | null
  progress: Record<string, ImportProgressEvent>
  isLoadingArchives: boolean
  isMutatingArchives: boolean
  isSearching: boolean
  isLoadingPreview: boolean
  query: string
  filters: SearchFilters
  initialize: () => Promise<void>
  refreshArchives: () => Promise<void>
  refreshStorageInfo: () => Promise<void>
  setQuery: (query: string) => void
  patchFilters: (partial: Partial<SearchFilters>) => void
  resetFilters: () => void
  runSearch: () => Promise<void>
  selectMessage: (message: SearchResultRow | null) => Promise<void>
  beginImport: () => Promise<void>
  cancelImport: (archiveId: string) => Promise<void>
  deleteArchiveIndex: (archiveId: string) => Promise<void>
  reindexArchive: (archiveId: string) => Promise<void>
  clearAllArchiveIndexes: () => Promise<void>
  clearUiError: () => void
}

const defaultFilters: SearchFilters = {
  archiveIds: [],
  hasAttachments: false,
  sender: '',
  dateFrom: '',
  dateTo: ''
}

let importListenerBound = false
let previewRequestToken = 0
let searchRequestToken = 0

function getLiferaftApi(): LiferaftApi {
  if (window.liferaft) {
    return window.liferaft
  }

  throw new Error(
    'Desktop bridge unavailable. Restart Liferaft and try importing again.'
  )
}

function formatUiError(prefix: string, error: unknown): string {
  return error instanceof Error ? `${prefix}: ${error.message}` : prefix
}

export const useLiferaftStore = create<StoreState>((set, get) => ({
  archives: [],
  results: [],
  selectedMessage: null,
  preview: null,
  storageInfo: null,
  uiError: null,
  progress: {},
  isLoadingArchives: false,
  isMutatingArchives: false,
  isSearching: false,
  isLoadingPreview: false,
  query: '',
  filters: defaultFilters,
  initialize: async () => {
    try {
      const liferaft = getLiferaftApi()

      if (!importListenerBound) {
        liferaft.onImportProgress((event) => {
          set((state) => ({
            progress: {
              ...state.progress,
              [event.archiveId]: event
            }
          }))

          if (
            event.phase === 'completed' ||
            event.phase === 'failed' ||
            event.phase === 'cancelled'
          ) {
            void Promise.all([
              get().refreshArchives(),
              get().refreshStorageInfo()
            ])
              .then(() => get().runSearch())
              .catch((error) => {
                set({
                  uiError: formatUiError(
                    'Archive status could not be refreshed',
                    error
                  )
                })
              })
          }
        })
        importListenerBound = true
      }

      await get().refreshArchives()
      await get().refreshStorageInfo()
      await get().runSearch()
    } catch (error) {
      set({
        uiError: formatUiError('Liferaft failed to start', error),
        isLoadingArchives: false,
        isSearching: false,
        isLoadingPreview: false
      })
    }
  },
  refreshArchives: async () => {
    set({ isLoadingArchives: true })
    try {
      const archives = await getLiferaftApi().listArchives()
      set((state) => {
        const selectedIds = new Set(state.filters.archiveIds)
        const filteredIds = archives
          .filter((archive) => selectedIds.has(archive.id))
          .map((archive) => archive.id)
        return {
          archives,
          isLoadingArchives: false,
          filters: {
            ...state.filters,
            archiveIds: filteredIds
          }
        }
      })
    } finally {
      set({ isLoadingArchives: false })
    }
  },
  refreshStorageInfo: async () => {
    const storageInfo = await getLiferaftApi().getStorageInfo()
    set({ storageInfo })
  },
  setQuery: (query) => set({ query }),
  patchFilters: (partial) =>
    set((state) => ({
      filters: {
        ...state.filters,
        ...partial
      }
    })),
  resetFilters: () => set({ filters: defaultFilters }),
  clearUiError: () => set({ uiError: null }),
  runSearch: async () => {
    const requestToken = ++searchRequestToken
    set({ isSearching: true })
    try {
      const { query, filters } = get()
      const parsed = parseSearchInput(query)
      const mergedFilters = {
        ...filters,
        ...parsed.filters,
        sender: [filters.sender, parsed.filters.sender]
          .filter(Boolean)
          .join(' ')
          .trim(),
        hasAttachments:
          filters.hasAttachments || Boolean(parsed.filters.hasAttachments),
        dateFrom: parsed.filters.dateFrom ?? filters.dateFrom,
        dateTo: parsed.filters.dateTo ?? filters.dateTo
      }
      const results = await getLiferaftApi().searchMessages({
        text: parsed.text,
        filters: mergedFilters,
        preferAttachments:
          parsed.preferAttachments ||
          (mergedFilters.hasAttachments && parsed.text.trim().length > 0),
        limit: 300
      })
      if (requestToken !== searchRequestToken) return
      set((state) => ({
        results,
        isSearching: false,
        selectedMessage:
          results.find(
            (row) => row.resultId === state.selectedMessage?.resultId
          ) ??
          results[0] ??
          null
      }))
      await get().selectMessage(get().selectedMessage)
    } catch (error) {
      if (requestToken !== searchRequestToken) return
      ++previewRequestToken
      set({
        results: [],
        selectedMessage: null,
        preview: null,
        isSearching: false,
        isLoadingPreview: false,
        uiError: formatUiError('Search could not finish', error)
      })
    }
  },
  selectMessage: async (message) => {
    const requestToken = ++previewRequestToken
    set({
      selectedMessage: message,
      preview: null,
      isLoadingPreview: Boolean(message)
    })
    if (!message) return
    try {
      const preview = await getLiferaftApi().loadMessagePreview(
        message.archiveId,
        message.id,
        message.indexRevision
      )
      if (requestToken !== previewRequestToken) return
      set({ preview, isLoadingPreview: false })
    } catch (error) {
      if (requestToken !== previewRequestToken) return
      set({
        preview: null,
        isLoadingPreview: false,
        uiError: formatUiError('The message could not be opened', error)
      })
    }
  },
  beginImport: async () => {
    set({ uiError: null })

    try {
      const selected = await getLiferaftApi().selectMboxFiles()
      if (selected.length === 0) {
        return
      }

      await getLiferaftApi().startImport(selected)
      await get().refreshArchives()
      await get().refreshStorageInfo()
    } catch (error) {
      set({
        uiError: formatUiError('Import failed', error)
      })
    }
  },
  cancelImport: async (archiveId) => {
    try {
      await getLiferaftApi().cancelImport(archiveId)
    } catch (error) {
      set({ uiError: formatUiError('Indexing could not be cancelled', error) })
    }
  },
  deleteArchiveIndex: async (archiveId) => {
    set({ isMutatingArchives: true, uiError: null })

    try {
      await getLiferaftApi().deleteArchiveIndex(archiveId)
      set((state) => {
        const nextProgress = { ...state.progress }
        delete nextProgress[archiveId]
        return {
          progress: nextProgress,
          preview:
            state.preview?.archiveId === archiveId ? null : state.preview,
          selectedMessage:
            state.selectedMessage?.archiveId === archiveId
              ? null
              : state.selectedMessage
        }
      })
      await get().refreshArchives()
      await get().refreshStorageInfo()
      await get().runSearch()
    } catch (error) {
      set({
        uiError: formatUiError('Could not remove local archive index', error)
      })
    } finally {
      set({ isMutatingArchives: false })
    }
  },
  reindexArchive: async (archiveId) => {
    const archive = get().archives.find((entry) => entry.id === archiveId)
    if (!archive) {
      return
    }

    set({ isMutatingArchives: true, uiError: null })

    try {
      await getLiferaftApi().startImport([archive.sourcePath])
      await get().refreshArchives()
      await get().refreshStorageInfo()
    } catch (error) {
      set({
        uiError: formatUiError('Could not restart indexing', error)
      })
    } finally {
      set({ isMutatingArchives: false })
    }
  },
  clearAllArchiveIndexes: async () => {
    const archiveIds = get().archives.map((archive) => archive.id)
    if (archiveIds.length === 0) {
      return
    }

    set({ isMutatingArchives: true, uiError: null })

    try {
      for (const archiveId of archiveIds) {
        await getLiferaftApi().deleteArchiveIndex(archiveId)
      }

      set({
        progress: {},
        preview: null,
        selectedMessage: null
      })
      await get().refreshArchives()
      await get().refreshStorageInfo()
      await get().runSearch()
    } catch (error) {
      set({
        uiError: formatUiError('Could not clear local archive indexes', error)
      })
    } finally {
      set({ isMutatingArchives: false })
    }
  }
}))
