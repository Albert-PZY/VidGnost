## Why

VidInsight is feature-rich, but runtime/deployment coupling and weak separation of concerns make it harder to run reliably on lower-spec devices. We need a lightweight, async, and extensible reimplementation with clearer architecture and lower operational overhead.

## What Changes

- Migrate from monolithic Streamlit flow to a decoupled architecture: `FastAPI + React`.
- Support dual ingestion modes: Bilibili URL and local video input.
- Build an async multi-stage pipeline: ingestion/audio conversion, chunking, transcription, summary + mindmap generation.
- Use `faster-whisper` local inference fixed to `small` in GPU-only runtime mode (no CPU fallback).
- Integrate OpenAI-compatible API (DashScope) for summary and mindmap generation.
- Persist task history and artifacts in local files for unified history/detail replay.
- Provide SSE streaming for logs, transcript deltas, summary deltas, and mindmap deltas.
- Expose editable online LLM runtime config and persist to local `model_config.json`.
- Expose editable Faster-Whisper runtime config in frontend and persist to local `config.toml`.
- Remove `.env/.env.example` usage; rely on local runtime config files plus explicit defaults.
- Persist stage logs and generated outputs locally, so completed sessions can be reopened like chat history.
- Deliver frontend workbench aligned with `VidSense/AGENTS.md` style constraints.
- Add environment self-check panel with SSE progress timeline and one-click OS-specific auto-fix scripts.
- Add cross-OS `.venv` compatibility preflight to auto-rebuild conflicted backend virtualenvs before dependency sync.
- Add top-level quick-start entry and in-app markdown documentation page for manual setup guidance.
- Flatten top navigation style and add collapsible sidebar so runtime area can be maximized when needed.
- Redesign quick-start page into a two-pane documentation layout (collapsible outline + markdown body with active anchor tracking).
- Add quick-start markdown/code copy actions and theme-aware syntax highlighting for code blocks.
- Improve light/dark theme switching with smoother transition and reduced-motion fallback.
- Polish quick-start/document shell details: compact TOC collapse icon, matched card surfaces, reading metrics, and dark-mode header divider refinement.
- Add history management operations: edit task title and delete terminal tasks from modal list using icon actions.
- Replace browser-native delete confirm with themed in-app modal and unified toast feedback.
- Place toast notifications at top-center for consistent global feedback visibility.
- Upgrade stage-D summary generation to detailed structured notes with stronger note-taking prompts.
- Decouple LLM prompts from summarizer runtime logic into a dedicated prompt module.
- Keep transcript stream panel auto-scrolled to latest output during realtime updates.
- Rebalance stage-D layout: equal-height notes/mindmap-markdown panels with visual mindmap rendered as a full-width row below.
- Improve dark-theme mindmap readability by tuning markmap text and connector contrast.
- Add stage-tab sliding active indicator animation and a header GitHub repository icon link.
- Split frontend vendor bundles and lazy-load mindmap runtime to reduce initial bundle weight.
- Harden stream processing against memory growth by bounded queues, terminal event cleanup, and stage-log buffering.
- Clean temporary media directories after task completion to keep runtime footprint stable.
- Add one-time startup temp sweep to self-heal stale artifacts after ungraceful process termination.
- Add user-triggered task cancellation with dedicated terminal status/event and immediate temp workspace cleanup.
- Rebalance stage decomposition so `A` and `B` workloads are more even (`A` ingestion, `B` conversion+chunking).
- Add built-in Whisper model endpoint fallback strategy in backend downloader to improve cache download reliability.
- Add one-click Whisper model preload action in config panel to warm `small` cache before first run.
- Add prompt-template configuration for stage-D notes/mindmap generation with full CRUD + active selection switching.
- Add dedicated runtime `Local Models` deployment workflow (status + async prepare sessions + per-item progress) to avoid hidden downloads during analysis.
- Keep stage-D generation strict on quality: if both local/API LLM runtimes are unavailable, fail with explicit `LLM_ALL_UNAVAILABLE` instead of generating handcrafted fallback notes.
- Persist stage observability and artifact metadata (`stage_metrics`, `artifact_index`, `artifact_total_bytes`) for replay diagnostics and export governance.
- Upgrade in-app quick-start markdown renderer to support Mermaid diagram auto-rendering with source fallback on render failure.

