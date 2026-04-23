# Bilibili Auth Subtitle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. It will decide whether each batch should run in parallel or serial subagent mode and will pass only task-local context to each subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Bilibili QR login, persist backend-only cookie sessions, and use logged-in Bilibili AI subtitles as the Bilibili subtitle source before Whisper/remote ASR.

**Architecture:** Add a dedicated backend `bilibili-auth` module group plus `/config/bilibili-auth*` routes, keep auth state separate from UI settings, and route Bilibili phase `C` subtitle acquisition through Bilibili-auth first. Expose the status and QR flow through the existing settings center without leaking raw cookies to the renderer.

**Tech Stack:** TypeScript, Fastify, React 19, Node fetch, Vitest, Zod

---

### Task 1: Add Contracts and Status Types

**Files:**
- Modify: `packages/contracts/src/config.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/desktop/src/lib/types.ts`

- [x] Add Bilibili auth response schemas, QR start/poll response schemas, and session status enums.
- [x] Export the new config contracts from the package barrel.
- [x] Re-export the new types for desktop usage.

### Task 2: Add Backend Persistence and Login Services

**Files:**
- Create: `apps/api/src/modules/bilibili-auth/bilibili-auth-repository.ts`
- Create: `apps/api/src/modules/bilibili-auth/bilibili-login-service.ts`
- Create: `apps/api/src/modules/bilibili-auth/bilibili-subtitle-client.ts`
- Create: `apps/api/src/modules/bilibili-auth/bilibili-source.ts`

- [x] Add task-independent auth persistence under `storage/config/bilibili-auth.json`.
- [x] Add QR generation, QR polling, cookie extraction, session validation, and logout behavior.
- [x] Add `bvid -> aid/cid -> player -> subtitle_url` subtitle resolution helpers.

### Task 3: Add Backend Routes and App Wiring

**Files:**
- Modify: `apps/api/src/server/build-app.ts`
- Modify: `apps/api/src/routes/config.ts`

- [x] Add `/config/bilibili-auth` status, QR start, QR poll, and logout routes through the config surface.
- [x] Wire the new repository and services into the app builder.
- [x] Keep the existing config surface behavior unchanged for unrelated settings.

### Task 4: Extend Subtitle Fallback Logic

**Files:**
- Modify: `apps/api/src/modules/asr/platform-subtitle-transcript-service.ts`

- [x] Add logged-in Bilibili AI subtitle acquisition before ASR without public `yt-dlp` subtitle probing.
- [x] Persist raw subtitle and selected-track artifacts using the existing task artifact contract.
- [x] Mark expired auth sessions and continue to Whisper/remote ASR fallback without failing phase `C`.

### Task 5: Add Backend Tests

**Files:**
- Modify: `apps/api/test/config.test.ts`
- Create: `apps/api/test/bilibili-auth-repository.test.ts`
- Create: `apps/api/test/bilibili-login-service.test.ts`
- Create: `apps/api/test/bilibili-subtitle-client.test.ts`
- Modify: `apps/api/test/task-orchestrator-control.test.ts`

- [x] Add repository tests for create/read/update/logout persistence.
- [x] Add QR login tests for start/poll/expire behavior.
- [x] Add subtitle client tests for Bilibili view/player/subtitle resolution.
- [x] Add transcription fallback regression tests for `bilibili-auth -> Whisper` and Bilibili public-probe bypass.

### Task 6: Add Desktop API and Settings UI

**Files:**
- Modify: `apps/desktop/src/lib/api.ts`
- Modify: `apps/desktop/src/lib/api.test.ts`
- Modify: `apps/desktop/src/components/views/settings-view.tsx`

- [x] Add desktop API calls for auth status, QR start, QR poll, and logout.
- [x] Add a Bilibili login settings card with status, QR link, refresh, relogin, and logout actions.
- [x] Keep the renderer limited to auth status and QR metadata, never raw cookies or backend-local persisted session data.

### Task 7: Sync Specs and Verify

**Files:**
- Modify: `docs/openspec/specs/video-ingestion/spec.md`
- Modify: `docs/openspec/specs/transcription-pipeline/spec.md`
- Modify: `docs/openspec/specs/llm-runtime-config/spec.md`
- Modify: `docs/openspec/specs/web-workbench-ui/spec.md`
- Modify: `docs/openspec/changes/build-lightweight-v2/specs/video-ingestion/spec.md`
- Modify: `docs/openspec/changes/build-lightweight-v2/specs/transcription-pipeline/spec.md`
- Modify: `docs/openspec/changes/build-lightweight-v2/specs/llm-runtime-config/spec.md`
- Modify: `docs/openspec/changes/build-lightweight-v2/specs/web-workbench-ui/spec.md`

- [x] Update specs for `bilibili-auth -> Whisper/remote ASR` Bilibili ordering, settings-center login state, and backend-only cookie boundaries.
- [x] Run focused Vitest coverage, API typecheck, and OpenSpec/spec-sync validation.
- [x] Commit and push to `refactor260420`.
