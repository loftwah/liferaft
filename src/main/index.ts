import path from 'node:path'
import type { BrowserWindow as ElectronBrowserWindow } from 'electron'
import { CatalogStore } from './catalog'
import { ArchiveDatabasePool } from './archive-db'
import { app, BrowserWindow } from './electron-runtime'
import { registerIpc } from './ipc'

let mainWindow: ElectronBrowserWindow | null = null
let disposeIpc: (() => void) | null = null
const databasePool = new ArchiveDatabasePool()

app.setPath('userData', path.join(app.getPath('appData'), 'liferaft'))

function createWindow(): ElectronBrowserWindow {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: '#d7ddd8',
    title: 'Liferaft',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  window.setTitle('Liferaft')
  window.removeMenu()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false)
    }
  )

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  const catalog = new CatalogStore()
  mainWindow = createWindow()
  disposeIpc = registerIpc(mainWindow, catalog, databasePool)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  disposeIpc?.()
  databasePool.closeAll()
})
