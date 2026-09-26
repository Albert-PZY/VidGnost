/** Electron 主进程通过 preload 暴露到渲染层的桥接能力。 */
export interface DesktopBridge {
  closeWindow: () => Promise<void>
  minimizeWindow: () => Promise<void>
  onWindowStateChange: (listener: (state: { maximized: boolean }) => void) => () => void
  openExternal: (url: string) => Promise<void>
  openPath: (targetPath: string) => Promise<void>
  pickDirectory: (title?: string) => Promise<{ canceled: boolean; path?: string }>
  pickMediaFile: () => Promise<{ canceled: boolean; path?: string; fileName?: string }>
  toggleMaximizeWindow: () => Promise<void>
}

declare global {
  interface Window {
    /** 仅在 Electron 中注入；浏览器调试模式下为 undefined。 */
    vidGnostDesktop?: DesktopBridge
  }
}

export const desktopBridge: DesktopBridge | undefined =
  typeof window === "undefined" ? undefined : window.vidGnostDesktop
