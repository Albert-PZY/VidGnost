## Why

VidGnost defines a practical video-analysis workbench for local execution plus online generation. The target is predictable operation on common developer machines, clear runtime observability, and reproducible deliverables that can be replayed and exported.

## What Changes

- Build a decoupled architecture with `Fastify + React`.
- Support three ingestion paths: Bilibili URL, local path, and file upload.
- Implement asynchronous `A/B/C/D` runtime phases with explicit phase boundaries.
- Use local `whisper.cpp`-compatible transcription through an isolated worker process, with persisted runtime preferences controlling CPU/GPU execution.
- Auto-prepare Whisper `small` model files at task start when cache is missing, with realtime progress events.
- Run stage-`D` as ordered subchain: `transcript_optimize -> fusion_delivery`.
- Generate notes and mindmap through OpenAI-compatible online API.
- Stream logs/progress/transcript/generation deltas via SSE with per-event `trace_id`.
- Persist runtime warnings, event logs, stage snapshots, and stage artifacts for replay diagnostics.
- Provide runtime config center tabs: `在线 LLM`, `Whisper`, `Prompt Templates`.
- Persist runtime config in local files: `model_config.json`, `config.toml`, and prompt template files.
- Support prompt-template CRUD + active selection for summary and mindmap channels.
- Provide task history retrieval, title update, terminal-task deletion, and artifact markdown editing.
- Provide transcript / notes / mindmap / subtitle export and one-click bundle export.
- Provide VQA search/chat/trace workflow with `flow/qa/debug` runtime modes.
- Render Mermaid fences in notes as PNG assets and reference them by relative `notes-images/*` paths.
- Provide Electron host bootstrap (`main/preload`) to run the same workbench as desktop app.

## Capabilities

### Core Capabilities
- `video-ingestion`: create tasks from URL/path/upload sources.
- `transcription-pipeline`: async phase pipeline with isolated Whisper worker transcription.
- `llm-summary-mindmap`: online generation for notes and markmap markdown.
- `sse-runtime-stream`: realtime task stream and self-check stream.
- `llm-runtime-config`: editable runtime config persisted in local storage files.
- `history-and-export`: replayable history and deterministic artifact export.
- `web-workbench-ui`: bilingual workbench with phase tabs, VQA runtime modes, and config center.

### Engineering Capabilities
- Stream/memory governance for long-running sessions.
- Stage-level metrics and artifact indexing for observability.
- Structured runtime-warning semantics for degraded-but-continuable conditions.

## Impact

- Repository modules: `apps/api/`, `apps/desktop/`, `packages/`, `docs/`, `scripts/`.
- Runtime persistence files:
  - `storage/model_config.json`
  - `storage/config.toml`
  - `storage/prompts/templates/*.json`
  - `storage/prompts/selection.json`
- Task persistence directories:
  - `storage/tasks/records/`
  - `storage/tasks/analysis-results/<task_id>/<stage>.json`
  - `storage/tasks/stage-artifacts/<task_id>/<stage>/`
  - `storage/tasks/runtime-warnings/<task_id>.jsonl`
  - `storage/event-logs/<task_id>.jsonl`
