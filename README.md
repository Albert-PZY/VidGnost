<div align="center">
  <img src="./apps/desktop/public/icon.png" alt="VidGnost Logo" width="120" />
  <h1>VidGnost</h1>
  <p><strong>Local-first study workbench for Electron desktop</strong></p>
  <p>Unify online and local video study, transcript-first QA, subtitle-track metadata, Knowledge capture, and reproducible study artifacts.</p>
</div>

<div align="center">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

## Overview

VidGnost is a local-first Electron study workbench for video-backed learning. The repository now follows a standard TS fullstack monorepo layout:

- `apps/desktop` provides the React renderer and Electron shell
- `apps/api` provides the Fastify API, task orchestration, config center, event streaming, diagnostics, and exports
- `packages/contracts` provides shared schemas across frontend and backend
- runtime data is persisted under the repository-root `storage/`
- the TS backend remains the main service path while local ASR runs through the isolated `apps/api/python` `faster-whisper` worker

The current study-first baseline is centered on:

- online and local video inputs entering the same workbench
- transcript-first study artifacts instead of a multimodal-first prerequisite
- subtitle-track metadata and translation records as study-domain resources
- transcript-only QA with citations, Flow observability, Trace inspection, and Knowledge capture
- task-scoped study persistence in both task artifacts and `storage/study/study.sqlite`

Current implementation boundaries:

- the local Whisper route requires an existing `faster-whisper` Python runtime and local `CTranslate2` model directory; the TS runtime does not ship managed model download or dependency installation
- Ollama is currently managed as configuration plus reachability probing, not as a self-managed pull / restart / file-migration runtime
- online subtitle-track discovery and translation decisions are already modeled in the study domain, but they do not yet replace phase `C` transcript generation as the default implemented path
- VQA now uses a single transcript-only `vector-index` retrieval path with vector recall plus rerank for final evidence selection; legacy image-evidence fields remain compatibility-only

## Capability Status

| Status | Capability |
| --- | --- |
| `implemented` | task creation from YouTube / Bilibili URLs, local uploads, and absolute local paths, normalized to `youtube` / `bilibili` / `local_file` / `local_path` |
| `implemented` | local `faster-whisper` worker and compatible ASR API transcription |
| `implemented` | study-domain persistence in `storage/study/study.sqlite` plus task-local `D/study/*` artifacts |
| `implemented` | Study APIs, Knowledge note APIs, study export records, and transcript-only QA prewarm for `vqa` |
| `implemented` | SSE task events, diagnostics, trace persistence, and task export compatibility routes |
| `partial` | Study-first workbench flow with `Study / QA / Flow / Trace / Knowledge` surfaces converging on the same task boundary |
| `partial` | task list and task detail responses carrying `study_preview` metadata for history and continue-learning surfaces |
| `partial` | subtitle-track probing, translation gating, and study-pack generation on a transcript-first baseline |
| `planned` | platform subtitle tracks replacing default transcript generation for online inputs |
| `planned` | full learning-library redesign and richer Study Pack / Knowledge presentation across the desktop shell |

## Main Path

### 1. Input routes

- online video tasks keep the source on the online path and attach platform subtitle-track metadata when available
- local video tasks keep the source asset for preview and enter the audio extraction plus Whisper-compatible path

### 2. Subtitle and translation priority

- online tasks prefer platform source subtitle tracks when they can be discovered
- if a matching platform translation track exists, it takes priority over generated translation
- if no preferred target language is configured, translation remains disabled instead of blocking the study workflow
- local tasks stay Whisper-first, with translation as an optional layer

### 3. Study artifacts and long-term assets

The study-first baseline focuses on:

- transcript
- overview
- highlights
- themes
- suggested questions
- study pack
- Knowledge notes and learning-library metadata
- transcript-only QA citations

### 4. Explicitly de-emphasized paths

These are no longer the default product narrative:

- VLM-first analysis
- frame extraction as a primary prerequisite
- image-semantic retrieval as the default QA path
- visual evidence as the default citation surface

Legacy tasks may still expose older multimodal artifacts, but the current baseline does not treat them as the primary path.

## Core Capabilities

### 1. End-to-end processing pipeline

Task execution stays organized as `A -> B -> C -> D`:

