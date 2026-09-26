import type { ReactNode } from 'react'

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
    vidGnostDesktop?: DesktopBridge
  }
}

export function DesktopProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}
