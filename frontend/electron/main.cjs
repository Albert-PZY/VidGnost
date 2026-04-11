const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } = require("electron")
const fs = require("node:fs")
const path = require("node:path")

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173"
const PRELOAD_PATH = path.join(__dirname, "preload.cjs")
const SPLASH_PRELOAD_PATH = path.join(__dirname, "splash-preload.cjs")
const SPLASH_HTML_PATH = path.join(__dirname, "splash.html")
const APP_ICON_SVG_PATH = path.join(__dirname, "..", "public", "icon.svg")
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"])
const STARTUP_FAILSAFE_MS = 45_000
const STARTUP_MIN_SPLASH_MS = 1_400
const allowedToClose = new WeakSet()
const IMAGE_MIME_TYPES = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}

let mainWindow = null
let splashWindow = null
let startupStartAt = 0
let startupMarkedComplete = false
let mainWindowCanReveal = false
let startupFailsafeTimer = null
let splashState = {
  progress: 6,
  title: "正在启动 VidGnost",
  message: "正在创建启动上下文",
  detail: "准备应用窗口、图标与基础运行环境。",
}

function loadAppIcon() {
  try {
    const svgContent = fs.readFileSync(APP_ICON_SVG_PATH, "utf8")
    const embeddedPngMatch = svgContent.match(/(?:xlink:href|href)="(data:image\/png;base64,[^"]+)"/i)
    if (embeddedPngMatch) {
      const [prefix, payload = ""] = embeddedPngMatch[1].split(",", 2)
      const iconFromDataUrl = nativeImage.createFromDataURL(`${prefix},${payload.replace(/\s+/g, "")}`)
      if (!iconFromDataUrl.isEmpty()) {
        return iconFromDataUrl
      }
    }

    const iconFromSvg = nativeImage.createFromPath(APP_ICON_SVG_PATH)
    if (!iconFromSvg.isEmpty()) {
      return iconFromSvg
    }
  } catch (error) {
    console.warn("[main] failed to load icon.svg.", error)
  }

  return nativeImage.createEmpty()
}

const APP_ICON = loadAppIcon()

function getImageMimeType(filePath) {
  const extension = path.extname(filePath || "").toLowerCase()
  return IMAGE_MIME_TYPES[extension] || "image/png"
}

function clearStartupFailsafeTimer() {
  if (startupFailsafeTimer !== null) {
    clearTimeout(startupFailsafeTimer)
    startupFailsafeTimer = null
  }
}

function normalizeSplashState(nextState = {}) {
  const progress = Number(nextState.progress)

  return {
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : splashState.progress,
    title: typeof nextState.title === "string" && nextState.title.trim() ? nextState.title.trim() : splashState.title,
    message:
      typeof nextState.message === "string" && nextState.message.trim()
        ? nextState.message.trim()
        : splashState.message,
    detail:
      typeof nextState.detail === "string" && nextState.detail.trim()
        ? nextState.detail.trim()
        : splashState.detail,
  }
}

function pushSplashState(nextState) {
  splashState = normalizeSplashState(nextState)

  if (!splashWindow || splashWindow.isDestroyed()) {
    return
  }

  splashWindow.webContents.send("splash:state", splashState)
}

function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.show()
  mainWindow.focus()
  emitWindowState(mainWindow)

  if (splashWindow && !splashWindow.isDestroyed()) {
    setTimeout(() => {
      if (!splashWindow || splashWindow.isDestroyed()) {
        return
      }
      splashWindow.close()
    }, 90)
  }
}

function completeStartup(nextState) {
  if (startupMarkedComplete) {
    return
  }

  startupMarkedComplete = true
  clearStartupFailsafeTimer()

  if (nextState) {
    pushSplashState(nextState)
  }

  const elapsed = Date.now() - startupStartAt
  const waitRemaining = Math.max(0, STARTUP_MIN_SPLASH_MS - elapsed)

  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    if (!mainWindowCanReveal) {
      mainWindow.once("ready-to-show", () => {
        mainWindowCanReveal = true
        revealMainWindow()
      })
      return
    }

    revealMainWindow()
  }, waitRemaining)
}

function emitWindowState(win) {
  if (win.isDestroyed()) {
    return
  }

  win.webContents.send("window:state-changed", {
    isMaximized: win.isMaximized(),
  })
}

function createSplashWindow() {
  const win = new BrowserWindow({
    width: 620,
    height: 420,
    minWidth: 620,
    minHeight: 420,
    maxWidth: 620,
    maxHeight: 420,
    frame: false,
    transparent: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    movable: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#07111f",
    icon: APP_ICON.isEmpty() ? undefined : APP_ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: SPLASH_PRELOAD_PATH,
      sandbox: true,
    },
  })

  win.once("ready-to-show", () => {
    win.show()
    win.focus()
  })

  win.on("closed", () => {
    if (splashWindow === win) {
      splashWindow = null
    }
  })

  win.webContents.on("did-finish-load", () => {
    pushSplashState(splashState)
  })

  win.loadFile(SPLASH_HTML_PATH)
  return win
}

