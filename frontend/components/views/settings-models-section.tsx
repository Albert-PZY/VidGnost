"use client"

import * as React from "react"
import { CloudDownload, Cpu, HardDrive, Play, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ModelDescriptor, OllamaRuntimeConfigResponse } from "@/lib/types"
import {
  modelGroupDefinitions,
  modelRouteGuides,
  getModelStatusMeta,
  modelTypeLabels,
  modelTypeTagClassNames,
  modelVisuals,
  providerLabels,
  type OllamaRuntimeFormState,
} from "@/components/views/settings-models-shared"

interface SettingsModelsSectionProps {
  models: ModelDescriptor[]
  isLoading: boolean
  busyModelId: string
  ollamaConfig: OllamaRuntimeConfigResponse | null
  ollamaRuntimeForm: OllamaRuntimeFormState
  localConfiguredModels: ModelDescriptor[]
  isRestartingOllamaService: boolean
  onReloadModel: (modelId?: string) => void
  onManagedModelAction: (model: ModelDescriptor) => void
  onConfigureModel: (model: ModelDescriptor) => void
  onOpenOllamaConfig: () => void
  onOpenLocalMigration: () => void
  onRestartOllamaService: () => void
}

function getModelConnectionSummary(model: ModelDescriptor): string {
  if (model.provider === "openai_compatible") {
    return `${model.api_model || model.model_id} · ${model.api_base_url || "未配置 API 地址"}`
  }
  if (model.is_installed) {
    return model.path || model.default_path || model.model_id
  }
  return "尚未完成当前模型的接入或安装"
}

function getModelHighlights(model: ModelDescriptor): Array<{ label: string; value: string }> {
  const items: Array<{ label: string; value: string }> = [
    {
      label: "接入方式",
      value: providerLabels[model.provider] || model.provider.replaceAll("_", " "),
    },
    {
      label: "体积",
      value: model.size_bytes > 0 ? formatBytes(model.size_bytes) : "未记录",
    },
  ]

  switch (model.component) {
    case "whisper":
      items.push({ label: "加载策略", value: model.load_profile || "balanced" })
      break
    case "llm":
    case "embedding":
    case "mllm":
      items.push({ label: "批大小", value: String(model.max_batch_size || 1) })
      break
    case "vlm":
      items.push({ label: "抽帧间隔", value: `${model.frame_interval_seconds || 10} 秒` })
      break
    case "rerank":
      items.push({ label: "Top N", value: String(model.rerank_top_n || 8) })
      break
  }

  return items
}

