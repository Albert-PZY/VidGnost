import { defineConfig } from '@playwright/test'

const playwrightChannel = process.env.PLAYWRIGHT_CHANNEL?.trim() || undefined
const playwrightExecutablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH?.trim() || undefined

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173',
    headless: true,
    channel: playwrightExecutablePath ? undefined : playwrightChannel,
    launchOptions: playwrightExecutablePath
      ? {
          executablePath: playwrightExecutablePath,
        }
      : undefined,
  },
  reporter: [['list']],
})