function createWindow() {
  startupStartAt = Date.now()
  startupMarkedComplete = false
  mainWindowCanReveal = false
  splashState = normalizeSplashState({
    progress: 8,
    title: "正在启动 VidGnost",
    message: "启动窗口已建立",
    detail: "即将装载完整工作台与本地运行时数据。",
  })

  splashWindow = createSplashWindow()

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0d131d",
    icon: APP_ICON.isEmpty() ? undefined : APP_ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
      sandbox: true,
    },
  })

  mainWindow = win

  win.on("ready-to-show", () => {
    mainWindowCanReveal = true
    if (startupMarkedComplete) {
      revealMainWindow()
    }
  })

  win.on("maximize", () => emitWindowState(win))
  win.on("unmaximize", () => emitWindowState(win))
  win.on("enter-full-screen", () => emitWindowState(win))
  win.on("leave-full-screen", () => emitWindowState(win))
  win.on("close", (event) => {
    if (allowedToClose.has(win)) {
      allowedToClose.delete(win)
      return
    }

    event.preventDefault()
    if (!win.webContents.isDestroyed()) {
      win.webContents.send("window:close-requested")
    }
  })
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null
      mainWindowCanReveal = false
      clearStartupFailsafeTimer()
    }
  })

  win.webContents.on("did-start-loading", () => {
    pushSplashState({
      progress: 16,
      message: "正在加载前端资源",
      detail: "主工作台 bundle、样式和基础运行时正在装载。",
    })
  })

  win.webContents.on("did-finish-load", () => {
    emitWindowState(win)
    pushSplashState({
      progress: 30,
      message: "前端资源已装载",
      detail: "等待渲染进程完成页面预热与基础数据初始化。",
    })
  })

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      return
    }

    console.error("[main] failed to load main window", {
      errorCode,
      errorDescription,
      validatedURL,
    })

    completeStartup({
      progress: 100,
      message: "启动资源加载失败",
      detail: errorDescription || "主界面资源未能成功装载，已尝试打开主窗口以便继续排查。",
    })
  })

  clearStartupFailsafeTimer()
  startupFailsafeTimer = setTimeout(() => {
    completeStartup({
      progress: 100,
      message: "启动等待超时",
      detail: "主界面将继续打开，方便你在应用内查看当前状态并进一步排查。",
    })
  }, STARTUP_FAILSAFE_MS)

  win.loadURL(DEV_SERVER_URL)
  return win
}

ipcMain.handle("dialog:pick-image-file", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePaths } = await dialog.showOpenDialog(win || undefined, {
    title: "选择换肤图片",
    properties: ["openFile"],
    filters: [
      {
        name: "图片文件",
        extensions: ["png", "jpg", "jpeg", "webp", "avif", "gif", "svg"],
      },
    ],
  })

  if (canceled || filePaths.length === 0) {
    return { canceled: true }
  }

  const selectedPath = filePaths[0]
  try {
    const fileBuffer = fs.readFileSync(selectedPath)
    const mimeType = getImageMimeType(selectedPath)
    return {
      canceled: false,
      fileName: path.basename(selectedPath),
      sizeBytes: fileBuffer.byteLength,
      dataUrl: `data:${mimeType};base64,${fileBuffer.toString("base64")}`,
    }
  } catch (error) {
    return {
      canceled: false,
      message: error instanceof Error ? error.message : "读取图片失败。",
    }
  }
})

ipcMain.handle("shell:open-path", async (_event, targetPath) => {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    return { ok: false, message: "Invalid path." }
  }

  const resolvedPath = path.resolve(targetPath)
  if (!fs.existsSync(resolvedPath)) {
    return { ok: false, message: "Path does not exist." }
  }

  const openError = await shell.openPath(resolvedPath)
  if (openError) {
    return { ok: false, message: openError }
  }

  return { ok: true }
})

ipcMain.handle("shell:open-external", async (_event, targetUrl) => {
  if (typeof targetUrl !== "string" || !targetUrl.trim()) {
    return { ok: false, message: "Invalid url." }
  }

  let parsedUrl
  try {
    parsedUrl = new URL(targetUrl)
  } catch {
    return { ok: false, message: "Malformed url." }
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsedUrl.protocol)) {
    return { ok: false, message: "Protocol not allowed." }
  }

  await shell.openExternal(parsedUrl.toString())
  return { ok: true }
})

ipcMain.handle("window:minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  win?.minimize()
})

ipcMain.handle("window:toggle-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    return { isMaximized: false }
  }

  if (win.isMaximized()) {
    win.unmaximize()
  } else {
    win.maximize()
  }

  return { isMaximized: win.isMaximized() }
})

ipcMain.handle("window:get-state", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  return { isMaximized: Boolean(win?.isMaximized()) }
})

ipcMain.handle("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    return
  }

  allowedToClose.add(win)
  win.close()
})

ipcMain.on("bootstrap:state", (event, nextState) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (!mainWindow || senderWindow !== mainWindow) {
    return
  }

  pushSplashState(nextState)
})

ipcMain.on("bootstrap:complete", (event, nextState) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (!mainWindow || senderWindow !== mainWindow) {
    return
  }

  completeStartup(nextState)
})

app.whenReady().then(() => {
  app.setName("VidGnost")
  if (process.platform === "win32") {
    app.setAppUserModelId("com.vidgnost.desktop")
  }
  if (process.platform === "darwin" && app.dock && !APP_ICON.isEmpty()) {
    app.dock.setIcon(APP_ICON)
  }

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("window-all-closed", () => {
  clearStartupFailsafeTimer()
  if (process.platform !== "darwin") {
    app.quit()
  }
})
