export {}

declare global {
  interface DesktopWindowState {
    isMaximized: boolean
  }

  interface Window {
    vidGnostDesktop?: {
      openPath: (targetPath: string) => Promise<{ ok: boolean; message?: string }>
      openExternal: (targetUrl: string) => Promise<{ ok: boolean; message?: string }>
      minimizeWindow: () => Promise<void>
      toggleMaximizeWindow: () => Promise<DesktopWindowState>
      closeWindow: () => Promise<void>
      getWindowState: () => Promise<DesktopWindowState>
      onWindowStateChange: (listener: (state: DesktopWindowState) => void) => () => void
      onWindowCloseRequested: (listener: () => void) => () => void
    }
  }
}
