import { createRequire } from 'node:module'

type ElectronModule = typeof import('electron/main')
type ElectronShellModule = Pick<typeof import('electron'), 'shell'>

const electron = createRequire(import.meta.url)(
  'electron/main'
) as ElectronModule
const electronShell = createRequire(import.meta.url)(
  'electron'
) as ElectronShellModule

export const { app, BrowserWindow, dialog, ipcMain, utilityProcess } = electron
export const { shell } = electronShell
