import type { LocalModelsMigrationResponse } from "@vidgnost/contracts"

export class LocalModelMigrationService {
  async migrate(targetRoot: string): Promise<LocalModelsMigrationResponse> {
    return {
      target_root: targetRoot,
      message: "当前 TS 迁移阶段尚未发现需要搬迁的本地模型。",
      requires_confirmation: false,
      planned_model_ids: [],
      running_tasks: [],
      moved: [],
      skipped: [],
      ollama_restarted: false,
      warnings: [],
    }
  }
}