1. `A`: source validation, source classification, and media preparation
2. `B`: audio extraction and preprocessing
3. `C`: transcript generation and normalization
4. `D`: transcript optimization, subtitle / translation materialization, study-pack generation, notes / mindmap delivery, and transcript-only QA prewarm for `vqa`

### 2. Workbench surfaces

- `Study`: default learning entry for subtitle tracks, overview, highlights, themes, questions, and study state
- `QA`: retrieval-backed transcript-only QA with citations
- `Flow`: task progress, stage logs, and stage-level runtime state
- `Trace`: retrieval and runtime inspection
- `Knowledge`: task-attributed excerpts and long-term notes

### 3. Study-domain boundary

- `study-domain` is a task-scoped projection and persistence domain, not a new workflow
- task ownership still lives under the existing `notes` and `vqa` workflows
- structured study state is persisted in SQLite while portable artifacts stay under `storage/tasks/stage-artifacts/<task_id>/D/study/`

### 4. Model and runtime strategy

| Component | Default path | Notes |
| --- | --- | --- |
| Whisper | local `faster-whisper` Python worker / compatible ASR API | local route requires a manually prepared Python runtime and `CTranslate2` model directory |
| LLM | Ollama or remote OpenAI-compatible API | used for transcript shaping, study artifacts, optional translation, and chat |
| Embedding | Ollama or remote API | used for transcript-only retrieval vectorization |
| Rerank | Ollama or remote API | used for ranking fused retrieval results |

## Repository Layout

```text
VidGnost/
├─ apps/
│  ├─ api/                       # Fastify + TypeScript backend
│  │  ├─ python/                 # isolated faster-whisper Python worker
│  │  ├─ src/                    # backend source
│  │  └─ test/                   # backend tests
│  └─ desktop/                   # Electron desktop app
│     ├─ electron/               # main/preload/splash host files
│     ├─ public/                 # static assets
│     └─ src/                    # renderer source
│        ├─ app/                 # app composition and globals
│        ├─ components/          # UI and feature components
│        ├─ hooks/               # renderer hooks
│        ├─ lib/                 # client-side services and helpers
│        ├─ stores/              # Zustand runtime stores
│        └─ workers/             # renderer workers
├─ packages/
│  ├─ contracts/                 # shared schemas
│  └─ shared/                    # shared constants
├─ docs/
├─ scripts/
├─ storage/                      # runtime data directory (generated locally)
├─ start-all.ps1
├─ start-all.sh
├─ README.md
└─ README.zh-CN.md
```

## Prerequisites

- Node.js `18+`
- Corepack enabled
- `pnpm`
- if the local Whisper route is enabled:
  - Python `3.10` - `3.13`
  - `uv` for the isolated `apps/api/python` dependency environment
- available executables in `PATH`:
  - `ffmpeg`
  - `ffprobe`
  - `yt-dlp`
- at least one model access path:
  - local Ollama
  - or remote OpenAI-compatible API credentials

## Quick Start

### Option 1: one-command bootstrap

Windows PowerShell:

```powershell
cd F:\in-house project\VidGnost
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

Linux / macOS / WSL:

```bash
cd /path/to/VidGnost
./start-all.sh
```

### Option 2: manual development startup

Install dependencies:

```bash
pnpm install
```

Start the backend:

```bash
pnpm --filter @vidgnost/api dev
```

Start the frontend in web debug mode:

```bash
pnpm --filter @vidgnost/desktop dev --host 127.0.0.1 --port 6221
```

Start Electron desktop development mode:

```bash
pnpm --filter @vidgnost/desktop desktop:dev
```

Default local endpoints:

- backend API: `http://127.0.0.1:8666/api`
- frontend Vite dev server: `http://127.0.0.1:6221`

## Common Validation Commands

```bash
pnpm typecheck
pnpm test
pnpm build
node scripts/check-openspec.mjs
```

## Related Documents

- [Chinese README](./README.zh-CN.md)
- [OpenSpec index](./docs/openspec/README.md)
- [Current tech stack](./docs/current-tech-stack.zh-CN.md)
- [TS fullstack refactor checklist](./docs/vidgnost-ts-fullstack-refactor-checklist.zh-CN.md)
- [Frontend-driven backend checklist](./docs/frontend-driven-backend-execution-checklist.zh-CN.md)
- [Git commit convention](./docs/git-commit-convention.md)

## License

This repository is released under the [MIT License](./LICENSE).
