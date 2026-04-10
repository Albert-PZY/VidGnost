const { app, BrowserWindow, ipcMain, shell } = require("electron")
const fs = require("node:fs")
const path = require("node:path")

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173"
const PRELOAD_PATH = path.join(__dirname, "preload.cjs")

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

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
      sandbox: true,
    },
  })

  win.loadURL(DEV_SERVER_URL)
}

app.whenReady().then(() => {
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
