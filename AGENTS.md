# AGENTS Internal Doc Index

Scope: this file is an internal navigation index for coding agents and maintainers.

## 1) Global Collaboration Rules
- Response language: Simplified Chinese
- Frontend package manager: use `pnpm` (do not use `npm`)
- Generated file encoding: UTF-8 without BOM
- Python dependency management: use `uv` with project-level venv; add/remove deps via `uv add` / `uv remove`
- GitHub operations: prefer using `gh` CLI commands when possible.
- After completing a requirement change, automatically determine whether a commit is needed; if needed, commit and push following `docs/git-commit-convention.md` without additional confirmation.

## 2) Core Product Docs
- Project overview (EN): `README.md`
- Project overview (ZH): `README.zh-CN.md`
- Multimodal roadmap: `docs/multimodal-transcription-roadmap.md`

## 3) UI Prompt Source
- Main UI prompt (single source of truth): `docs/ui/vidsense-ui-prompt.md`

## 4) Git Commit Convention
- Commit convention guide (Conventional Commits 1.0.0 aligned): `docs/git-commit-convention.md`

## 5) OpenSpec Entry
- OpenSpec index: `docs/openspec/README.md`
- OpenSpec beginner tutorial: `docs/OpenSpec-beginner-guide.zh-CN.md`

## 6) OpenSpec Active Change
- Change ID root: `docs/openspec/changes/build-lightweight-v2/`
- Change manifest: `docs/openspec/changes/build-lightweight-v2/.openspec.yaml`
- Proposal: `docs/openspec/changes/build-lightweight-v2/proposal.md`
- Design: `docs/openspec/changes/build-lightweight-v2/design.md`
- Tasks: `docs/openspec/changes/build-lightweight-v2/tasks.md`

## 7) OpenSpec Requirement Files (Active Change)
- Video ingestion: `docs/openspec/changes/build-lightweight-v2/specs/video-ingestion/spec.md`
- Transcription pipeline: `docs/openspec/changes/build-lightweight-v2/specs/transcription-pipeline/spec.md`
- SSE runtime stream: `docs/openspec/changes/build-lightweight-v2/specs/sse-runtime-stream/spec.md`
- LLM runtime config: `docs/openspec/changes/build-lightweight-v2/specs/llm-runtime-config/spec.md`
- LLM summary + mindmap: `docs/openspec/changes/build-lightweight-v2/specs/llm-summary-mindmap/spec.md`
- History and export: `docs/openspec/changes/build-lightweight-v2/specs/history-and-export/spec.md`
- Web workbench UI: `docs/openspec/changes/build-lightweight-v2/specs/web-workbench-ui/spec.md`

## 8) OpenSpec Base Specs (Current Baseline)
- Base specs index: `docs/openspec/specs/README.md`
- Video ingestion: `docs/openspec/specs/video-ingestion/spec.md`
- Transcription pipeline: `docs/openspec/specs/transcription-pipeline/spec.md`
- SSE runtime stream: `docs/openspec/specs/sse-runtime-stream/spec.md`
- LLM runtime config: `docs/openspec/specs/llm-runtime-config/spec.md`
- LLM summary + mindmap: `docs/openspec/specs/llm-summary-mindmap/spec.md`
- History and export: `docs/openspec/specs/history-and-export/spec.md`
- Web workbench UI: `docs/openspec/specs/web-workbench-ui/spec.md`

## 9) OpenSpec Templates and Archive
- Change template root: `docs/openspec/templates/change-template/`
- Template manifest: `docs/openspec/templates/change-template/.openspec.yaml`
- Template proposal: `docs/openspec/templates/change-template/proposal.md`
- Template design: `docs/openspec/templates/change-template/design.md`
- Template tasks: `docs/openspec/templates/change-template/tasks.md`
- Template spec sample: `docs/openspec/templates/change-template/specs/example-capability/spec.md`
- Archived changes root: `docs/openspec/changes/archive/`
- Archive guide: `docs/openspec/changes/archive/README.md`

## 10) OpenSpec Checker Scripts
- Python checker: `scripts/check-openspec.py`
- Shell wrapper: `scripts/check-openspec.sh`
- PowerShell wrapper: `scripts/check-openspec.ps1`
- Usage:
  - Linux/WSL: `bash scripts/check-openspec.sh`
  - Windows: `powershell -ExecutionPolicy Bypass -File scripts/check-openspec.ps1`

## 11) Maintenance Rule
- Keep `AGENTS.md` as index-only.
- Put UI prompt details in `docs/ui/vidsense-ui-prompt.md`.
- When behavior changes, sync OpenSpec docs under the active change first, then promote stable rules to `docs/openspec/specs/`.
- Before merging major doc/spec changes, run OpenSpec checker scripts:
  - `scripts/check-openspec.py`
  - `scripts/check-openspec.sh`
  - `scripts/check-openspec.ps1`
