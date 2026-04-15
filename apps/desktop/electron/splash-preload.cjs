const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("vidGnostSplash", {
  onState(listener) {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on("splash:state", handler)
    return () => {
      ipcRenderer.removeListener("splash:state", handler)
    }
  },
})
