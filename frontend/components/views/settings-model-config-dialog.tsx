"use client"

import * as React from "react"
import { FolderOpen, RefreshCw, Save } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { LLMConfigResponse, ModelDescriptor, WhisperConfigResponse } from "@/lib/types"
import {
  getModelConfigPreset,
  getModelProviderOptions,
  getModelStatusMeta,
  modelRouteGuides,
  modelTypeLabels,
  modelTypeTagClassNames,
  modelVisuals,
  providerLabels,
  recommendedRemoteModels,
  type LLMConfigFormState,
  type ModelConfigFormState,
} from "@/components/views/settings-models-shared"

interface SettingsModelConfigDialogProps {
  open: boolean
  editingModel: ModelDescriptor | null
  modelForm: ModelConfigFormState
  llmForm: LLMConfigFormState
  whisperConfig: WhisperConfigResponse | null
  isSavingModel: boolean
  isUpdatingWhisper: boolean
  isLoading: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => void
  onRefreshWhisperRuntimeStatus: () => void
  onBrowseModelPath: () => void
  onGpuToggle: (checked: boolean) => void
  setModelForm: React.Dispatch<React.SetStateAction<ModelConfigFormState>>
  setLlmForm: React.Dispatch<React.SetStateAction<LLMConfigFormState>>
}

function StepHeader({
  step,
  title,
  description,
}: {
  step: string
  title: string
  description: string
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-primary/80">{step}</div>
      <div className="text-base font-semibold leading-tight">{title}</div>
      <p className="text-xs leading-6 text-muted-foreground">{description}</p>
    </div>
  )
}

