# OpenSpec 文档索引

本目录用于管理本项目的 OpenSpec 规范文档与流程资产。

## 1. 新手入口

- 小白完整教程（推荐先读）：
  - `docs/OpenSpec-beginner-guide.zh-CN.md`

## 2. 当前变更

- Active change root:
  - `docs/openspec/changes/build-lightweight-v2/`
- Manifest:
  - `docs/openspec/changes/build-lightweight-v2/.openspec.yaml`
- Proposal:
  - `docs/openspec/changes/build-lightweight-v2/proposal.md`
- Design:
  - `docs/openspec/changes/build-lightweight-v2/design.md`
- Tasks:
  - `docs/openspec/changes/build-lightweight-v2/tasks.md`
- Active capability specs:
  - `docs/openspec/changes/build-lightweight-v2/specs/video-ingestion/spec.md`
  - `docs/openspec/changes/build-lightweight-v2/specs/transcription-pipeline/spec.md`
  - `docs/openspec/changes/build-lightweight-v2/specs/sse-runtime-stream/spec.md`
  - `docs/openspec/changes/build-lightweight-v2/specs/llm-runtime-config/spec.md`
  - `docs/openspec/changes/build-lightweight-v2/specs/llm-summary-mindmap/spec.md`
  - `docs/openspec/changes/build-lightweight-v2/specs/history-and-export/spec.md`
  - `docs/openspec/changes/build-lightweight-v2/specs/web-workbench-ui/spec.md`
  - `docs/openspec/changes/build-lightweight-v2/specs/study-domain/spec.md`

## 3. 基线规格（Base Specs）

稳定后的能力要求沉淀在这里：

- `docs/openspec/specs/`
- 当前基线能力包括：
  - `video-ingestion`
  - `transcription-pipeline`
  - `sse-runtime-stream`
  - `llm-runtime-config`
  - `llm-summary-mindmap`
  - `history-and-export`
  - `web-workbench-ui`
  - `study-domain`

## 4. 归档区

已完成并归档的 change 放这里：

- `docs/openspec/changes/archive/`
- 归档规则见：
  - `docs/openspec/changes/archive/README.md`

## 5. 模板区

新建 change 时优先从模板复制：

- `docs/openspec/templates/change-template/`

## 6. 自动检查脚本

用于检查 OpenSpec 目录结构与基础内容质量：

- Linux/WSL:
  - `bash scripts/check-openspec.sh`
- Windows PowerShell:
  - `powershell -ExecutionPolicy Bypass -File scripts/check-openspec.ps1`
- 直接运行 Node:
  - `node scripts/check-openspec.mjs`

提交与远程校验守卫：

- Git pre-commit hook:
  - `scripts/check-spec-sync.mjs`
- GitHub Actions workflow:
  - `.github/workflows/spec-sync.yml`

## 7. 同步约束

1. 只要项目代码发生变更，就必须同步审查受影响的 OpenSpec 文档。
2. Spec 文档的信息密度必须和当前实现保持同级别对齐，不能只保留概述而遗漏真实接口、状态、参数、约束、错误处理或关键 UI 行为。
3. 如果本次代码变更不需要改动 spec 文本，也必须确认现有 spec 已经完整覆盖最新实现细节。
4. OpenSpec 中出现实现状态时，统一使用三种术语：
   - `planned`：仅作为目标能力或扩展位，当前不能按已交付验收
   - `partial`：当前有收缩版实现，但不能按原完整设计验收
   - `implemented`：代码、测试、OpenSpec 与验证命令已经对齐

## 8. 推荐流程

1. 中大型功能先写或先改 spec，再动代码。
2. 代码实现完成后，同步更新受影响的 base spec、active change spec、README 和相关运维文档。
3. 只有在代码、测试、OpenSpec、README、验证命令都对齐后，任务项才能从 `planned/partial` 进入 `implemented`。
4. 修改 `tasks.md` 时，必须让勾选状态与真实交付深度一致，不能用“先打勾、后补实现”的方式管理完成度。
