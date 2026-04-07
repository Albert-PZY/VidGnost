## Context

VidSense targets a lightweight yet production-practical video insight workflow that runs reliably on mid-range hardware (for example, 16GB RAM). Compared with the original project, this version must support offline local video processing while keeping module boundaries clear and maintainable.

The repository started with requirement notes only, so a spec-first implementation strategy is appropriate.

## Goals / Non-Goals

**Goals**
- Build a maintainable frontend/backend architecture with clear ownership boundaries.
- Support Bilibili URLs, local file paths, and local uploads.
- Provide faster-whisper transcription with configurable runtime knobs.
- Generate summary + mindmap via OpenAI-compatible endpoint.
- Persist full task replay data (logs + outputs) for historical session review.
- Keep UI performant and aligned with `VidSense/AGENTS.md`.
- Keep long-running stream sessions memory-stable on both frontend and backend.

**Non-Goals**
- No distributed queue system (Celery/RabbitMQ) in this phase.
- No multi-tenant permissions or advanced RBAC in this phase.
- No batch playlist crawling/orchestration in this phase.

## Decisions

### 1. Backend architecture: FastAPI + asyncio + local worker orchestration
- Chosen for low overhead, fast iteration, and async-native I/O.
- Rejected alternative: external queue workers, due deployment complexity for lightweight goals.

### 2. Data layer: local files for source of truth
- Local JSON/text files store task metadata, transcript/summary/mindmap artifacts, and replayable stage logs.
- Analysis snapshots are persisted as per-stage files under `tasks/analysis-results/<task_id>/<stage>.json`.
- Stage outputs are persisted under `tasks/stage-artifacts/<task_id>/<stage>/` with independent files per stage/substage.
- Long transcript-oriented outputs are chunked into multiple files (`C/transcript/chunk-*.json`, `D/transcript-optimize/chunk-*.json`) instead of single large blobs.
- Runtime-generated IDs use normalized time keys (`prefix-YYYYMMDD-HHMMSS[-NN]`) to keep directories human-readable.
- No Redis dependency in this phase.

### 3. Runtime config persistence: local files, no `.env`
- Project-level `.env/.env.example` files are removed from runtime config workflow.
- Faster-Whisper runtime parameters are persisted in `storage/config.toml`.
- Online LLM runtime parameters are persisted in `storage/model_config.json`.
- Summary/mindmap prompt templates are stored as one file per template (`storage/prompts/templates/*.json`), with active selection in `storage/prompts/selection.json`.
- Frontend updates both config sets through dedicated config APIs.

### 4. Pipeline decomposition
- Four-stage contract (`A/B/C/D`) with substage chaining:
  - `A`: preflight + source ingestion (resource checks, input normalization, media ready)
  - `B`: audio preprocessing (WAV conversion + chunking)
  - `C`: ASR streaming (faster-whisper)
  - `D`: transcript correction -> notes/mindmap generation -> delivery persistence
- Runtime scheduling is lock-based for heavyweight model stacks (`asr` / `llm`) to keep local execution memory-safe.
- Each module remains replaceable in principle, while preserving current `A/B/C/D` frontend contract.

### 5. Frontend stack
- React + Vite + TypeScript + Tailwind + Radix + Lucide.
- SSE-driven runtime stream UI with stage tabs.
- Virtualized transcript rendering for long text performance.
- Markmap rendering in browser to avoid backend rendering overhead.

### 6. Bilingual UI with persisted locale
- UI uses `i18next + react-i18next`.
- Locale is persisted in browser `localStorage`.
- ASR language and UI locale are explicitly decoupled.
- Header locale control uses an icon-triggered dropdown (hover/click open, active locale highlight).

### 7. Action-first sidebar and modal workflow
- Sidebar only keeps compact actions (`Upload`, `History`, `Runtime Config`) to preserve visual cleanliness.
- Source input form, history search/list, and config editors are moved into modal panels.
- This layout keeps the primary runtime area stable and avoids dense inline side forms.

### 8. Runtime readability and performance hardening
- Frontend stream updates are batched (small flush interval) to reduce re-render frequency.
- Mindmap rendering is lazy-loaded and uses `markmap-lib/no-plugins` to keep bundle size under warning thresholds.
- Backend transcription segment events are routed via bounded async queue consumer instead of spawning unbounded short tasks.
- EventBus prunes terminal task histories after subscribers disconnect to avoid long-term in-memory accumulation.
- Temporary media working directories are removed after task completion/failure.
- Backend startup performs a one-time temp workspace sweep to remove stale artifacts left by force-killed processes.
- Pipeline stage boundaries are balanced as `A: ingestion`, `B: audio preprocessing (conversion + chunking)`, `C: transcription`, `D: notes+mindmap`.
- Task cancellation uses in-memory job cancellation first and emits dedicated terminal event (`task_cancelled`) for frontend state convergence.
- Whisper downloader uses built-in endpoint fallback strategy to improve model download success in restricted networks.
- Config center adds one-click Whisper model preload to warm local cache before first analysis task.
- Stage-D summary/mindmap instructions are resolved from local-file template records selected by frontend.
- Runtime log/transcript/summary/mindmap text panes use light-toned surfaces in both themes for long-session readability.
- Runtime logs include elapsed timing and optional substage tags, enabling UI-side `Working + elapsed` indicators and clearer traceability.
- Runtime warning events are machine-readable (`code/component/action`) and surfaced in realtime for user-visible degradation notices.
- Runtime config center is API-first: generation uses online LLM config and ASR uses persisted Faster-Whisper runtime fields.
- Local model deployment/readiness controls are removed to reduce setup complexity and avoid invalid local-mode selections.
- Stage-D generation follows quality-first semantics: if both local/API LLM runtimes fail, task fails with `LLM_ALL_UNAVAILABLE` (no handcrafted fallback notes).

## Risks / Trade-offs

- **GPU dependency strictness**: no CPU inference fallback for ASR runtime; environments without valid CUDA stack fail fast.
- **Bilibili source instability**: mitigated with clear validation errors and retryable flow.
- **Large upload disk footprint**: mitigated via local storage boundaries and file-size limits.
- **Long transcript rendering cost**: mitigated by virtualized rendering.
- **Frequent log persistence writes**: mitigated via in-memory stage log buffering + milestone persistence.
- **Large frontend dependency chunks**: mitigated by lazy loading + manual chunk splitting.

## Migration Plan

1. Finalize OpenSpec docs and validation metadata.
2. Implement backend APIs, pipeline services, and persistence.
3. Implement frontend workbench and stream integration.
4. Add runtime config panel integration (`model_config.json` + `config.toml`).
5. Validate end-to-end workflows and update runbook docs/scripts.

## Open Questions

- Should we add queue-based batch task submission in next phase?
- Should we add more locales (for example, Japanese / Traditional Chinese)?
- Should we support live per-stage cancellation and resume controls?
