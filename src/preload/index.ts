import type { ImportProgressEvent, LiferaftApi } from '@shared/contracts'
import { contextBridge, ipcRenderer } from './electron-runtime'

const api: LiferaftApi = {
  getAgentAccess: () => ipcRenderer.invoke('liferaft:agent-access'),
  enableAgentAccess: (archiveIds) =>
    ipcRenderer.invoke('liferaft:enable-agent-access', archiveIds),
  revokeAgentAccess: () => ipcRenderer.invoke('liferaft:revoke-agent-access'),
  selectMboxFiles: () => ipcRenderer.invoke('liferaft:select-mbox-files'),
  startImport: (paths: string[]) =>
    ipcRenderer.invoke('liferaft:start-import', paths),
  cancelImport: (archiveId: string) =>
    ipcRenderer.invoke('liferaft:cancel-import', archiveId),
  deleteArchiveIndex: (archiveId: string) =>
    ipcRenderer.invoke('liferaft:delete-archive-index', archiveId),
  listArchives: () => ipcRenderer.invoke('liferaft:list-archives'),
  getStorageInfo: () => ipcRenderer.invoke('liferaft:get-storage-info'),
  searchMessages: (query) => ipcRenderer.invoke('liferaft:search', query),
  loadMessagePreview: (archiveId, messageId, indexRevision) =>
    ipcRenderer.invoke(
      'liferaft:load-message-preview',
      archiveId,
      messageId,
      indexRevision
    ),
  exportAttachment: (archiveId, attachmentId, indexRevision) =>
    ipcRenderer.invoke(
      'liferaft:export-attachment',
      archiveId,
      attachmentId,
      indexRevision
    ),
  exportAllAttachments: (archiveId, messageId, indexRevision) =>
    ipcRenderer.invoke(
      'liferaft:export-all-attachments',
      archiveId,
      messageId,
      indexRevision
    ),
  exportMessage: (archiveId, messageId, indexRevision) =>
    ipcRenderer.invoke(
      'liferaft:export-message',
      archiveId,
      messageId,
      indexRevision
    ),
  revealPath: (targetPath: string) =>
    ipcRenderer.invoke('liferaft:reveal-path', targetPath),
  onShutdownPending: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      notice: string | null
    ) => {
      listener(notice)
    }
    ipcRenderer.on('liferaft:shutdown-pending', wrapped)
    return () =>
      ipcRenderer.removeListener('liferaft:shutdown-pending', wrapped)
  },
  onImportProgress: (listener: (event: ImportProgressEvent) => void) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: ImportProgressEvent
    ) => {
      listener(payload)
    }

    ipcRenderer.on('liferaft:import-progress', wrapped)
    return () => {
      ipcRenderer.removeListener('liferaft:import-progress', wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('liferaft', api)

declare global {
  interface Window {
    liferaft: LiferaftApi
  }
}
