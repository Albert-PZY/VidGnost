# AGENTS Internal Doc Index

Scope: this file is an internal navigation index for coding agents and maintainers.

## 1) Global Collaboration Rules
- Response language: Simplified Chinese
- Workspace package manager: use `pnpm` (do not use `npm`)
- Generated file encoding: UTF-8 without BOM
- Runtime stack baseline: `frontend + backend-ts + packages/*`
- GitHub operations: prefer using `gh` CLI commands when possible
- Documentation style: write all project docs as current baseline statements and keep them aligned with implementation
- Spec sync rule: whenever project code changes, automatically review the impacted OpenSpec docs and sync their information density to the implementation in the same delivery. New or changed interfaces, states, parameters, constraints, error handling, and UI behavior must be reflected in spec updates; if no spec text changes are needed, explicitly verify that the existing spec already matches the latest code detail.
- After completing a requirement change, automatically determine whether a commit is needed; if needed, commit and push following `docs/git-commit-convention.md` without additional confirmation

## 2) Core Product Docs
- Project overview (EN): `README.md`
- Project overview (ZH): `README.zh-CN.md`
- TS fullstack refactor checklist: `docs/vidgnost-ts-fullstack-refactor-checklist.zh-CN.md`
- Frontend-driven backend checklist: `docs/frontend-driven-backend-execution-checklist.zh-CN.md`
- Current technical stack: `docs/current-tech-stack.zh-CN.md`
- Frontend design prompt: `docs/vidgnost-system-design-prompt.md`

## 3) Git Workflow Doc
- Commit convention guide (Conventional Commits aligned): `docs/git-commit-convention.md`
- Delivery branch: use the user-designated working branch for the current requirement and do not auto-merge into `master` unless the user explicitly requests it.

## 4) OpenSpec Entry
- OpenSpec index: `docs/openspec/README.md`
- OpenSpec base specs index: `docs/openspec/specs/README.md`

## 5) OpenSpec Active Change
- Active change root: `docs/openspec/changes/build-lightweight-v2/`
- Change manifest: `docs/openspec/changes/build-lightweight-v2/.openspec.yaml`
- Proposal: `docs/openspec/changes/build-lightweight-v2/proposal.md`
- Design: `docs/openspec/changes/build-lightweight-v2/design.md`
- Tasks: `docs/openspec/changes/build-lightweight-v2/tasks.md`

## 6) OpenSpec Requirement Files (Active Change)
- Video ingestion: `docs/openspec/changes/build-lightweight-v2/specs/video-ingestion/spec.md`
- Transcription pipeline: `docs/openspec/changes/build-lightweight-v2/specs/transcription-pipeline/spec.md`
- SSE runtime stream: `docs/openspec/changes/build-lightweight-v2/specs/sse-runtime-stream/spec.md`
- LLM runtime config: `docs/openspec/changes/build-lightweight-v2/specs/llm-runtime-config/spec.md`
- LLM summary + mindmap: `docs/openspec/changes/build-lightweight-v2/specs/llm-summary-mindmap/spec.md`
- History and export: `docs/openspec/changes/build-lightweight-v2/specs/history-and-export/spec.md`
- Web workbench UI: `docs/openspec/changes/build-lightweight-v2/specs/web-workbench-ui/spec.md`

## 7) OpenSpec Base Specs
- Video ingestion: `docs/openspec/specs/video-ingestion/spec.md`
- Transcription pipeline: `docs/openspec/specs/transcription-pipeline/spec.md`
- SSE runtime stream: `docs/openspec/specs/sse-runtime-stream/spec.md`
- LLM runtime config: `docs/openspec/specs/llm-runtime-config/spec.md`
- LLM summary + mindmap: `docs/openspec/specs/llm-summary-mindmap/spec.md`
- History and export: `docs/openspec/specs/history-and-export/spec.md`
- Web workbench UI: `docs/openspec/specs/web-workbench-ui/spec.md`

## 8) OpenSpec Templates and Archive
- Change template root: `docs/openspec/templates/change-template/`
- Template manifest: `docs/openspec/templates/change-template/.openspec.yaml`
- Template proposal: `docs/openspec/templates/change-template/proposal.md`
- Template design: `docs/openspec/templates/change-template/design.md`
- Template tasks: `docs/openspec/templates/change-template/tasks.md`
- Template spec sample: `docs/openspec/templates/change-template/specs/example-capability/spec.md`
- Archived changes root: `docs/openspec/changes/archive/`
- Archive guide: `docs/openspec/changes/archive/README.md`

## 9) Startup Scripts
- Root one-click startup (Windows): `start-all.ps1`
- Root one-click startup (Linux/macOS/WSL): `start-all.sh`
- Script wrappers:
  - `scripts/bootstrap-and-run.ps1`
  - `scripts/bootstrap-and-run.sh`
- Workspace cleanup:
  - `scripts/clean-workspace.ps1`
  - `scripts/clean-workspace.sh`

## 10) OpenSpec Checker Scripts
- Node checker: `scripts/check-openspec.mjs`
- Shell wrapper: `scripts/check-openspec.sh`
- PowerShell wrapper: `scripts/check-openspec.ps1`
- Spec sync guard: `scripts/check-spec-sync.mjs`
- Staged secret guard: `scripts/sanitize-staged-secrets.mjs`

## 11) Maintenance Rules
- Keep `AGENTS.md` as an index file (navigation + global constraints).
- Keep active change specs and baseline specs aligned for stable capability contracts.
- Treat code change and spec densification as a single maintenance action; do not leave updated code behind coarser or stale specs.
- Before merging major doc/spec changes, run:
  - `node scripts/check-openspec.mjs`
  - `bash scripts/check-openspec.sh`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\check-openspec.ps1`
