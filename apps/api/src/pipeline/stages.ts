import type { StageId, StageState, TaskRecord } from "@vidgnost/contracts"

export interface StageDefinition {
  id: StageId
  label: string
  weight: number
  /** 该阶段依赖的模型角色，用于生成缓存签名。 */
  roles: string[]
  /** 该阶段是否受选项影响（vision / proofread / translate / preset / language）。 */
  optionKeys: Array<keyof import("@vidgnost/contracts").TaskOptions>
}

export const STAGE_DEFINITIONS: StageDefinition[] = [
  { id: "ingest", label: "来源准备", weight: 4, roles: [], optionKeys: [] },
  { id: "audio", label: "音频抽取", weight: 6, roles: [], optionKeys: [] },
  { id: "transcribe", label: "语音转写", weight: 26, roles: ["asr.online", "asr.local"], optionKeys: ["asr", "language"] },
  {
    id: "structure",
    label: "分段与章节",
    weight: 16,
    roles: ["llm.fast", "llm.balanced"],
    optionKeys: ["preset", "proofread"],
  },
  { id: "insight", label: "摘要洞察", weight: 16, roles: ["llm.fast", "llm.quality", "llm.bulk", "llm.reasoning"], optionKeys: ["preset"] },
  { id: "mindmap", label: "思维导图", weight: 6, roles: ["llm.balanced"], optionKeys: ["preset"] },
  { id: "knowledge", label: "知识图谱", weight: 8, roles: ["llm.balanced"], optionKeys: ["preset"] },
  { id: "vision", label: "画面理解", weight: 8, roles: ["vision.primary"], optionKeys: ["vision"] },
  { id: "index", label: "检索索引", weight: 8, roles: ["llm.fast", "embedding"], optionKeys: [] },
  { id: "finalize", label: "导出就绪", weight: 2, roles: [], optionKeys: ["translateTo"] },
]

export function initialStages(): StageState[] {
  return STAGE_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    status: "pending",
    progress: 0,
    message: "",
    weight: definition.weight,
    artifacts: [],
    calls: 0,
  }))
}

export function computeReadiness(stages: StageState[]): number {
  const total = stages.reduce((sum, stage) => sum + stage.weight, 0) || 1
  const earned = stages.reduce((sum, stage) => {
    if (stage.status === "succeeded" || stage.status === "skipped") {
      return sum + stage.weight
    }
    if (stage.status === "running") {
      return sum + stage.weight * Math.max(0, Math.min(1, stage.progress))
    }
    return sum
  }, 0)
  return Number((earned / total).toFixed(4))
}

export function updateStage(task: TaskRecord, stageId: StageId, patch: Partial<StageState>): TaskRecord {
  const stages = task.stages.map((stage) => (stage.id === stageId ? { ...stage, ...patch } : stage))
  return { ...task, stages, readiness: computeReadiness(stages) }
}

export function stageOf(task: TaskRecord, stageId: StageId): StageState {
  const stage = task.stages.find((item) => item.id === stageId)
  if (!stage) {
    throw new Error(`未知阶段：${stageId}`)
  }
  return stage
}
