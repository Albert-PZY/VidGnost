export {}

declare global {
  interface Window {
    vidgnostBridge?: {
      getApiBase: () => Promise<string>
      openExternal: (url: string) => Promise<boolean>
    }
  }
}
