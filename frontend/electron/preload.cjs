const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("vidGnostDesktop", {
  openPath(targetPath) {
    return ipcRenderer.invoke("shell:open-path", targetPath)
  },
})
