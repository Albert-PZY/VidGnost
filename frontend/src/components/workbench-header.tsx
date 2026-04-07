import type { ComponentProps, ComponentType } from 'react'
import type { TFunction } from 'i18next'
import { BookOpen, Languages } from 'lucide-react'

import { PreText } from './pretext'
import { ThemeToggle } from './theme-toggle'
import { Button } from './ui/button'
import { SelectField, type SelectFieldOption } from './workbench-panels'
import { cn } from '../lib/utils'

type MainViewMode = 'workbench' | 'quickstart'
type UILocale = 'zh-CN' | 'en'

interface WorkbenchHeaderProps {
  t: TFunction
  headerGlass: boolean
  mainView: MainViewMode
  onToggleMainView: () => void
  currentLocale: UILocale
  uiLocaleOptions: SelectFieldOption[]
  onSwitchLocale: (locale: UILocale) => Promise<void>
  menuPortalTarget: HTMLElement | null
  isDark: boolean
  setIsDark: (value: boolean) => void
  githubIcon: ComponentType<ComponentProps<'svg'>>
}

export function WorkbenchHeader({
  t,
  headerGlass,
  mainView,
  onToggleMainView,
  currentLocale,
  uiLocaleOptions,
  onSwitchLocale,
  menuPortalTarget,
  isDark,
  setIsDark,
  githubIcon: GitHubIcon,
}: WorkbenchHeaderProps) {
  return (
    <header
      className={cn(
        'app-header sticky top-0 z-30 transition-all duration-300',
        headerGlass
          ? 'border-b bg-bg-base/70 shadow-[0_16px_30px_-24px_rgba(16,32,52,0.85)] backdrop-blur-2xl'
          : 'border-b border-transparent bg-bg-base/94',
      )}
    >
      <div className="flex h-[4.25rem] w-full items-center justify-between gap-3.5 px-3 md:px-4">
        <div className="workbench-brand-chip min-w-0">
          <span className="workbench-brand-mark shrink-0" aria-hidden="true">
            <img
              src={isDark ? '/dark.svg' : '/light.svg'}
              alt=""
              className="h-4 w-4 object-contain"
              draggable={false}
            />
          </span>
          <PreText
            as="h1"
            variant="h3"
            className="truncate text-[0.98rem] font-semibold md:text-[1.04rem]"
          >
            VidGnost
          </PreText>
          <PreText variant="timestamp" className="workbench-subtitle-pill hidden truncate md:block">
            {t('header.subtitle')}
          </PreText>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <Button
            type="button"
            variant={mainView === 'quickstart' ? 'default' : 'outline'}
            size="sm"
            className="h-9 px-3.5"
            onClick={onToggleMainView}
          >
            <BookOpen className="mr-2 h-4 w-4" />
            {mainView === 'quickstart' ? t('quickStart.backToWorkbench') : t('quickStart.entry')}
          </Button>
          <div className="w-40">
            <SelectField
              compact
              value={currentLocale}
              options={uiLocaleOptions}
              onValueChange={(value) => {
                void onSwitchLocale(value as UILocale)
              }}
              leadingIcon={<Languages className="h-3.5 w-3.5" />}
              ariaLabel={t('header.languageSwitcherAria')}
              menuPortalTarget={menuPortalTarget}
            />
          </div>
          <a
            href="https://github.com/Albert-PZY/VidGnost"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex"
            aria-label={t('header.githubAria')}
            title={t('header.githubAria')}
          >
            <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-full">
              <GitHubIcon className="h-4 w-4" />
            </Button>
          </a>
          <ThemeToggle dark={isDark} onChange={setIsDark} ariaLabel={t('header.themeToggleAria')} />
        </div>
      </div>
    </header>
  )
}
