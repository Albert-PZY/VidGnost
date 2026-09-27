import { useCallback, useEffect, useState } from 'react'

import { api } from '@/lib/api'
import { CommandPalette, type Command } from '@/components/shell/command-palette'
import { SideRail } from '@/components/shell/side-rail'
import { TitleBar } from '@/components/shell/title-bar'
import { LibraryView } from '@/components/views/library-view'
import { ProvidersView } from '@/components/views/providers-view'
import { SettingsView } from '@/components/views/settings-view'
import { StudioView } from '@/components/views/studio-view'
import { useAppStore, type Workspace } from '@/stores/app-store'

const WORKSPACE_LABEL: Record<Workspace, string> = {
  library: '资产库',
  studio: '工作台',
  providers: '模型',
  settings: '设置',
}

export default function App() {
  const workspace = useAppStore((state) => state.workspace)
  const setWorkspace = useAppStore((state) => state.setWorkspace)
  const task = useAppStore((state) => state.task)
  const library = useAppStore((state) => state.library)
  const refreshLibrary = useAppStore((state) => state.refreshLibrary)
  const loadConfig = useAppStore((state) => state.loadConfig)
  const openTask = useAppStore((state) => state.openTask)
  const closeTask = useAppStore((state) => state.closeTask)

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [backendError, setBackendError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        await api.health()
        setBackendError(null)
      } catch (error) {
        setBackendError(error instanceof Error ? error.message : String(error))
        return
      }
      await Promise.all([refreshLibrary(), loadConfig()])
    })()
  }, [loadConfig, refreshLibrary])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleOpenTask = useCallback(
    (taskId: string) => {
      void openTask(taskId)
    },
    [openTask],
  )

  const commands: Command[] = [
    { id: 'nav-library', label: '前往资产库', hint: '查看所有已处理视频', run: () => setWorkspace('library') },
    {
      id: 'nav-studio',
      label: '前往工作台',
      hint: task ? task.title : '先打开一个任务',
      run: () => task && setWorkspace('studio'),
    },
    { id: 'nav-providers', label: '前往模型', hint: '模型类别、协议与渠道', run: () => setWorkspace('providers') },
    { id: 'nav-settings', label: '前往设置', hint: '默认处理参数与本地 Whisper', run: () => setWorkspace('settings') },
    { id: 'refresh-library', label: '刷新资产库', hint: '重新拉取任务列表', run: () => void refreshLibrary() },
    ...(task
      ? [{ id: 'close-task', label: '关闭当前任务', hint: task.title, run: () => closeTask() }]
      : []),
  ]

  if (backendError) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="max-w-[28.75rem] text-center">
          <h1 className="text-head font-semibold text-text-strong">无法连接本地服务</h1>
          <p className="mt-2 text-note leading-relaxed text-text-muted">
            VidGnost 需要本地 API 服务（默认 http://127.0.0.1:8666）才能工作。请先启动后端：
          </p>
          <code className="mt-3 block rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-left text-meta text-text-muted">
            pnpm --filter @vidgnost/api start
          </code>
          <p className="mt-3 text-meta text-text-subtle">{backendError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <div className="aurora-layer" />
      <div className="noise-layer" />

      <div className="app-shell relative z-10">
        <TitleBar
          breadcrumb={
            workspace === 'studio' && task ? `${WORKSPACE_LABEL.studio} · ${task.title}` : WORKSPACE_LABEL[workspace]
          }
          asideAvailable={false}
          asideCollapsed={false}
          onToggleAside={() => undefined}
          onCommandPalette={() => setPaletteOpen(true)}
        />

        <div className="grid min-h-0 grid-cols-[3.25rem_minmax(0,1fr)]">
          <SideRail
            active={workspace}
            hasTask={Boolean(task)}
            onSelect={(next) => {
              if (next === 'studio' && !task) return
              setWorkspace(next)
            }}
          />

          <div className="min-h-0 overflow-hidden">
            {workspace === 'library' ? <LibraryView /> : null}
            {workspace === 'studio' ? <StudioView /> : null}
            {workspace === 'providers' ? <ProvidersView /> : null}
            {workspace === 'settings' ? <SettingsView /> : null}
          </div>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        tasks={library}
        onOpenTask={handleOpenTask}
      />
    </div>
  )
}
