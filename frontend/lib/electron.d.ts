export {}

declare global {
  type DesktopBootstrapStepStatus = "pending" | "active" | "complete" | "error"

  interface DesktopBootstrapStep {
    id: string
    label: string
    status: DesktopBootstrapStepStatus
  }

  interface DesktopWindowState {
    isMaximized: boolean
  }

  interface DesktopBootstrapState {
    progress?: number
    phaseId?: string
    title?: string
    message?: string
    detail?: string
    version?: string
    steps?: DesktopBootstrapStep[]
  }

  interface Window {
    vidGnostDesktop?: {
      openPath: (targetPath: string) => Promise<{ ok: boolean; message?: string }>
      openExternal: (targetUrl: string) => Promise<{ ok: boolean; message?: string }>
      pickImageFile: () => Promise<{
        canceled: boolean
        fileName?: string
        dataUrl?: string
        sizeBytes?: number
        message?: string
      }>
      minimizeWindow: () => Promise<void>
      toggleMaximizeWindow: () => Promise<DesktopWindowState>
      closeWindow: () => Promise<void>
      getWindowState: () => Promise<DesktopWindowState>
      reportBootstrapState: (state: DesktopBootstrapState) => void
      completeBootstrap: (state?: DesktopBootstrapState) => void
      onWindowStateChange: (listener: (state: DesktopWindowState) => void) => () => void
      onWindowCloseRequested: (listener: () => void) => () => void
    }
  }
}
