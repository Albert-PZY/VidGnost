## Context

VidGnost is designed as an end-to-end video-analysis workbench with two stable runtime pillars:

- Local ASR execution (`faster-whisper-small` on CPU)
- Online LLM generation for structured detailed notes, concise summary, and mindmap

The architecture emphasizes deterministic phase contracts, observable runtime behavior, and replayable storage artifacts.

## Goals / Non-Goals

**Goals**
- Keep clear ownership boundaries between frontend, backend, and storage contracts.
- Support URL/path/upload ingestion with consistent task lifecycle behavior.
- Provide low-friction local transcription with automatic model preparation.
- Provide online generation with configurable prompts and runtime parameters.
- Persist complete replay diagnostics: logs, warnings, events, metrics, artifacts.
- Keep long-lived sessions stable under continuous SSE streams.

**Non-Goals**
- Distributed queue orchestration in current phase.
- Multi-tenant account/permission design in current phase.
- Playlist/batch crawl orchestration in current phase.

## Decisions

### 1. Backend architecture: FastAPI + asyncio task orchestration
- Async-native implementation keeps I/O pipelines responsive and simple.
- Runtime flow is modeled with explicit phase transitions and substage telemetry.

### 2. Frontend architecture: React + Vite workbench shell
- Bilingual UI (`zh-CN` / `en`) with persisted locale.
- Runtime monitoring is SSE-driven with phase-focused tabs.

### 3. Data and persistence model: local file source of truth
- Task metadata and artifacts are stored as local files.
- Stage snapshots are stored as per-stage files: `analysis-results/<task_id>/<stage>.json`.
- Stage artifacts are stored under `stage-artifacts/<task_id>/<stage>/`.
- Runtime warnings and event traces are stored as JSONL streams.

### 4. Runtime config model
- `Online LLM` settings are persisted in `storage/model_config.json`.
- `Faster-Whisper` settings are persisted in `storage/config.toml`.
- Prompt template records are persisted in `storage/prompts/templates/*.json` with selection in `selection.json`.

### 5. Pipeline contract
- Four runtime phases: `A`, `B`, `C`, `D`.
- Stage `D` subchain: `transcript_optimize -> notes_extract -> notes_outline -> notes_sections -> notes_coverage -> summary_delivery -> mindmap_delivery`.
- Stage-level metrics include substage observability for phase `D`.

### 6. ASR runtime strategy
- Model size is fixed to `small`.
- Effective device is CPU-only (`device=cpu`).
- Supported compute types are `int8` and `float32`.
- Task start performs model readiness check and downloads missing model files with progress reporting.

### 7. Generation runtime strategy
- Detailed notes, concise summary, and mindmap generation use OpenAI-compatible online API.
- Transcript-correction mode is configurable (`off|strict|rewrite`) and applied before final delivery.
- Prompt templates are channel-specific (`summary` / `notes` / `mindmap`) and selectable at runtime.

### 8. Streaming and observability strategy
- SSE stream carries stage events, logs, progress, transcript/generation deltas, warnings.
- Every event includes `trace_id` for cross-event correlation.
- Event persistence is non-blocking to protect online stream continuity.

### 9. Export and history strategy
- History APIs provide list/search/detail replay.
- Terminal tasks support title edit, artifact markdown update, and deletion.
- Export APIs provide transcript/notes/mindmap/subtitle files and bundle archives.

### 10. UI interaction strategy
- Action-first sidebar and modal workflows keep runtime area focused.
- Quick-start documentation is built into the same shell with locale/theme consistency.

## Risks / Trade-offs

- Online generation depends on third-party API availability and quota.
- Local disk consumption grows with long tasks and retained artifacts.
- Long transcript sessions require careful queue and rendering governance.
- Subtitle quality depends on transcript segment timeline quality.

## Delivery Plan

1. Finalize OpenSpec docs and requirement contracts.
2. Implement backend APIs and phase pipeline services.
3. Implement frontend workbench and SSE integration.
4. Integrate runtime config center and prompt-template workflows.
5. Verify end-to-end task creation, replay, and export behavior.

## Open Questions

- Should future phases support batch task orchestration?
- Should future phases add more UI locales?
- Should future phases add resumable per-stage controls?
