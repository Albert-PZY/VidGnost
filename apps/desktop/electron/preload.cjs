const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("vidGnostDesktop", {
  openPath(targetPath) {
    return ipcRenderer.invoke("shell:open-path", targetPath)
  },
  openExternal(targetUrl) {
    return ipcRenderer.invoke("shell:open-external", targetUrl)
  },
  pickDirectory(title) {
    return ipcRenderer.invoke("dialog:pick-directory", title)
  },
  pickImageFile() {
    return ipcRenderer.invoke("dialog:pick-image-file")
  },
  minimizeWindow() {
    return ipcRenderer.invoke("window:minimize")
  },
  toggleMaximizeWindow() {
    return ipcRenderer.invoke("window:toggle-maximize")
  },
  closeWindow() {
    return ipcRenderer.invoke("window:close")
  },
  getWindowState() {
    return ipcRenderer.invoke("window:get-state")
  },
  reportBootstrapState(payload) {
    ipcRenderer.send("bootstrap:state", payload)
  },
  completeBootstrap(payload) {
    ipcRenderer.send("bootstrap:complete", payload)
  },
  onWindowStateChange(listener) {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on("window:state-changed", handler)
    return () => {
      ipcRenderer.removeListener("window:state-changed", handler)
    }
  },
  onWindowCloseRequested(listener) {
    const handler = () => listener()
    ipcRenderer.on("window:close-requested", handler)
    return () => {
      ipcRenderer.removeListener("window:close-requested", handler)
    }
  },
})
