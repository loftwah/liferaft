const electron =
  require('electron/renderer') as typeof import('electron/renderer')

export const { contextBridge, ipcRenderer } = electron
