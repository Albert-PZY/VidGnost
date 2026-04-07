## Why

VidGnost defines a practical video-analysis workbench for local execution plus online generation. The target is predictable operation on common developer machines, clear runtime observability, and reproducible deliverables that can be replayed and exported.

## What Changes

- Build a decoupled architecture with `FastAPI + React`.
- Support three ingestion paths: Bilibili URL, local path, and file upload.
- Implement asynchronous `A/B/C/D` runtime phases with explicit phase boundaries.
- Use local `Systran/faster-whisper-small` transcription on CPU.
- Auto-prepare Whisper `small` model files at task start when cache is missing, with realtime progress events.
- Run stage-`D` as ordered subchain: `transcript_optimize -> fusion_delivery`.
- Generate notes and mindmap through OpenAI-compatible online API.
- Stream logs/progress/transcript/generation deltas via SSE with per-event `trace_id`.
- Persist runtime warnings, event logs, stage snapshots, and stage artifacts for replay diagnostics.
- Provide runtime config center tabs: `在线 LLM`, `Faster-Whisper`, `Prompt Templates`.
- Persist runtime config in local files: `model_config.json`, `config.toml`, and prompt template files.
- Support prompt-template CRUD + active selection for summary and mindmap channels.
- Provide task history retrieval, title update, terminal-task deletion, and artifact markdown editing.
- Provide transcript / notes / mindmap / subtitle export and one-click bundle export.
- Provide quick-start docs view in workbench shell with bilingual content.

## Capabilities

### Core Capabilities
- `video-ingestion`: create tasks from URL/path/upload sources.
- `transcription-pipeline`: async phase pipeline with CPU Whisper transcription.
- `llm-summary-mindmap`: online generation for notes and markmap markdown.
- `sse-runtime-stream`: realtime task stream and self-check stream.
- `llm-runtime-config`: editable runtime config persisted in local storage files.
- `history-and-export`: replayable history and deterministic artifact export.
- `web-workbench-ui`: bilingual workbench with phase tabs and config center.

### Engineering Capabilities
- Stream/memory governance for long-running sessions.
- Stage-level metrics and artifact indexing for observability.
- Structured runtime-warning semantics for degraded-but-continuable conditions.

## Impact

- Repository modules: `backend/`, `frontend/`, `docs/`, `scripts/`.
- Runtime persistence files:
  - `backend/storage/model_config.json`
  - `backend/storage/config.toml`
  - `backend/storage/prompts/templates/*.json`
  - `backend/storage/prompts/selection.json`
- Task persistence directories:
  - `backend/storage/tasks/records/`
  - `backend/storage/tasks/analysis-results/<task_id>/<stage>.json`
  - `backend/storage/tasks/stage-artifacts/<task_id>/<stage>/`
  - `backend/storage/tasks/runtime-warnings/<task_id>.jsonl`
  - `backend/storage/event-logs/<task_id>.jsonl`
