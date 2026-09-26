export const DEFAULT_APP_NAME = "VidGnost"
export const DEFAULT_API_PREFIX = "/api"
export const DEFAULT_API_HOST = "127.0.0.1"
export const DEFAULT_API_PORT = 8666
export const API_VERSION = "3.0.0"

/** 前端 Vite 开发端口，与 Electron 主进程保持一致。 */
export const DESKTOP_DEV_PORT = 6221

/** 阶段顺序，前端用于渲染进度轨。 */
export const STAGE_ORDER = [
  "ingest",
  "audio",
  "transcribe",
  "structure",
  "insight",
  "mindmap",
  "knowledge",
  "vision",
  "index",
  "finalize",
] as const
