import path from 'node:path'
import type { BrowserWindow as ElectronBrowserWindow } from 'electron'
import appIconPath from '../renderer/assets/icons/liferaft-icon-512.png?asset'
import { CatalogStore } from './catalog'
import { ArchiveDatabasePool } from './archive-db'
import { app, BrowserWindow, dialog, nativeImage } from './electron-runtime'
import { registerIpc } from './ipc'
import { AgentAccessStore } from '../mcp/access'
import { startMcpServer } from '../mcp/server'

let mainWindow: ElectronBrowserWindow | null = null
let disposeIpc: (() => Promise<void>) | null = null
let catalog: CatalogStore | null = null
const mcpMode = process.argv.includes('--mcp')
const databasePool = new ArchiveDatabasePool({ readonly: mcpMode })
let mcpServer: ReturnType<typeof startMcpServer> | null = null
let shutdown: Promise<void> | null = null
let shutdownComplete = false
const appIcon = nativeImage.createFromPath(appIconPath)

app.setPath('userData', path.join(app.getPath('appData'), 'liferaft'))

if (mcpMode) {
  app.disableHardwareAcceleration()
  // The protocol owns stdout; Electron/Chromium diagnostics stay on stderr.
  console.log = (...args) => console.error(...args)
}

function createWindow(): ElectronBrowserWindow {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: '#d7ddd8',
    title: 'Liferaft',
    icon: appIcon.isEmpty() ? undefined : appIcon,
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

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  return window
}

if (!mcpMode && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app
    .whenReady()
    .then(() => {
      catalog = new CatalogStore({ readonly: mcpMode })
      const access = new AgentAccessStore(app.getPath('userData'))
      if (mcpMode) {
        app.dock?.hide()
        mcpServer = startMcpServer({
          catalog,
          pool: databasePool,
          access,
          version: app.getVersion(),
          onClose: () => app.quit()
        })
        return
      }
      if (process.platform === 'darwin' && !appIcon.isEmpty())
        app.dock?.setIcon(appIcon)
      mainWindow = createWindow()
      disposeIpc = registerIpc(() => mainWindow, catalog, databasePool, access)
      app.on('activate', () => {
        if (!mainWindow) mainWindow = createWindow()
      })
      app.on('second-instance', () => {
        if (!mainWindow) mainWindow = createWindow()
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
      })
    })
    .catch(() => {
      console.error(
        mcpMode
          ? 'Liferaft could not start agent access. Open the desktop app, index an archive and review Agent access first.'
          : 'Liferaft could not start. Check that its local data folder is available.'
      )
      app.exit(1)
    })
}

app.on('window-all-closed', () => {
  if (!mcpMode && process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  if (shutdown) return
  shutdown = (async () => {
    // The MCP close drains exports and removes their temporary files before it
    // returns. Desktop disposal waits for owned importers to exit before unlink.
    await mcpServer?.close()
    await disposeIpc?.()
    disposeIpc = null
    databasePool.closeAll()
    catalog?.close()
    catalog = null
    shutdownComplete = true
    app.quit()
  })().catch(() => {
    shutdown = null
    if (mcpMode) {
      console.error(
        'Liferaft could not finish agent cleanup. Check its local data folder before restarting.'
      )
      app.exit(1)
      return
    }
    if (!mainWindow) mainWindow = createWindow()
    dialog.showErrorBox(
      'Liferaft is still finishing an import',
      'An importer or its local index could not be cleaned up. Leave Liferaft open, close other connected agents, and try removing the failed local index or quitting again. Original archives have not been deleted.'
    )
  })
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => app.quit())
}
