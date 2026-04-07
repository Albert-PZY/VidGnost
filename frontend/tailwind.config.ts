import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-base': 'var(--color-bg-base)',
        'surface-elevated': 'var(--color-surface-elevated)',
        'surface-muted': 'var(--color-surface-muted)',
        'text-main': 'var(--color-text-main)',
        'text-subtle': 'var(--color-text-subtle)',
        border: 'var(--color-border)',
        accent: 'var(--color-accent)',
      },
    },
  },
  plugins: [],
}

export default config
