import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
    },
  },
  renderer: {
    root: '.',
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
  },
})
