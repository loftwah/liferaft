import type { ImportProgressEvent, LiferaftApi } from '@shared/contracts'
import { contextBridge, ipcRenderer } from './electron-runtime'

const api: LiferaftApi = {
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
  loadMessagePreview: (archiveId: string, messageId: number) =>
    ipcRenderer.invoke('liferaft:load-message-preview', archiveId, messageId),
  exportAttachment: (archiveId: string, attachmentId: number) =>
    ipcRenderer.invoke('liferaft:export-attachment', archiveId, attachmentId),
  exportAllAttachments: (archiveId: string, messageId: number) =>
    ipcRenderer.invoke('liferaft:export-all-attachments', archiveId, messageId),
  exportMessage: (archiveId: string, messageId: number) =>
    ipcRenderer.invoke('liferaft:export-message', archiveId, messageId),
  revealPath: (targetPath: string) =>
    ipcRenderer.invoke('liferaft:reveal-path', targetPath),
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
