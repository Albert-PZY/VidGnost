import type { TFunction } from 'i18next'
import { CloudUpload, FileCog, History, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck } from 'lucide-react'

import { PreText } from './pretext'
import { SidebarMenuButton } from './workbench-panels'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import type { TaskDetail } from '../types'

type SidebarPanelKey = 'source' | 'history' | 'config' | 'selfCheck' | null

interface WorkbenchSidebarProps {
  t: TFunction
  sidebarCollapsed: boolean
  setSidebarCollapsed: (updater: (prev: boolean) => boolean) => void
  activeSidebarPanel: SidebarPanelKey
  setActiveSidebarPanel: (panel: SidebarPanelKey) => void
  loadHistory: () => Promise<void>
  openConfigPanel: (tab?: 'localModels' | 'whisper' | 'prompts') => void
  openSelfCheckPanel: () => void
  runtimeModel: string
  runtimeLanguage: string
  whisperPreset: 'speed' | 'balanced' | 'quality' | 'custom'
  activeTask: TaskDetail | null
  activeTaskStatusText: string
}

export function WorkbenchSidebar({
  t,
  sidebarCollapsed,
  setSidebarCollapsed,
  activeSidebarPanel,
  setActiveSidebarPanel,
  loadHistory,
  openConfigPanel,
  openSelfCheckPanel,
  runtimeModel,
  runtimeLanguage,
  whisperPreset,
  activeTask,
  activeTaskStatusText,
}: WorkbenchSidebarProps) {
  return (
    <aside className="min-w-0 space-y-3.5">
      <section className={cn('workbench-sidebar-card', sidebarCollapsed ? 'p-2.5' : 'p-4')}>
        <div className={cn('mb-2.5 flex items-center', sidebarCollapsed ? 'justify-center' : 'justify-between')}>
          {!sidebarCollapsed && (
            <PreText variant="timestamp" className="font-semibold text-text-main">
              {t('sidebar.menuTitle')}
            </PreText>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-full"
            aria-label={sidebarCollapsed ? t('sidebar.controls.expand') : t('sidebar.controls.collapse')}
            onClick={() => setSidebarCollapsed((prev) => !prev)}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
        <SidebarMenuButton
          icon={CloudUpload}
          title={t('sidebar.actions.source.title')}
          description={t('sidebar.actions.source.description')}
          active={activeSidebarPanel === 'source'}
          collapsed={sidebarCollapsed}
          onClick={() => setActiveSidebarPanel('source')}
        />
        <SidebarMenuButton
          icon={History}
          title={t('sidebar.actions.history.title')}
          description={t('sidebar.actions.history.description')}
          active={activeSidebarPanel === 'history'}
          collapsed={sidebarCollapsed}
          onClick={() => {
            void loadHistory()
            setActiveSidebarPanel('history')
          }}
        />
        <SidebarMenuButton
          icon={FileCog}
          title={t('sidebar.actions.config.title')}
          description={t('sidebar.actions.config.description')}
          active={activeSidebarPanel === 'config'}
          collapsed={sidebarCollapsed}
          onClick={() => openConfigPanel('localModels')}
        />
        <SidebarMenuButton
          icon={ShieldCheck}
          title={t('sidebar.actions.selfCheck.title')}
          description={t('sidebar.actions.selfCheck.description')}
          active={activeSidebarPanel === 'selfCheck'}
          collapsed={sidebarCollapsed}
          onClick={openSelfCheckPanel}
        />
      </section>

      {!sidebarCollapsed && (
        <section className="workbench-sidebar-card p-4">
          <div className="mb-2.5 flex items-center gap-2">
            <Settings className="h-4 w-4 text-accent" />
            <PreText as="h2" variant="h3">
              {t('sidebar.runtimeDefaults.title')}
            </PreText>
          </div>
          <PreText variant="timestamp" className="workbench-subtitle-pill mb-1 inline-flex">
            {t('sidebar.runtimeDefaults.model', { model: runtimeModel })}
          </PreText>
          <PreText variant="timestamp" className="workbench-subtitle-pill mb-1 inline-flex">
            {t('sidebar.runtimeDefaults.language', { language: runtimeLanguage })}
          </PreText>
          <PreText variant="timestamp" className="workbench-subtitle-pill inline-flex">
            {t(`sidebar.runtimeDefaults.preset.${whisperPreset}`)}
          </PreText>
          {activeTask && (
            <div
              className="max-w-full"
              title={t('sidebar.runtimeDefaults.activeTask', {
                status: activeTaskStatusText,
                progress: activeTask.progress,
              })}
            >
              <PreText variant="timestamp" className="workbench-subtitle-pill mt-2 inline-flex max-w-full truncate">
                {t('sidebar.runtimeDefaults.activeTask', {
                  status: activeTaskStatusText,
                  progress: activeTask.progress,
                })}
              </PreText>
            </div>
          )}
        </section>
      )}
    </aside>
  )
}
