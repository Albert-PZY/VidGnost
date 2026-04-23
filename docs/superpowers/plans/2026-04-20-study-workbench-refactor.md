# Study Workbench Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. It will decide whether each batch should run in parallel or serial subagent mode and will pass only task-local context to each subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor VidGnost into a study-first local workbench with subtitle-track resolution, optional translation, structured study packs, knowledge-note persistence, upgraded history, and transcript-only QA continuity.

**Architecture:** Keep the existing task backbone and add a study-domain projection layer on top of it. Replace the default Stage-D multimodal branch with subtitle/transcript/study generation and expose those results through new study and knowledge routes plus a study-first desktop workbench.

**Tech Stack:** TypeScript, Fastify, React 19, Zustand, Node `node:sqlite`, Vitest, OpenSpec

---

### Task 1: Add Study and Knowledge Contracts

**Files:**
- Create: `packages/contracts/src/study.ts`
- Create: `packages/contracts/src/knowledge.ts`
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/config.ts`
- Modify: `packages/contracts/src/tasks.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] Define source-type, translation-target, study-pack, subtitle-track, study-state, knowledge-note, study-preview, export-record, and workbench-response schemas.
- [ ] Extend shared task schemas to include study preview metadata and remote source types.
- [ ] Export new contracts from the package barrel.

### Task 2: Add SQLite Study Repository and Study Services

**Files:**
- Create: `apps/api/src/modules/study/sqlite-study-repository.ts`
- Create: `apps/api/src/modules/study/subtitle-track-types.ts`
- Create: `apps/api/src/modules/study/subtitle-track-service.ts`
- Create: `apps/api/src/modules/study/translation-decision-service.ts`
- Create: `apps/api/src/modules/study/study-workspace-types.ts`
- Create: `apps/api/src/modules/study/study-workspace-service.ts`
- Create: `apps/api/src/modules/study/knowledge-note-repository.ts`
- Create: `apps/api/src/modules/study/export-formatter-service.ts`
- Create: `apps/api/src/modules/study/study-service.ts`
- Modify: `apps/api/src/core/config.ts`
- Modify: `apps/api/src/modules/ui/ui-settings-repository.ts`

- [ ] Add SQLite initialization, schema creation, and CRUD helpers for study tables.
- [ ] Implement subtitle-track discovery and Whisper/local fallback metadata.
- [ ] Implement translation-decision rules and study-pack synthesis.
- [ ] Implement knowledge-note and export-record persistence.

### Task 3: Refactor Task Backbone for Study-First Stage D

**Files:**
- Modify: `apps/api/src/modules/tasks/task-orchestrator.ts`
- Modify: `apps/api/src/modules/tasks/task-repository.ts`
- Modify: `apps/api/src/modules/tasks/task-support.ts`
- Modify: `apps/api/src/modules/media/media-pipeline-service.ts`
- Modify: `apps/api/src/modules/summary/summary-service.ts`
- Modify: `apps/api/src/modules/vqa/vqa-runtime-service.ts`

- [ ] Change remote source classification to `youtube` / `bilibili`.
- [ ] Narrow Stage D to transcript optimization, subtitle/translation resolution, study-pack generation, and transcript-only QA prewarm.
- [ ] Persist study preview metadata into task summaries and task detail reads.
- [ ] Preserve compatibility exports and existing task SSE behavior.

### Task 4: Add Study and Knowledge Routes

**Files:**
- Create: `apps/api/src/routes/study.ts`
- Modify: `apps/api/src/server/build-app.ts`
- Modify: `apps/api/src/routes/task-exports.ts`
- Modify: `apps/api/src/routes/task-mutations.ts`

- [ ] Add read routes for study workbench payloads, preview, subtitle tracks, and exports.
- [ ] Add mutation routes for study state and knowledge notes.
- [ ] Register the new route tree in the app builder.

### Task 5: Add Backend Tests for Study Domain

**Files:**
- Create: `apps/api/test/study-routes.test.ts`
- Create: `apps/api/test/study-service.test.ts`
- Modify: `apps/api/test/task-orchestrator-control.test.ts`
- Modify: `apps/api/test/tasks-read.test.ts`

- [ ] Add route-level fixture tests for study workbench payloads and knowledge notes.
- [ ] Add service tests for study-pack synthesis and translation decisions.
- [ ] Add orchestrator regression coverage for transcript-only Stage D behavior.

### Task 6: Refactor Desktop Workbench Into Study-First Modes

**Files:**
- Create: `apps/desktop/src/components/views/knowledge-view.tsx`
- Modify: `apps/desktop/src/components/views/task-processing-workbench.tsx`
- Modify: `apps/desktop/src/components/views/history-view.tsx`
- Modify: `apps/desktop/src/components/app-sidebar.tsx`
- Modify: `apps/desktop/src/app/page.tsx`
- Modify: `apps/desktop/src/app/workbench-view-loader.ts`
- Modify: `apps/desktop/src/lib/api.ts`
- Modify: `apps/desktop/src/lib/types.ts`

- [ ] Add study and knowledge client APIs.
- [ ] Recompose the task workbench into `Study / QA / Flow / Trace / Knowledge`.
- [ ] Add shell-level `Knowledge` navigation and upgrade history into a learning library.

### Task 7: Sync OpenSpec and Project Docs

**Files:**
- Modify: `README.zh-CN.md`
- Modify: `docs/openspec/specs/video-ingestion/spec.md`
- Modify: `docs/openspec/specs/transcription-pipeline/spec.md`
- Modify: `docs/openspec/specs/history-and-export/spec.md`
- Modify: `docs/openspec/specs/web-workbench-ui/spec.md`
- Modify: `docs/openspec/changes/build-lightweight-v2/specs/video-ingestion/spec.md`
- Modify: `docs/openspec/changes/build-lightweight-v2/specs/transcription-pipeline/spec.md`
- Modify: `docs/openspec/changes/build-lightweight-v2/specs/history-and-export/spec.md`
- Modify: `docs/openspec/changes/build-lightweight-v2/specs/web-workbench-ui/spec.md`

- [ ] Update baseline and active change specs to match the study-first implementation.
- [ ] Refresh high-level README wording to describe the new product baseline.

### Task 8: Verify, Commit, and Push

**Files:**
- Modify: `git history on branch`

- [ ] Run `pnpm typecheck`
- [ ] Run `pnpm test`
- [ ] Run `node scripts/check-openspec.mjs`
- [ ] Run `powershell -ExecutionPolicy Bypass -File .\\scripts\\check-openspec.ps1`
- [ ] Commit with conventional commits on `refactor260420`
- [ ] Push `refactor260420` to `origin`
