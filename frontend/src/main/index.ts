import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { app, BrowserWindow, ipcMain, shell } from 'electron'

const BACKEND_HOST = process.env.VIDGNOST_BACKEND_HOST ?? '127.0.0.1'
const BACKEND_PORT = Number.parseInt(process.env.VIDGNOST_BACKEND_PORT ?? '8000', 10)
const API_BASE = process.env.VIDGNOST_API_BASE ?? `http://${BACKEND_HOST}:${BACKEND_PORT}/api`
const HEALTH_ENDPOINT = `${API_BASE}/health`
const BACKEND_BOOT_TIMEOUT_MS = Number.parseInt(process.env.VIDGNOST_BACKEND_BOOT_TIMEOUT_MS ?? '30000', 10)
const BACKEND_BOOT_POLL_MS = 800
const APP_NAME = 'VidGnost'
const USER_DATA_DIR = join(app.getPath('appData'), APP_NAME)

let backendProcess: ChildProcess | null = null
let backendSpawnAttempted = false

function wait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })
}

async function isBackendReady(): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    const response = await fetch(HEALTH_ENDPOINT, {
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function resolveBackendDir(): string {
  const override = process.env.VIDGNOST_BACKEND_DIR?.trim()
  if (override) {
    return resolve(override)
  }
  return resolve(process.cwd(), '..', 'backend')
}

function spawnBackendProcess(): void {
  if (backendProcess || backendSpawnAttempted) return
  backendSpawnAttempted = true
  const backendDir = resolveBackendDir()
  const pyprojectPath = join(backendDir, 'pyproject.toml')
  if (!existsSync(pyprojectPath)) {
    console.warn(`[vidgnost-electron] backend pyproject.toml not found at ${pyprojectPath}`)
    return
  }

  const args = ['run', 'uvicorn', 'app.main:app', '--host', BACKEND_HOST, '--port', String(BACKEND_PORT)]
  const child = spawn('uv', args, {
    cwd: backendDir,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk) => {
    const message = chunk.toString().trim()
    if (message) {
      console.log(`[backend] ${message}`)
    }
  })
  child.stderr?.on('data', (chunk) => {
    const message = chunk.toString().trim()
    if (message) {
      console.warn(`[backend] ${message}`)
    }
  })
  child.on('exit', (code, signal) => {
    console.warn(`[vidgnost-electron] backend exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
    if (backendProcess === child) {
      backendProcess = null
    }
  })
  backendProcess = child
}

async function ensureBackendReady(): Promise<void> {
  if (process.env.VIDGNOST_SKIP_BACKEND_BOOTSTRAP === '1') {
    return
  }
  if (await isBackendReady()) {
    return
  }
  spawnBackendProcess()
  const deadline = Date.now() + BACKEND_BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isBackendReady()) {
      return
    }
    await wait(BACKEND_BOOT_POLL_MS)
  }
  console.warn('[vidgnost-electron] backend did not become healthy before timeout')
}

function stopBackendProcess(): void {
  if (!backendProcess) {
    return
  }
  try {
    backendProcess.kill('SIGTERM')
  } catch {
    // ignore process kill errors during shutdown
  } finally {
    backendProcess = null
  }
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: 'VidGnost',
    backgroundColor: '#f5f6f8',
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  let didShowWindow = false
  const showWindowSafely = () => {
    if (didShowWindow || window.isDestroyed()) return
    didShowWindow = true
    window.show()
  }
  window.once('ready-to-show', showWindowSafely)
  window.webContents.once('did-finish-load', showWindowSafely)
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.warn(`[vidgnost-electron] renderer load failed code=${code} url=${url} description=${description}`)
    showWindowSafely()
  })
  const forceShowTimer = setTimeout(() => {
    if (!didShowWindow) {
      console.warn('[vidgnost-electron] force showing window after startup timeout')
      showWindowSafely()
    }
  }, 4000)
  window.on('closed', () => {
    clearTimeout(forceShowTimer)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.setName(APP_NAME)
app.setPath('userData', USER_DATA_DIR)
app.commandLine.appendSwitch('disk-cache-dir', join(USER_DATA_DIR, 'Cache'))

app.whenReady().then(async () => {
  ipcMain.handle('vidgnost:get-api-base', () => API_BASE)
  ipcMain.handle('vidgnost:open-external', async (_event, rawUrl: string) => {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false
    try {
      await shell.openExternal(rawUrl)
      return true
    } catch {
      return false
    }
  })

  await ensureBackendReady()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on('before-quit', () => {
  stopBackendProcess()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