export function SettingsModelsSection({
  models,
  isLoading,
  busyModelId,
  ollamaConfig,
  ollamaRuntimeForm,
  localConfiguredModels,
  isRestartingOllamaService,
  onReloadModel,
  onManagedModelAction,
  onConfigureModel,
  onOpenOllamaConfig,
  onOpenLocalMigration,
  onRestartOllamaService,
}: SettingsModelsSectionProps) {
  const isModelListLoading = isLoading && models.length === 0
  const ollamaService = ollamaConfig?.service ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">模型配置</CardTitle>
        <CardDescription>按任务链顺序配置运行时、默认模型和关键参数，不需要先理解全部底层字段。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="settings-models-panel rounded-2xl border p-5">
            <div className="space-y-1">
              <div className="text-sm font-semibold">推荐配置顺序</div>
              <p className="text-xs leading-5 text-muted-foreground">
                先把本地运行环境准备好，再逐个确认每个环节的默认模型接入方式，最后再调吞吐和精度参数。
              </p>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                {
                  step: "01",
                  title: "准备运行时",
                  description: "先确认 Ollama 服务、模型目录和本地 GPU 依赖是否正常。",
                },
                {
                  step: "02",
                  title: "确定默认路线",
                  description: "按环节决定使用 Ollama、本地目录还是在线 API。",
                },
                {
                  step: "03",
                  title: "再调运行参数",
                  description: "最后再微调批大小、抽帧间隔、量化和纠错策略。",
                },
              ].map((item) => (
                <div key={item.step} className="rounded-xl border bg-muted/20 px-4 py-4">
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-primary/80">{item.step}</div>
                  <div className="mt-2 text-sm font-medium">{item.title}</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="settings-models-panel rounded-2xl border p-5">
              <div className="flex items-start gap-4">
                <div className="settings-model-icon-shell flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <Cpu className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Ollama 运行时</span>
                    <Badge variant={ollamaService?.reachable ? "default" : "secondary"}>
                      {ollamaService?.reachable ? "接口可达" : "接口不可达"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        ollamaService?.using_configured_models_dir
                          ? "border-emerald-500/60 text-emerald-600 dark:text-emerald-300"
                          : "border-amber-500/60 text-amber-600 dark:text-amber-300"
                      }
                    >
                      {ollamaService?.using_configured_models_dir ? "模型目录已生效" : "模型目录待切换"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    这里决定本地 Ollama 的安装目录、模型目录和服务地址，也是大部分本地模型接入的基础入口。
                  </p>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <div className="truncate">{ollamaService?.configured_models_dir || ollamaRuntimeForm.models_dir || "未配置模型目录"}</div>
                    <div className="truncate">{ollamaRuntimeForm.base_url || "未配置服务地址"}</div>
                    <div className="truncate text-[11px]">{ollamaService?.message || "保存配置后，这里会显示当前运行中的实际模型目录。"}</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isRestartingOllamaService || !ollamaService?.can_self_restart}
                  onClick={onRestartOllamaService}
                >
                  <Play className="mr-1 h-4 w-4" />
                  启动/重启
                </Button>
                <Button variant="outline" size="sm" onClick={onOpenOllamaConfig}>
                  配置
                </Button>
              </div>
            </div>

            <div className="settings-models-panel rounded-2xl border p-5">
              <div className="flex items-start gap-4">
                <div className="settings-model-icon-shell flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <HardDrive className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">本地模型批量迁移</span>
                    <Badge variant="secondary">{`${localConfiguredModels.length} 个本地模型`}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    用于统一迁移当前项目已经配置的本地模型目录。适合换盘、统一整理模型目录，迁移后会自动回写绝对路径。
                  </p>
                  <div className="mt-2 truncate text-xs text-muted-foreground">
                    {localConfiguredModels.length > 0
                      ? localConfiguredModels.map((model) => model.name).join("、")
                      : "当前还没有已配置的本地模型"}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={onOpenLocalMigration}>
                  配置
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {isModelListLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={`model-skeleton-${index}`} className="settings-model-skeleton-card rounded-2xl border p-5">
                <div className="flex items-start gap-4">
                  <div className="app-skeleton app-skeleton-intense h-11 w-11 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="app-skeleton app-skeleton-intense h-4 w-48 rounded-md" />
                    <div className="app-skeleton app-skeleton-intense h-3 w-72 rounded-md" />
                    <div className="app-skeleton app-skeleton-intense h-3 w-full max-w-xl rounded-md" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="app-skeleton app-skeleton-intense h-9 w-20 rounded-md" />
                    <div className="app-skeleton app-skeleton-intense h-9 w-16 rounded-md" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {modelGroupDefinitions.map((group) => {
              const groupModels = group.components
                .map((component) => models.find((model) => model.component === component))
                .filter((model): model is ModelDescriptor => Boolean(model))
              if (groupModels.length === 0) {
                return null
              }

              return (
                <section key={group.id} className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold">{group.title}</h3>
                      <Badge variant="outline">{`${groupModels.length} 个环节`}</Badge>
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">{group.description}</p>
                  </div>

                  <div className="space-y-3">
                    {groupModels.map((model) => {
                      const isDownloading = model.download?.state === "downloading"
                      const downloadPercent = Math.max(0, Math.min(100, model.download?.percent ?? 0))
                      const visual = modelVisuals[model.component] || modelVisuals.llm
                      const highlights = getModelHighlights(model)
                      const guide = modelRouteGuides[model.component]
                      const statusMeta = getModelStatusMeta(model.status)

                      return (
                        <div key={model.id} className="settings-models-panel rounded-2xl border p-5">
                          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                            <div className="flex min-w-0 flex-1 items-start gap-4">
                              <div
                                className={cn(
                                  "settings-model-icon-shell flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                                  visual.surfaceClassName,
                                )}
                              >
                                {React.createElement(visual.icon, {
                                  className: cn("h-5 w-5", visual.iconClassName),
                                })}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium">{model.name}</span>
                                  <Badge variant={statusMeta.variant} className={statusMeta.className || undefined}>
                                    {statusMeta.label}
                                  </Badge>
                                  <Badge variant="outline" className={modelTypeTagClassNames[model.component]}>
                                    {modelTypeLabels[model.component]}
                                  </Badge>
                                  <Badge variant="secondary" className="capitalize">
                                    {providerLabels[model.provider] || model.provider.replaceAll("_", " ")}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-sm leading-6 text-foreground/90">{guide.summary}</p>
                                <p className="mt-1 text-xs leading-5 text-muted-foreground">{guide.impact}</p>
                                <div className="mt-3 rounded-xl border bg-muted/25 px-4 py-3">
                                  <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                    当前接入摘要
                                  </div>
                                  <div className="mt-2 break-all text-xs leading-6 text-foreground/90">
                                    {getModelConnectionSummary(model)}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-3 xl:w-[19rem] xl:grid-cols-1">
                              {highlights.map((item) => (
                                <div key={`${model.id}-${item.label}`} className="rounded-xl border bg-muted/20 px-4 py-3">
                                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                    {item.label}
                                  </div>
                                  <div className="mt-2 text-sm font-medium leading-tight">{item.value}</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {isDownloading ? (
                            <div className="mt-4 space-y-2">
                              <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                                <span className="min-w-0 truncate">
                                  下载中 {Math.round(downloadPercent)}% · {model.download?.message || "正在下载模型文件..."}
                                </span>
                                <span className="shrink-0">{Math.round(downloadPercent)}%</span>
                              </div>
                              <Progress
                                value={downloadPercent}
                                className="h-2 bg-primary/10"
                                indicatorClassName="download-progress-indicator"
                              />
                            </div>
                          ) : null}

                          {model.download?.message && !isDownloading ? (
                            <div className="mt-4 rounded-xl border border-dashed bg-background/70 px-4 py-3 text-xs leading-6 text-muted-foreground">
                              {model.download.message}
                            </div>
                          ) : null}

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs leading-5 text-muted-foreground">{guide.setupHint}</p>
                            <div className="flex flex-wrap gap-2">
                              {model.supports_managed_download ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busyModelId === model.id}
                                  onClick={() => onManagedModelAction(model)}
                                >
                                  {isDownloading ? null : model.is_installed ? (
                                    <RefreshCw className="mr-1 h-4 w-4" />
                                  ) : (
                                    <CloudDownload className="mr-1 h-4 w-4" />
                                  )}
                                  {isDownloading ? "取消下载" : model.is_installed ? "刷新检测" : model.component === "whisper" ? "下载" : "安装"}
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busyModelId === model.id}
                                  onClick={() => onReloadModel(model.id)}
                                >
                                  <RefreshCw className="mr-1 h-4 w-4" />
                                  刷新检测
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busyModelId === model.id || isDownloading}
                                onClick={() => onConfigureModel(model)}
                              >
                                配置
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}

            {models.length === 0 ? (
              <div className="settings-models-panel rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                当前没有可展示的模型配置
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed bg-muted/15 px-5 py-4">
                <div className="text-sm font-medium">关于模型条目维护</div>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">
                  当前项目的模型条目由系统固定维护，建议直接配置已有环节，不再提供无效的“新增模型”入口，避免用户误以为可以随意增加链路节点。
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
