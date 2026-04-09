import type { ComponentProps, Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import { Download, LoaderCircle } from 'lucide-react'

import { HistoryModal } from './history-modal'
import { PreText } from './pretext'
import { SelfCheckModal } from './self-check-modal'
import { Button } from './ui/button'
import {
  DeleteTaskConfirmModal,
  SourceTaskModal,
} from './workbench-modals'
import { WorkbenchRuntimeMain } from './workbench-runtime-main'
import { WorkbenchSidebar } from './workbench-sidebar'
import { cn } from '../lib/utils'
import type { SidebarPanelKey } from '../app/workbench-config'
import type { TaskDetail } from '../types'

type RuntimeMainProps = Omit<ComponentProps<typeof WorkbenchRuntimeMain>, 't'>
type SourceTaskModalProps = Omit<ComponentProps<typeof SourceTaskModal>, 'open' | 't'>
type HistoryModalProps = Omit<ComponentProps<typeof HistoryModal>, 'open' | 't'>
type DeleteTaskConfirmModalProps = Omit<ComponentProps<typeof DeleteTaskConfirmModal>, 'open' | 't'>
type SelfCheckModalProps = Omit<ComponentProps<typeof SelfCheckModal>, 'open' | 't'>

interface WorkbenchMainViewProps {
  t: TFunction
  sidebarCollapsed: boolean
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>
  activeSidebarPanel: SidebarPanelKey
  setActiveSidebarPanel: Dispatch<SetStateAction<SidebarPanelKey>>
  loadHistory: (query?: string) => Promise<void>
  openSelfCheckPanel: () => void
  runtimeModel: string
  runtimeLanguage: string
  whisperPreset: 'speed' | 'balanced' | 'quality' | 'custom'
  activeTask: TaskDetail | null
  activeTaskStatusText: string
  runtimeMainProps: RuntimeMainProps
  isTaskCompleted: boolean
  savingArtifacts: boolean
  bundleArchiveFormat: string
  onDownloadAllArtifacts: () => void
  sourceTaskModalProps: SourceTaskModalProps
  historyModalProps: HistoryModalProps
  deleteTaskConfirmModalProps: DeleteTaskConfirmModalProps
  selfCheckModalProps: SelfCheckModalProps
}

export function WorkbenchMainView({
  t,
  sidebarCollapsed,
  setSidebarCollapsed,
  activeSidebarPanel,
  setActiveSidebarPanel,
  loadHistory,
  openSelfCheckPanel,
  runtimeModel,
  runtimeLanguage,
  whisperPreset,
  activeTask,
  activeTaskStatusText,
  runtimeMainProps,
  isTaskCompleted,
  savingArtifacts,
  bundleArchiveFormat,
  onDownloadAllArtifacts,
  sourceTaskModalProps,
  historyModalProps,
  deleteTaskConfirmModalProps,
  selfCheckModalProps,
}: WorkbenchMainViewProps) {
  return (
    <>
      <div
        className={cn(
          'grid w-full gap-4 px-3 py-3.5 md:gap-4 md:px-4 md:py-[1.125rem] xl:gap-5',
          sidebarCollapsed ? 'lg:grid-cols-[78px_minmax(0,1fr)]' : 'lg:grid-cols-[264px_minmax(0,1fr)]',
        )}
      >
        <WorkbenchSidebar
          t={t}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          activeSidebarPanel={activeSidebarPanel}
          setActiveSidebarPanel={setActiveSidebarPanel}
          loadHistory={loadHistory}
          openSelfCheckPanel={openSelfCheckPanel}
          runtimeModel={runtimeModel}
          runtimeLanguage={runtimeLanguage}
          whisperPreset={whisperPreset}
          activeTask={activeTask}
          activeTaskStatusText={activeTaskStatusText}
        />

        <WorkbenchRuntimeMain t={t} {...runtimeMainProps} />
      </div>

      {isTaskCompleted && activeTask && (
        <div className="pointer-events-none fixed bottom-5 right-5 z-30">
          <div className="workbench-floating-card pointer-events-auto w-[360px] p-3.5">
            <PreText variant="timestamp" className="mb-2">
              {t('bundleDownload.ready')}
            </PreText>
            <Button className="w-full" onClick={onDownloadAllArtifacts} disabled={savingArtifacts}>
              {savingArtifacts ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {savingArtifacts
                ? t('runtime.stageD.saving')
                : t('bundleDownload.action', { format: bundleArchiveFormat.toUpperCase() })}
            </Button>
          </div>
        </div>
      )}

      <SourceTaskModal
        open={activeSidebarPanel === 'source'}
        t={t}
        {...sourceTaskModalProps}
      />

      <HistoryModal
        open={activeSidebarPanel === 'history'}
        t={t}
        {...historyModalProps}
      />

      <DeleteTaskConfirmModal
        open={Boolean(deleteTaskConfirmModalProps.pendingDeleteTask)}
        t={t}
        {...deleteTaskConfirmModalProps}
      />

      <SelfCheckModal
        open={activeSidebarPanel === 'selfCheck'}
        t={t}
        {...selfCheckModalProps}
      />
    </>
  )
}