export function SettingsModelConfigDialog({
  open,
  editingModel,
  modelForm,
  llmForm,
  whisperConfig,
  isSavingModel,
  isUpdatingWhisper,
  isLoading,
  onOpenChange,
  onSave,
  onRefreshWhisperRuntimeStatus,
  onBrowseModelPath,
  onGpuToggle,
  setModelForm,
  setLlmForm,
}: SettingsModelConfigDialogProps) {
  const activeModelPreset = editingModel ? getModelConfigPreset(editingModel) : null
  const modelProviderOptions = editingModel ? getModelProviderOptions(editingModel) : []
  const showRemoteApiFields = Boolean(modelForm.provider === "openai_compatible" && editingModel)
  const showLlmCorrectionFields = Boolean(editingModel?.component === "llm")
  const showModelPathField = Boolean(activeModelPreset?.fields.includes("path") && modelForm.provider !== "openai_compatible")
  const showImageApiFields = Boolean(
    showRemoteApiFields && editingModel && ["embedding", "vlm", "rerank", "mllm"].includes(editingModel.component),
  )
  const modelDialogHasQuantization = Boolean(activeModelPreset?.fields.includes("quantization"))
  const modelDialogHasBatchSize = Boolean(activeModelPreset?.fields.includes("max_batch_size"))
  const modelDialogHasRerankTopN = Boolean(activeModelPreset?.fields.includes("rerank_top_n"))
  const modelDialogHasFrameInterval = Boolean(activeModelPreset?.fields.includes("frame_interval_seconds"))
  const remoteModelRecommendations = editingModel ? recommendedRemoteModels[editingModel.component] || [] : []
  const guide = editingModel ? modelRouteGuides[editingModel.component] : null
  const visual = editingModel ? modelVisuals[editingModel.component] || modelVisuals.llm : null
  const isWhisperDialog = editingModel?.component === "whisper"
  const statusMeta = editingModel ? getModelStatusMeta(editingModel.status) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="model-config-dialog flex w-[min(96vw,85rem)] max-h-[90vh] max-w-[85rem] flex-col gap-0 overflow-hidden p-0 sm:max-w-[85rem]">
        <DialogHeader className="model-config-dialog-header shrink-0 border-b bg-card px-6 py-3 pr-10">
          <DialogTitle className="text-base font-semibold leading-tight">
            {activeModelPreset?.title || "模型常用配置"}
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-normal text-muted-foreground">
            {activeModelPreset?.description || "更新模型配置。"}
          </DialogDescription>
        </DialogHeader>

        <div className="model-config-dialog-scroll themed-thin-scrollbar dialog-ultra-thin-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-6 px-6 py-6 xl:grid-cols-[minmax(24rem,28rem)_minmax(0,1fr)]">
            <div className="space-y-5">
              {editingModel && guide && visual ? (
                <div className="model-config-dialog-panel rounded-2xl border bg-card p-6">
                  <div className="space-y-5">
                    <div className="flex items-start gap-4">
                      <div
                        className={cn(
                          "settings-model-icon-shell flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/40",
                          visual.surfaceClassName,
                        )}
                      >
                        {React.createElement(visual.icon, {
                          className: cn("h-5 w-5", visual.iconClassName),
                        })}
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="min-w-0 text-lg font-medium leading-tight text-foreground">{editingModel.name}</div>
                          <Badge
                            variant="outline"
                            className={cn("rounded-md border bg-background/80", modelTypeTagClassNames[editingModel.component])}
                          >
                            {modelTypeLabels[editingModel.component]}
                          </Badge>
                        </div>
                        <div className="break-all text-xs leading-relaxed text-muted-foreground">
                          {modelForm.model_id || editingModel.model_id}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-md border bg-background/80 text-foreground/90">
                        {`服务商 · ${(providerLabels[modelForm.provider] || modelForm.provider).replaceAll("_", " ")}`}
                      </Badge>
                      {statusMeta ? (
                        <Badge variant={statusMeta.variant} className={statusMeta.className || undefined}>
                          {statusMeta.label}
                        </Badge>
                      ) : null}
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-md border bg-background/80",
                          editingModel.is_installed ? "border-status-success/35 text-status-success" : "text-muted-foreground",
                        )}
                      >
                        {editingModel.is_installed ? "已安装" : "未安装"}
                      </Badge>
                    </div>

                    <div className="rounded-xl border bg-muted/25 p-4">
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">这一环节负责什么</div>
                      <p className="mt-2 text-sm leading-6 text-foreground/90">{guide.summary}</p>
                      <p className="mt-2 text-xs leading-6 text-muted-foreground">{guide.impact}</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                      <div className="rounded-xl border bg-muted/25 p-4">
                        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">当前接入</div>
                        <div className="mt-2 break-all text-sm leading-6 text-foreground/90">
                          {modelForm.provider === "openai_compatible"
                            ? modelForm.api_model || "未设置模型名"
                            : modelForm.path || editingModel.path || editingModel.default_path || "使用默认托管目录"}
                        </div>
                      </div>
                      <div className="rounded-xl border bg-muted/25 p-4">
                        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">当前作用范围</div>
                        <div className="mt-2 text-sm font-medium leading-tight text-foreground">
                          {modelForm.enabled ? "已参与默认链路" : "当前已停用"}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{modelForm.enabled ? "保存后会继续参与任务执行" : "保存后只保留配置，不参与运行"}</p>
                      </div>
                    </div>

                    <div className="rounded-xl border bg-muted/25 p-4">
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">建议操作顺序</div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{guide.setupHint}</p>
                      <p className="mt-2 text-xs leading-6 text-muted-foreground">
                        {activeModelPreset?.note || "调整常用运行参数，保存后同步后端配置。"}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-5">
              <div className="model-config-dialog-panel rounded-2xl border bg-card p-5 md:p-6">
                <StepHeader
                  step="01"
                  title="接入方式与身份"
                  description="先决定这一环节通过哪种方式运行，再填写模型标识、目录或远端接口信息。"
                />

                <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>服务商</Label>
                    {modelProviderOptions.length === 1 ? (
                      <Input
                        className="bg-background/80"
                        value={modelProviderOptions[0]?.label || providerLabels[modelForm.provider] || modelForm.provider}
                        readOnly
                      />
                    ) : (
                      <Select
                        value={modelForm.provider}
                        onValueChange={(value) =>
                          setModelForm((current) => ({
                            ...current,
                            provider: value,
                          }))
                        }
                      >
                        <SelectTrigger className="model-config-dialog-select-trigger bg-background/80">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="model-config-select-content">
                          {modelProviderOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <p className="text-xs text-muted-foreground">这里决定当前环节默认走本地还是在线路线。</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="model-id">模型标识</Label>
                    <Input
                      id="model-id"
                      className="bg-background/80"
                      placeholder={modelForm.provider === "ollama" ? "如 qwen2.5:3b / moondream" : "逻辑模型标识"}
                      value={modelForm.model_id}
                      onChange={(event) =>
                        setModelForm((current) => ({
                          ...current,
                          model_id: event.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {modelForm.provider === "ollama"
                        ? "用于和 Ollama 中的模型名称对应。"
                        : "用于标记当前模型条目，不等同于远端真实模型名。"}
                    </p>
                  </div>

                  {showModelPathField ? (
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="model-path">{activeModelPreset?.pathLabel || "模型目录"}</Label>
                      <div className="flex gap-2">
                        <Input
                          id="model-path"
                          className="bg-background/80"
                          placeholder={activeModelPreset?.pathPlaceholder || "填写模型目录"}
                          value={modelForm.path}
                          onChange={(event) =>
                            setModelForm((current) => ({
                              ...current,
                              path: event.target.value,
                            }))
                          }
                        />
                        <Button variant="outline" className="shrink-0" onClick={onBrowseModelPath}>
                          <FolderOpen className="mr-2 h-4 w-4" />
                          浏览
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">本地目录会直接作为当前模型的默认加载位置。</p>
                    </div>
                  ) : null}
                  {showRemoteApiFields ? (
                    <>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="remote-base-url">Base URL</Label>
                        <Input
                          id="remote-base-url"
                          className="bg-background/80"
                          placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                          value={modelForm.api_base_url}
                          onChange={(event) =>
                            setModelForm((current) => ({ ...current, api_base_url: event.target.value }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          后端会根据服务地址和模型类型自动选择兼容适配方式，无需再手动选协议。
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="remote-model">调用模型名</Label>
                        <Input
                          id="remote-model"
                          className="bg-background/80"
                          placeholder={remoteModelRecommendations.join(" / ") || "填写远端模型名"}
                          value={modelForm.api_model}
                          onChange={(event) =>
                            setModelForm((current) => ({ ...current, api_model: event.target.value }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          与服务商控制台中的可调用模型名保持一致。
                          {remoteModelRecommendations.length > 0 ? ` 推荐：${remoteModelRecommendations.join("、")}` : ""}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="remote-api-key">API Key</Label>
                        <Input
                          id="remote-api-key"
                          className="bg-background/80"
                          type="password"
                          placeholder="输入模型提供商的 API Key"
                          value={modelForm.api_key}
                          onChange={(event) =>
                            setModelForm((current) => ({ ...current, api_key: event.target.value }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">仅当前环节会读取这里保存的密钥。</p>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="model-config-dialog-panel rounded-2xl border bg-card p-5 md:p-6">
                <StepHeader
                  step="02"
                  title="运行参数"
                  description="这一组控制本地吞吐、资源占用和链路是否启用，建议先用默认值，再按机器负载微调。"
                />

                <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                  {activeModelPreset?.fields.includes("load_profile") ? (
                    <div className="space-y-2">
                      <Label>加载策略</Label>
                      <Select
                        value={modelForm.load_profile}
                        onValueChange={(value) =>
                          setModelForm((current) => ({ ...current, load_profile: value }))
                        }
                      >
                        <SelectTrigger className="model-config-dialog-select-trigger bg-background/80">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="model-config-select-content">
                          <SelectItem value="balanced">balanced</SelectItem>
                          <SelectItem value="memory_first">memory_first</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">根据模型体积与硬件资源选择常驻或平衡模式。</p>
                    </div>
                  ) : null}

                  {modelDialogHasQuantization && modelForm.provider !== "openai_compatible" ? (
                    <div className="space-y-2">
                      <Label htmlFor="model-quantization">{activeModelPreset?.quantizationLabel || "量化格式"}</Label>
                      <Input
                        id="model-quantization"
                        className="bg-background/80"
                        placeholder={activeModelPreset?.quantizationPlaceholder || "如 int8 / 4bit / fp16"}
                        value={modelForm.quantization}
                        onChange={(event) =>
                          setModelForm((current) => ({
                            ...current,
                            quantization: event.target.value,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">推荐与当前模型文件实际格式保持一致，避免加载异常。</p>
                    </div>
                  ) : null}

                  {modelDialogHasFrameInterval ? (
                    <div className="space-y-2">
                      <Label htmlFor="model-frame-interval">{activeModelPreset?.batchLabel || "抽帧间隔（秒）"}</Label>
                      <Input
                        id="model-frame-interval"
                        className="bg-background/80"
                        type="number"
                        min={1}
                        max={600}
                        value={modelForm.frame_interval_seconds}
                        onChange={(event) =>
                          setModelForm((current) => ({
                            ...current,
                            frame_interval_seconds: event.target.value,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        {activeModelPreset?.batchDescription || "控制证据图抽帧频率。"}
                      </p>
                    </div>
                  ) : null}

                  {modelDialogHasBatchSize ? (
                    <div className="space-y-2">
                      <Label htmlFor="model-max-batch">{activeModelPreset?.batchLabel || "最大批大小"}</Label>
                      <Input
                        id="model-max-batch"
                        className="bg-background/80"
                        type="number"
                        min={1}
                        max={64}
                        value={modelForm.max_batch_size}
                        onChange={(event) =>
                          setModelForm((current) => ({
                            ...current,
                            max_batch_size: event.target.value,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        {activeModelPreset?.batchDescription || "影响同批次吞吐与资源占用。"}
                      </p>
                    </div>
                  ) : null}

                  {modelDialogHasRerankTopN ? (
                    <div className="space-y-2">
                      <Label htmlFor="model-rerank-top-n">最终返回条数</Label>
                      <Input
                        id="model-rerank-top-n"
                        className="bg-background/80"
                        type="number"
                        min={1}
                        max={20}
                        value={modelForm.rerank_top_n}
                        onChange={(event) =>
                          setModelForm((current) => ({
                            ...current,
                            rerank_top_n: event.target.value,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        控制最终排序后交给问答模型的候选数量，前端问答界面会直接使用这里的默认值。
                      </p>
                    </div>
                  ) : null}

                  <div className="md:col-span-2">
                    <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/25 px-4 py-3.5">
                      <div className="min-w-0 space-y-1">
                        <Label className="leading-tight">启用状态</Label>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          关闭后模型不会参与当前默认链路，但会保留已保存的目录与参数。
                        </p>
                      </div>
                      <Switch
                        checked={modelForm.enabled}
                        onCheckedChange={(checked) =>
                          setModelForm((current) => ({ ...current, enabled: checked }))
                        }
                      />
                    </div>
                  </div>

                  {isWhisperDialog ? (
                    <div className="md:col-span-2">
                      <div className="rounded-xl border border-dashed bg-background/70 p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-1">
                            <div className="text-sm font-medium">Whisper GPU 加速</div>
                            <p className="text-xs leading-6 text-muted-foreground">
                              Faster-Whisper 会直接复用 Ollama 自带的 CUDA 运行库，不需要单独再装一套运行库。
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={whisperConfig?.device !== "cpu"}
                              disabled={isUpdatingWhisper}
                              onCheckedChange={onGpuToggle}
                            />
                            <span className="text-sm font-medium">{whisperConfig?.device !== "cpu" ? "GPU 模式" : "CPU 模式"}</span>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <div className="rounded-xl border bg-background/70 px-4 py-3">
                            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">运行库状态</p>
                            <p className="mt-2 text-sm font-medium">{whisperConfig?.runtime_libraries.ready ? "已就绪" : "未就绪"}</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{whisperConfig?.runtime_libraries.message || "等待检测"}</p>
                          </div>
                          <div className="rounded-xl border bg-background/70 px-4 py-3">
                            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">运行库目录</p>
                            <p className="mt-2 break-all text-sm leading-6 text-foreground/90">
                              {whisperConfig?.runtime_libraries.bin_dir || "未识别到 Ollama GPU 运行库目录"}
                            </p>
                          </div>
                          <div className="rounded-xl border bg-background/70 px-4 py-3">
                            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">环境同步</p>
                            <p className="mt-2 text-sm font-medium">
                              {whisperConfig?.runtime_libraries.path_configured ? "当前进程已同步" : "当前进程未同步"}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {whisperConfig?.runtime_libraries.version_label || "等待检测"}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-dashed bg-background/70 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">刷新检测</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              重新读取 Ollama 安装目录中的 GPU 运行库状态，并同步当前页面显示。
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isUpdatingWhisper || isLoading}
                            onClick={onRefreshWhisperRuntimeStatus}
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            刷新检测
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              {showRemoteApiFields ? (
                <div className="model-config-dialog-panel rounded-2xl border bg-card p-5 md:p-6">
                  <StepHeader
                    step="03"
                    title="在线 API 调优"
                    description="这部分主要控制远端请求超时和图像上传压缩策略，通常只在在线路线下需要修改。"
                  />

                  <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="remote-timeout">超时（秒）</Label>
                      <Input
                        id="remote-timeout"
                        className="bg-background/80"
                        type="number"
                        min={10}
                        max={600}
                        value={modelForm.api_timeout_seconds}
                        onChange={(event) =>
                          setModelForm((current) => ({
                            ...current,
                            api_timeout_seconds: event.target.value,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">控制当前组件请求远端接口的超时窗口。</p>
                    </div>

                    {showImageApiFields ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="remote-image-max-bytes">图片压缩上限（字节）</Label>
                          <Input
                            id="remote-image-max-bytes"
                            className="bg-background/80"
                            type="number"
                            min={32768}
                            max={8388608}
                            value={modelForm.api_image_max_bytes}
                            onChange={(event) =>
                              setModelForm((current) => ({
                                ...current,
                                api_image_max_bytes: event.target.value,
                              }))
                            }
                          />
                          <p className="text-xs text-muted-foreground">在线图像理解前会压缩图片，降低带宽占用并提升响应速度。</p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="remote-image-max-edge">图片最长边</Label>
                          <Input
                            id="remote-image-max-edge"
                            className="bg-background/80"
                            type="number"
                            min={256}
                            max={4096}
                            value={modelForm.api_image_max_edge}
                            onChange={(event) =>
                              setModelForm((current) => ({
                                ...current,
                                api_image_max_edge: event.target.value,
                              }))
                            }
                          />
                          <p className="text-xs text-muted-foreground">用于控制发送到远端接口的图像尺寸上限。</p>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {showLlmCorrectionFields ? (
                <div className="model-config-dialog-panel rounded-2xl border bg-card p-5 md:p-6">
                  <StepHeader
                    step={showRemoteApiFields ? "04" : "03"}
                    title="文本纠错设置"
                    description="这里会同步到摘要与纠错链路，决定转写文本在进入主生成阶段前如何被修整。"
                  />

                  <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>文本纠错模式</Label>
                      <Select
                        value={llmForm.correction_mode}
                        onValueChange={(value) =>
                          setLlmForm((current) => ({
                            ...current,
                            correction_mode: value as LLMConfigResponse["correction_mode"],
                          }))
                        }
                      >
                        <SelectTrigger className="model-config-dialog-select-trigger bg-background/80">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="model-config-select-content">
                          <SelectItem value="off">off</SelectItem>
                          <SelectItem value="strict">strict</SelectItem>
                          <SelectItem value="rewrite">rewrite</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">控制转写纠错阶段对原文的保守程度。</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="llm-correction-batch">纠错批大小</Label>
                      <Input
                        id="llm-correction-batch"
                        className="bg-background/80"
                        type="number"
                        min={6}
                        max={80}
                        value={llmForm.correction_batch_size}
                        onChange={(event) =>
                          setLlmForm((current) => ({
                            ...current,
                            correction_batch_size: event.target.value,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">批次越大吞吐越高，但失败重试成本也会增加。</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="llm-correction-overlap">纠错重叠</Label>
                      <Input
                        id="llm-correction-overlap"
                        className="bg-background/80"
                        type="number"
                        min={0}
                        max={20}
                        value={llmForm.correction_overlap}
                        onChange={(event) =>
                          setLlmForm((current) => ({
                            ...current,
                            correction_overlap: event.target.value,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">保留相邻片段重叠上下文，减少断句边界误差。</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="model-config-dialog-footer shrink-0 border-t bg-card px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={isSavingModel} onClick={onSave}>
            <Save className="mr-2 h-4 w-4" />
            保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
