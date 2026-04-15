<div align="center">
  <img src="./frontend/public/icon.png" alt="VidGnost Logo" width="120" />
  <h1>VidGnost</h1>
  <p><strong>Local-first video analysis workbench for Electron desktop</strong></p>
  <p>Ingest videos, transcribe, generate structured notes, search evidence, stream task state, and export reproducible artifacts.</p>
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

VidGnost is a local-first Electron workbench for video analysis. The repository now follows a TS fullstack layout:

- `frontend` provides the React renderer and Electron shell
- `backend-ts` provides the Fastify API, task orchestration, config center, event streaming, diagnostics, and exports
- `packages/contracts` provides shared schemas across frontend and backend
- runtime data is persisted under the repository-root `storage/`

Current capabilities include:

- creating tasks from Bilibili URLs, local filesystem paths, or uploads
- running local transcription through a non-Python ASR runtime
- generating notes and mindmaps through Ollama or OpenAI-compatible APIs
- searching evidence and running QA against processed task artifacts
- streaming task state, diagnostics, and chat events over SSE
- preserving tasks, artifacts, event logs, and traces for replay and export

## Core Capabilities

### 1. End-to-end processing pipeline

Task execution stays organized as `A -> B -> C -> D`:

1. `A`: source validation and media preparation
2. `B`: audio extraction and chunk planning
3. `C`: ASR transcription
4. `D`: transcript correction, notes, mindmap, and export artifact generation

### 2. Workbench modes

- `flow`: task progress, stage logs, transcript, notes, and mindmap artifacts
- `qa`: retrieval-backed QA with evidence citations
- `debug`: retrieval and trace inspection
- `diagnostics`: system self-check and issue reporting

### 3. Model and runtime strategy

| Component | Default path | Notes |
| --- | --- | --- |
| Whisper | local `whisper.cpp` CLI / compatible ASR API | legacy backend-free runtime |
| LLM | Ollama or remote OpenAI-compatible API | used for correction, notes, mindmap, and chat |
| Embedding | Ollama or remote API | used for retrieval vectorization |
| VLM | Ollama or remote API | used for image/frame understanding |
| Rerank | Ollama or remote API | used for ranking fused retrieval results |

## Repository Layout

```text
VidGnost/
├─ backend-ts/                   # Fastify + TypeScript backend
├─ frontend/                     # React renderer + Electron shell
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
pnpm --filter @vidgnost/backend-ts dev
```

Start the frontend in web debug mode:

```bash
pnpm --filter @vidgnost/frontend dev --host 127.0.0.1 --port 6221
```

Start Electron desktop development mode:

```bash
pnpm --filter @vidgnost/frontend desktop:dev
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
