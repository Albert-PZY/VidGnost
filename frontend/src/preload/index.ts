import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('vidgnostBridge', {
  getApiBase: async (): Promise<string> => ipcRenderer.invoke('vidgnost:get-api-base'),
  openExternal: async (url: string): Promise<boolean> => ipcRenderer.invoke('vidgnost:open-external', url),
})
