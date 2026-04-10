export {}

declare global {
  interface Window {
    vidGnostDesktop?: {
      openPath: (targetPath: string) => Promise<{ ok: boolean; message?: string }>
    }
  }
}
