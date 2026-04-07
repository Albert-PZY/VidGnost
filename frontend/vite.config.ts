import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function isSelectEcosystem(id: string): boolean {
  return id.includes('/react-select/') || id.includes('/@emotion/') || id.includes('/memoize-one/')
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Heavy chunks like markdown editor are lazy-loaded; raise warning threshold to reduce noisy false alarms.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/markmap-lib/')) return 'markmap-lib'
          if (id.includes('/markmap-view/')) return 'markmap-view'
          if (isSelectEcosystem(id)) return 'select-vendor'
          if (id.includes('/d3-')) return 'd3-vendor'
          if (id.includes('react-i18next') || id.includes('i18next')) return 'i18n-vendor'
          if (id.includes('@radix-ui')) return 'radix-vendor'
          if (id.includes('react-dom') || id.includes('/react/')) return 'react-vendor'
          return undefined
        },
      },
    },
  },
})
