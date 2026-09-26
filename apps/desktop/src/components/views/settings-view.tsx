import { useEffect, useState } from 'react'
import { CheckCircle2, HardDrive, Loader2, XCircle } from 'lucide-react'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/stores/app-store'

type Toolchain = Awaited<ReturnType<typeof api.toolchainHealth>>

/** 设置：只保留会影响处理结果的项，运行环境探测结果只读展示。 */
export function SettingsView() {
  const settings = useAppStore((state) => state.settings)
  const loadConfig = useAppStore((state) => state.loadConfig)
  const saveSettings = useAppStore((state) => state.saveSettings)
  const [toolchain, setToolchain] = useState<Toolchain | null>(null)
  const [probing, setProbing] = useState(false)

  useEffect(() => {
    if (!settings) {
      void loadConfig()
    }
  }, [loadConfig, settings])

  const probe = async () => {
    setProbing(true)
    try {
      setToolchain(await api.toolchainHealth())
    } finally {
      setProbing(false)
    }
  }

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-4 animate-spin text-text-subtle" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-6 pb-10 pt-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-text-strong">设置</h1>
          <p className="mt-0.5 text-[11px] text-text-muted">这些默认值会在新建任务时自动填入，单个任务仍可单独覆盖。</p>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => void probe()} disabled={probing}>
          {probing ? <Loader2 className="size-3.5 animate-spin" /> : <HardDrive className="size-3.5" />}
          检测工具链
        </Button>
      </header>

      {toolchain ? (
        <section className="mt-4 grid gap-2 sm:grid-cols-2">
          {toolchain.checks.map((check) => (
            <div key={check.name} className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
              {check.ok ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
              ) : (
                <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              )}
              <div className="min-w-0">
                <p className="text-[12px] text-foreground">{check.name}</p>
                <p className="truncate text-[11px] text-text-subtle">{check.detail}</p>
              </div>
              <span className="timecode ml-auto shrink-0 text-[10px] text-text-subtle">{check.latencyMs}ms</span>
            </div>
          ))}
        </section>
      ) : null}

      <section className="mt-6 max-w-[640px] space-y-5">
        <span className="label-eyebrow">默认处理参数</span>

        <div className="grid grid-cols-2 gap-4">
          <Field label="默认预设" hint="新建任务时预选">
            <select
              value={settings.defaultPreset}
              onChange={(event) => void saveSettings({ settings: { defaultPreset: event.target.value } })}
              className="h-8 w-full rounded-md border border-border/70 bg-background/60 px-2 text-[12px] text-foreground outline-none"
            >
              <option value="fast">快速</option>
              <option value="balanced">均衡</option>
              <option value="deep">深度</option>
            </select>
          </Field>

          <Field label="默认语言" hint="auto 表示交给转写引擎判定">
            <Input
              defaultValue={settings.defaultLanguage}
              onBlur={(event) => {
                if (event.target.value !== settings.defaultLanguage) {
                  void saveSettings({ settings: { defaultLanguage: event.target.value } })
                }
              }}
              className="h-8 text-[12px]"
            />
          </Field>

          <Field label="默认转写引擎">
            <select
              value={settings.defaultAsr}
              onChange={(event) => void saveSettings({ settings: { defaultAsr: event.target.value } })}
              className="h-8 w-full rounded-md border border-border/70 bg-background/60 px-2 text-[12px] text-foreground outline-none"
            >
              <option value="auto">自动（在线优先）</option>
              <option value="online">强制在线</option>
              <option value="local">强制本地</option>
            </select>
          </Field>

          <Field label="并发任务数" hint="在线模型限流时建议保持 1-2">
            <Input
              type="number"
              min={1}
              max={8}
              defaultValue={settings.maxConcurrentTasks}
              onBlur={(event) => {
                const value = Number(event.target.value)
                if (Number.isFinite(value) && value !== settings.maxConcurrentTasks) {
                  void saveSettings({ settings: { maxConcurrentTasks: value } })
                }
              }}
              className="h-8 text-[12px]"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
            <span>
              <span className="block text-[12px] text-foreground">默认开启画面理解</span>
              <span className="block text-[10px] text-text-subtle">抽关键帧并生成多模态图注</span>
            </span>
            <Switch
              checked={settings.defaultVision}
              onCheckedChange={(checked) => void saveSettings({ settings: { defaultVision: checked } })}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
            <span>
              <span className="block text-[12px] text-foreground">默认开启转写校对</span>
              <span className="block text-[10px] text-text-subtle">用模型修正同音错字与术语写法</span>
            </span>
            <Switch
              checked={settings.defaultProofread}
              onCheckedChange={(checked) => void saveSettings({ settings: { defaultProofread: checked } })}
            />
          </label>
        </div>
      </section>

      <section className="mt-8 max-w-[640px] space-y-5">
        <div>
          <span className="label-eyebrow">本地 Whisper（离线兜底）</span>
          <p className="mt-1.5 text-[11px] text-text-muted">
            仅在线转写不可用时使用。需要先准备 Python 环境与 CTranslate2 模型目录。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Python 可执行文件" hint="留空则从 PATH 查找">
            <Input
              defaultValue={settings.whisper.pythonExecutable}
              onBlur={(event) => {
                if (event.target.value !== settings.whisper.pythonExecutable) {
                  void saveSettings({ settings: { whisper: { pythonExecutable: event.target.value } } })
                }
              }}
              className="h-8 text-[12px]"
            />
          </Field>
          <Field label="模型目录" hint="CTranslate2 格式模型所在目录">
            <Input
              defaultValue={settings.whisper.modelDir}
              onBlur={(event) => {
                if (event.target.value !== settings.whisper.modelDir) {
                  void saveSettings({ settings: { whisper: { modelDir: event.target.value } } })
                }
              }}
              className="h-8 text-[12px]"
            />
          </Field>
          <Field label="推理设备">
            <select
              value={settings.whisper.device}
              onChange={(event) => void saveSettings({ settings: { whisper: { device: event.target.value } } })}
              className="h-8 w-full rounded-md border border-border/70 bg-background/60 px-2 text-[12px] text-foreground outline-none"
            >
              <option value="auto">自动</option>
              <option value="cpu">CPU</option>
              <option value="cuda">CUDA</option>
            </select>
          </Field>
          <Field label="计算精度">
            <select
              value={settings.whisper.computeType}
              onChange={(event) => void saveSettings({ settings: { whisper: { computeType: event.target.value } } })}
              className="h-8 w-full rounded-md border border-border/70 bg-background/60 px-2 text-[12px] text-foreground outline-none"
            >
              {['int8', 'int8_float16', 'float16', 'float32'].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="mt-8 max-w-[640px]">
        <span className="label-eyebrow">存储</span>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <InfoRow label="存储目录" value={settings.whisper.modelDir ? 'storage/' : 'storage/'} />
          <InfoRow label="任务隔离" value="每个任务一个目录，含检查点" />
          <InfoRow label="阶段缓存" value="按输入指纹 + 模型路由计算" />
          <InfoRow label="保留中间媒体" value={settings.keepIntermediateMedia ? '开启' : '关闭'} />
        </div>
      </section>
    </div>
  )
}

function Field({ children, hint, label }: { children: React.ReactNode; hint?: string; label: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] text-text-muted">{label}</Label>
      {children}
      {hint ? <p className="text-[10px] text-text-subtle">{hint}</p> : null}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('rounded-lg border border-border/60 bg-card/40 px-3 py-2')}>
      <p className="text-[10px] uppercase tracking-wider text-text-subtle">{label}</p>
      <p className="timecode mt-0.5 text-[11px] text-foreground">{value}</p>
    </div>
  )
}
