# AGENTS 内部文档索引

适用范围：本文件是面向编码助手与维护者的导航索引，不是产品说明。

## 1) 全局协作约定

- 回复语言：简体中文
- 包管理器：使用 `pnpm`（不要使用 `npm`）
- 生成文件编码：UTF-8 无 BOM
- 运行时基线：`apps/desktop + apps/api + packages/*`
- GitHub 操作：优先使用 `gh` CLI
- 文档风格：一律写成「当前基线」陈述，并与实现保持同步
- 规格同步规则：代码变更必须同时检查受影响的 OpenSpec 文档；
  新增或变更的接口、状态、参数、约束、错误处理与 UI 行为都要在同一交付里反映到规格中；
  若确认规格无需改动，必须明确说明「现有规格已覆盖最新实现」。
- 规格状态词汇：只使用 `planned`、`partial`、`implemented`；
  只有代码、测试、规格与验证证据齐备时才允许写 `implemented`。
- 关键模块映射规则：改动以下路径时必须复核对应的 OpenSpec 能力目录：
  `apps/api/src/media/**`、`apps/api/src/asr/**`、`apps/api/src/insight/**`、
  `apps/api/src/retrieval/**`、`apps/api/src/pipeline/**`、`apps/api/src/providers/**`、
  `apps/api/src/store/**`、`apps/api/src/routes/**`、`apps/desktop/src/components/**`、
  `apps/desktop/src/stores/**`、`packages/contracts/src/**`。
- 完成需求变更后，自动判断是否需要提交；需要时按 `docs/git-commit-convention.md` 提交并推送，无需再次确认。

## 2) 核心产品文档

- 项目简介（EN）：`README.md`
- 项目简介（ZH）：`README.zh-CN.md`
- 当前技术栈：`docs/current-tech-stack.zh-CN.md`

## 3) Git 工作流

- 提交规范：`docs/git-commit-convention.md`
- 交付分支：使用当前需求指定的工作分支，未获明确要求不要自动合并到 `master`。

## 4) OpenSpec 入口

- OpenSpec 索引：`docs/openspec/README.md`
- 基线规格根目录：`docs/openspec/specs/`

## 5) OpenSpec 当前变更

- 变更根目录：`docs/openspec/changes/v3-video-knowledge-engine/`
- 清单：`docs/openspec/changes/v3-video-knowledge-engine/.openspec.yaml`
- 提案：`docs/openspec/changes/v3-video-knowledge-engine/proposal.md`
- 设计：`docs/openspec/changes/v3-video-knowledge-engine/design.md`
- 任务：`docs/openspec/changes/v3-video-knowledge-engine/tasks.md`

## 6) OpenSpec 能力规格（当前变更）

- 来源接入：`docs/openspec/changes/v3-video-knowledge-engine/specs/video-ingestion/spec.md`
- 转写管线：`docs/openspec/changes/v3-video-knowledge-engine/specs/transcription-pipeline/spec.md`
- 洞察生成：`docs/openspec/changes/v3-video-knowledge-engine/specs/insight-generation/spec.md`
- 视觉增强：`docs/openspec/changes/v3-video-knowledge-engine/specs/visual-enrichment/spec.md`
- 知识检索：`docs/openspec/changes/v3-video-knowledge-engine/specs/knowledge-retrieval/spec.md`
- 模型路由：`docs/openspec/changes/v3-video-knowledge-engine/specs/model-routing/spec.md`
- 管线运行时：`docs/openspec/changes/v3-video-knowledge-engine/specs/pipeline-runtime/spec.md`
- 资产与导出：`docs/openspec/changes/v3-video-knowledge-engine/specs/library-and-export/spec.md`
- 桌面工作台 UI：`docs/openspec/changes/v3-video-knowledge-engine/specs/desktop-studio-ui/spec.md`

## 7) OpenSpec 基线规格

与第 6 节能力目录一一对应，路径为 `docs/openspec/specs/<capability>/spec.md`。

## 8) OpenSpec 模板与归档

- 变更模板：`docs/openspec/templates/change-template/`
- 归档目录：`docs/openspec/changes/archive/`
- 归档说明：`docs/openspec/changes/archive/README.md`

## 9) 启动脚本

- 根目录一键启动（Windows）：`start-all.ps1`
- 根目录一键启动（Linux/macOS/WSL）：`start-all.sh`
- 包裹脚本：`scripts/bootstrap-and-run.ps1`、`scripts/bootstrap-and-run.sh`
- 工作区清理：`scripts/clean-workspace.ps1`、`scripts/clean-workspace.sh`

## 10) 校验脚本

- OpenSpec 校验：`scripts/check-openspec.mjs`（包裹：`.sh` / `.ps1`）
- 规格同步守卫：`scripts/check-spec-sync.mjs`
- 暂存区密钥扫描：`scripts/sanitize-staged-secrets.mjs`

## 11) 维护规则

- 保持 `AGENTS.md` 作为索引文件（导航 + 全局约束）。
- 当前变更规格与基线规格必须保持同步，稳定能力以基线规格为准。
- 代码变更与规格加密是同一次维护动作；不要让代码领先于规格。
- 当 `tasks.md` 把某项标记为完成时，同一交付里必须包含对应的实现或测试证据。
- 合并重大文档或规格变更前运行：
  - `node scripts/check-openspec.mjs`
  - `bash scripts/check-openspec.sh`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\check-openspec.ps1`
