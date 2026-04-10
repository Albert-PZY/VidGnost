const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } = require("electron")
const fs = require("node:fs")
const path = require("node:path")

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173"
const PRELOAD_PATH = path.join(__dirname, "preload.cjs")
const APP_ICON_SVG_PATH = path.join(__dirname, "..", "public", "icon.svg")
const FALLBACK_ICON_PATH = path.join(__dirname, "..", "public", "icon-light-32x32.png")
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"])
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
    console.warn("[main] failed to load icon.svg, falling back to PNG icon.", error)
  }

  return nativeImage.createFromPath(FALLBACK_ICON_PATH)
}

const APP_ICON = loadAppIcon()

function getImageMimeType(filePath) {
  const extension = path.extname(filePath || "").toLowerCase()
  return IMAGE_MIME_TYPES[extension] || "image/png"
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

function emitWindowState(win) {
  if (win.isDestroyed()) {
    return
  }
  win.webContents.send("window:state-changed", {
    isMaximized: win.isMaximized(),
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    frame: false,
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
  win.webContents.on("did-finish-load", () => emitWindowState(win))

  win.loadURL(DEV_SERVER_URL)
}

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
  if (process.platform !== "darwin") {
    app.quit()
  }
})
