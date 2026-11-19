import fs from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, Menu, app, nativeTheme, shell } from 'electron'
import squirrel from 'electron-squirrel-startup'
import { desktopName } from './app-name'
import { registerSelectionMenu } from './backend/context-menu'
import { dataPath, useTestDataDirectory } from './backend/data-directory'
import { createDiagnosticLogger } from './backend/diagnostics'
import { functionalCheck } from './backend/functional-check'
import { registerIpc } from './backend/ipc'
import { startMapServer } from './backend/map-server'
import * as store from './backend/store'
import { verify, verifyExtra } from './backend/verify'
import { verifyAccount } from './backend/verify-account'
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string
declare const MAIN_WINDOW_VITE_NAME: string
if (squirrel) {
  app.quit()
}
app.setName('TravelAgent')
const logError = createDiagnosticLogger(() => dataPath('logs', 'main.log'), store.redact)
let win: BrowserWindow
async function loadRenderer(window: BrowserWindow) {
  const devURL = MAIN_WINDOW_VITE_DEV_SERVER_URL
  const target = devURL || path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (devURL) {
        const entryURL = new URL('/src/renderer/main.tsx', devURL).href
        // oxlint-disable-next-line no-await-in-loop -- Warm the Vite entry before navigation.
        const entry = await fetch(entryURL, { signal: AbortSignal.timeout(10_000) })
        if (!entry.ok) throw new Error(`渲染入口返回 ${entry.status}`)
        // oxlint-disable-next-line no-await-in-loop -- Renderer startup retries are deliberately sequential.
        await window.loadURL(devURL)
      } else {
        // oxlint-disable-next-line no-await-in-loop -- Renderer startup retries are deliberately sequential.
        await window.loadFile(target)
      }
      return
    } catch (error) {
      logError('Renderer load:', attempt + 1, error)
      if (attempt === 3) throw error
      // oxlint-disable-next-line no-await-in-loop -- Backoff belongs to the current retry attempt.
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
}
app.whenReady().then(async () => {
  if (process.argv.includes('--functional-check')) {
    const isolated = await fs.mkdtemp(path.join(app.getPath('temp'), 'travelagent-functional-'))
    useTestDataDirectory(isolated)
  }
  if (process.argv.includes('--verify-account')) {
    const isolated = path.resolve('.local/verify-account-profile')
    useTestDataDirectory(isolated)
    await store.initStore()
    await verifyAccount()
    app.quit()
    return
  }
  await store.initStore()

  if (process.argv.includes('--functional-check')) {
    const exitCode = await functionalCheck()
    app.exit(exitCode)
    return
  }
  if (process.argv.includes('--verify-extra')) {
    await verifyExtra()
    app.quit()
    return
  }
  if (process.argv.includes('--verify')) {
    await verify()
    app.quit()
    return
  }
  nativeTheme.themeSource = store.settings().theme
  const mapConfig = await startMapServer(
    MAIN_WINDOW_VITE_DEV_SERVER_URL ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin : 'null',
  )
  Menu.setApplicationMenu(null)
  win = new BrowserWindow({
    backgroundColor: '#ffffff',
    frame: false,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(app.getAppPath(), 'assets/icon.png'),
    height: 900,
    minHeight: 640,
    minWidth: 980,
    title: desktopName,
    webPreferences: {
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
    },
    width: 1360,
  })
  const updateWindowState = () => win.webContents.send('window:state', win.isMaximized())
  win.on('maximize', updateWindowState)
  win.on('unmaximize', updateWindowState)
  win.webContents.on('preload-error', (_event, _path, error) => logError('Preload:', error))
  win.webContents.on('console-message', ({ level, message }) => {
    if (level === 'warning' || level === 'error') {
      logError('Renderer:', message)
    }
  })
  win.webContents.on('did-fail-load', (_event, code, description) =>
    logError('Load:', code, description),
  )
  let rendererRecovery = 0
  win.webContents.on('did-finish-load', () => {
    const attempt = rendererRecovery
    setTimeout(() => {
      if (win.isDestroyed() || attempt !== rendererRecovery) return
      void win.webContents
        .executeJavaScript("Boolean(document.querySelector('#boot-status'))", true)
        .then((stuck) => {
          if (!stuck || win.isDestroyed()) return
          rendererRecovery += 1
          logError('Renderer remained on startup screen; retrying', rendererRecovery)
          if (rendererRecovery <= 2) win.webContents.reloadIgnoringCache()
        })
        .catch((error) => logError('Renderer watchdog:', error))
    }, 1500)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      void shell.openExternal(url)
    }
    return {
      action: 'deny',
    }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  registerSelectionMenu(win)
  registerIpc(win, mapConfig)
  await loadRenderer(win)
})
process.on('unhandledRejection', (error: unknown) => {
  logError('Unhandled rejection:', error)
  app.exit(1)
})
app.on('window-all-closed', () => app.quit())
