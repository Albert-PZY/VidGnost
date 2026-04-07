import { Moon, Sun } from 'lucide-react'

import { Switch } from './ui/switch'

interface ThemeToggleProps {
  dark: boolean
  onChange: (dark: boolean) => void
  ariaLabel: string
}

export function ThemeToggle({ dark, onChange, ariaLabel }: ThemeToggleProps) {
  return (
    <label className="theme-toggle-shell inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2">
      <Sun className="h-4 w-4 text-text-subtle" />
      <Switch checked={dark} onCheckedChange={onChange} aria-label={ariaLabel} />
      <Moon className="h-4 w-4 text-text-subtle" />
    </label>
  )
}