## Capabilities

### New Capabilities
- `video-ingestion`: unified Bilibili/local ingestion into trackable tasks.
- `transcription-pipeline`: async faster-whisper transcription with chunk-level progress.
- `llm-summary-mindmap`: OpenAI-compatible summary + mindmap generation.
- `sse-runtime-stream`: real-time SSE runtime stream per task.
- `history-and-export`: searchable history, replayable details, and TXT/MD/HTML export.
- `web-workbench-ui`: performant workbench with stage tabs and bilingual UI.
- `llm-runtime-config`: frontend-editable LLM config persisted locally.
- `whisper-runtime-config`: frontend-editable Faster-Whisper runtime config persisted to TOML.
- `performance-hardening`: bundle split, bounded stream queues, and deterministic cleanup paths.

### Modified Capabilities
- `history-and-export`: now includes persisted stage logs (`A/B/C/D`) for cross-restart replay.
- `sse-runtime-stream`: runtime log messages are normalized to English.
- `web-workbench-ui`: stream rendering is batched to reduce re-render overhead under long transcripts.
- `web-workbench-ui`: sidebar layout is action-first with modal workflows for source/history/config operations.
- `web-workbench-ui`: runtime stage panels use light-toned readable surfaces in both light and dark themes.
- `llm-runtime-config`: Faster-Whisper config UX adds parameter guidance plus three preset templates with custom override.
- `web-workbench-ui`: add self-check modal with sequential vertical progress and issue handling (auto-fix + manual actions).
- `web-workbench-ui`: add quick-start markdown documentation view toggled from header.
- `web-workbench-ui`: flatten header chrome and add sidebar collapse/expand to increase runtime viewport.
- `web-workbench-ui`: quick-start page now uses two-pane docs layout with collapsible outline and active-anchor highlight tracking.
- `web-workbench-ui`: quick-start markdown adds copy actions and theme-aware code syntax highlighting.
- `web-workbench-ui`: theme switching transition is smoothed and respects reduced-motion preference.
- `web-workbench-ui`: header/quick-start outline sticky behavior is hardened and docs-surface theme transitions are smoothed during scroll + theme toggle.
- `web-workbench-ui`: quick-start shell now includes compact outline collapse affordance, content reading stats, and improved fallback highlighting on unlabeled code blocks.
- `history-and-export`: add title update/delete operations with terminal-state deletion guard.
- `web-workbench-ui`: history delete flow now uses custom confirmation modal and themed toast notifications.
- `web-workbench-ui`: toast notifications are displayed at top-center for consistent visibility.
- `llm-summary-mindmap`: summary channel now targets detailed structured notes instead of concise abstracts.
- `llm-summary-mindmap`: prompt templates are separated from execution logic and persisted in local files for dynamic management.
- `web-workbench-ui`: transcript stream auto-scrolls to latest output during realtime append.
- `web-workbench-ui`: stage D uses equal-height stream panels and full-row visual mindmap rendering.
- `web-workbench-ui`: dark-theme mindmap visual readability is improved via theme-aware style tuning.
- `web-workbench-ui`: runtime stage tabs use sliding active indicator and header exposes GitHub external-link icon.
- `performance-hardening`: bootstrap and auto-fix scripts now auto-heal cross-OS backend `.venv` conflicts.

## Impact

- Project layout: `VidSense/backend`, `VidSense/frontend`, `VidSense/docs`.
- Added runtime config persistence files:
  - `backend/storage/config.toml` (Whisper runtime config)
  - `backend/storage/model_config.json` (online LLM runtime config)
- Added file-persisted prompt template dataset (summary/mindmap template records + selected template ids).
- Removed `.env/.env.example` driven configuration workflow.
- Development workflow remains spec-driven with OpenSpec tracking.
