## 1. Spec & Bootstrap

- [x] 1.1 Initialize backend project skeleton (`uv`, FastAPI, route modules, storage scaffolding)
- [x] 1.2 Initialize frontend project skeleton (`pnpm`, React, TypeScript, Tailwind)
- [x] 1.3 Establish repository docs and startup conventions

## 2. Backend Pipeline

- [x] 2.1 Implement task model and local persistence format
- [x] 2.2 Implement task creation APIs for URL/path/upload
- [x] 2.3 Implement async `A/B/C/D` executor with terminal statuses
- [x] 2.4 Implement audio conversion, chunk planning, and transcription streaming
- [x] 2.5 Implement stage-D subchain `transcript_optimize -> fusion_delivery`
- [x] 2.6 Implement transcript correction modes: `off`, `strict`, `rewrite`
- [x] 2.7 Integrate online LLM notes/mindmap generation
- [x] 2.8 Implement stage-D prompt module with template-based prompt assembly
- [x] 2.9 Persist per-stage snapshots and stage artifact indexes
- [x] 2.10 Implement runtime warnings and resource guard checks
- [x] 2.11 Implement running-task cancellation with cleanup and terminal events
- [x] 2.12 Implement Whisper `small` model readiness check and auto-download pipeline
- [x] 2.13 Add realtime model-download progress reporting into runtime stream

## 3. Backend Runtime / History / Export

- [x] 3.1 Implement history list/search/detail APIs
- [x] 3.2 Implement terminal-task title update and deletion APIs
- [x] 3.3 Implement artifact markdown update API for terminal tasks
- [x] 3.4 Implement per-task SSE stream (phase, log, progress, delta, warning)
- [x] 3.5 Implement self-check start/report/autofix APIs and SSE session stream
- [x] 3.6 Implement bounded stream/session caches for long-lived processes
- [x] 3.7 Implement structured backend error envelope (`code/message/detail`)
- [x] 3.8 Implement transcript/notes/mindmap export endpoints
- [x] 3.9 Implement subtitle export endpoints (`srt`, `vtt`) with timeline normalization
- [x] 3.10 Implement one-click bundle export with deterministic artifact set
- [x] 3.11 Persist task event traces (`event-logs/*.jsonl`) and runtime warnings (`runtime-warnings/*.jsonl`)

## 4. Frontend Workbench

- [x] 4.1 Implement responsive shell with bilingual theme-aware UI
- [x] 4.2 Implement source submission modal for URL/path/upload
- [x] 4.3 Implement runtime phase tabs (`A/B/C/transcript_optimize/D`) with auto-focus
- [x] 4.4 Implement transcript stream panel and stage-D notes/mindmap dual pane
- [x] 4.5 Implement history modal with search, reopen, title edit, delete actions
- [x] 4.6 Implement settings center with tabs: `在线 LLM`, `Faster-Whisper`, `Prompt Templates`
- [x] 4.7 Implement prompt-template CRUD and active selection workflows
- [x] 4.8 Implement runtime warning toast/log presentation from SSE events
- [x] 4.9 Implement post-completion bundle download action
- [x] 4.10 Implement VQA runtime workbench modes (`flow/qa/debug`) with retrieval debug panels and trace replay
- [x] 4.11 Implement runtime UI performance optimizations (batched stream flush + lazy mindmap runtime)
- [x] 4.12 Implement modal interaction polish (scroll lock, motion preferences, consistent toast placement)

## 5. Docs / Ops

- [x] 5.1 Publish synchronized bilingual README docs with web/desktop runtime contract details
- [x] 5.2 Publish OpenSpec capabilities for ingestion, pipeline, SSE, config, generation, history, UI
- [x] 5.3 Publish startup scripts for Linux/macOS/WSL and Windows PowerShell
- [x] 5.4 Publish OpenSpec checker scripts and validation workflow
- [x] 5.5 Synchronize storage layout documentation with actual runtime directories
- [x] 5.6 Keep active-change specs and baseline specs aligned for stable capability contracts
