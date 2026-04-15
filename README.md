<div align="center">
  <img src="./frontend/public/icon.png" alt="VidGnost Logo" width="120" />
  <h1>VidGnost</h1>
  <p><strong>Local-first multimodal video analysis workbench for Electron and web debugging</strong></p>
  <p>Ingest videos, transcribe locally, generate structured notes, search evidence, chat over results, and export reproducible artifacts.</p>
</div>

<div align="center">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

<div align="center">

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![uv](https://img.shields.io/badge/backend-uv-6C47FF)
![pnpm](https://img.shields.io/badge/frontend-pnpm-F69220?logo=pnpm&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

## Overview

VidGnost is a desktop-oriented video analysis workbench built around a Python backend and a React + Electron frontend. It is designed for a local-first workflow:

- ingest videos from Bilibili URLs, local filesystem paths, or file uploads
- run local transcription with `faster-whisper`
- generate notes and mindmaps through configurable OpenAI-compatible models
- retrieve evidence with dense, sparse, fusion, and rerank stages
- support image-aware analysis through VLM and optional multimodal retrieval
- stream runtime status, logs, warnings, and chat output in real time
- preserve tasks, traces, Markdown artifacts, and export bundles for replay

Electron is the primary product form. A standalone browser workflow is also available for frontend development and API debugging.

## Core Capabilities

### 1. End-to-end processing pipeline

VidGnost organizes task execution as a staged pipeline:

1. `A`: source validation and media preparation
2. `B`: audio conversion and chunk planning
3. `C`: transcription
4. `D`: transcript optimization and fusion delivery

The stage-D flow produces the structured outputs users work with most often:

- cleaned transcript
- Markdown notes
- Mermaid-backed mindmap content
- subtitles in `srt` and `vtt`
- replayable runtime traces

### 2. Workbench modes

- `flow`: monitor task progress, stage logs, transcript, notes, and mindmap artifacts
- `qa`: run retrieval and streaming QA with evidence citations
- `debug`: inspect dense, sparse, RRF, rerank, and trace-level details
- `diagnostics`: run system self-check, view failure summaries, and trigger autofix where supported

### 3. Model routing and runtime strategy

The project uses different model paths for different responsibilities:

| Component | Default runtime path | Notes |
| --- | --- | --- |
| Whisper | local `faster-whisper` runtime | independent from Ollama |
| LLM | Ollama or remote OpenAI-compatible API | used for generation |
| Embedding | Ollama or remote API | supports dense retrieval |
| VLM | Ollama or remote API | used for image/frame understanding |
| Rerank | Ollama or remote API | used after dense + sparse fusion |
| MLLM | optional remote API | enables multimodal retrieval/answer generation route |

Current behavior worth knowing:

- local model paths are persisted as absolute filesystem paths
- Ollama runtime location and model directory are configurable from the settings center
- remote providers are treated as OpenAI-compatible by default, with backend-side compatibility normalization where needed
- oversized images are compressed before sending to remote vision-capable APIs

### 4. Reproducible note rendering

Generated Markdown notes may contain Mermaid code fences. VidGnost renders them into PNG assets under task artifacts and keeps relative image references inside Markdown, so exported bundles stay portable and replayable.

## Supported Inputs and Outputs

### Input sources

- Bilibili URL
- absolute local video path
- single or batch file upload

### Supported local video formats

Only these four local video formats are accepted:

- `MP4`
- `MOV`
- `AVI`
- `MKV`

### Output artifacts

- transcript
- notes
- mindmap
- subtitles: `srt`, `vtt`
- exported bundles: `zip`, `tar`
- event logs and trace replay data

## Repository Layout

```text
VidGnost/
├─ backend/                      # FastAPI backend, task pipeline, model runtime, storage
│  ├─ app/
│  │  ├─ api/                   # HTTP routes
│  │  ├─ services/              # pipeline, retrieval, model config, exporters, diagnostics
│  │  ├─ schemas.py
│  │  └─ main.py
│  ├─ tests/
│  ├─ pyproject.toml
│  └─ uv.lock
├─ frontend/                     # React renderer + Electron shell
│  ├─ components/
│  ├─ hooks/
│  ├─ lib/
│  ├─ src/
│  ├─ electron/
│  ├─ package.json
│  └─ pnpm-lock.yaml
├─ docs/                         # product docs, OpenSpec, architecture notes
├─ scripts/                      # bootstrap, cleanup, OpenSpec checks
├─ start-all.ps1
├─ start-all.sh
├─ README.md
└─ README.zh-CN.md
```

## Prerequisites

- Python `3.12.x`
- Node.js `18+`
- Corepack enabled
- `uv` for backend dependency management
- `pnpm` for frontend dependency management
- `ffmpeg` available in `PATH`
- an available model setup:
  - local Ollama for local LLM / embedding / VLM / rerank
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

Notes:

- the bootstrap scripts install backend and frontend dependencies
- default launch mode is `electron`
- explicit modes are also supported by the underlying bootstrap scripts, such as `web` and `electron`

### Option 2: manual development startup

Backend:

```bash
uv sync --directory backend --group dev
uv run --directory backend python -m uvicorn app.main:app --host 127.0.0.1 --port 8666 --reload
```

Frontend web mode:

```bash
pnpm --dir frontend install
pnpm --dir frontend dev --host 127.0.0.1 --port 6221
```

Electron desktop mode:

```bash
pnpm --dir frontend install
pnpm --dir frontend desktop:dev
```

Desktop package build:

```bash
pnpm --dir frontend build
```

Default local endpoints:

- backend API: `http://127.0.0.1:8666/api`
- frontend Vite dev server: `http://127.0.0.1:6221`

## Configuration Overview

Most operational settings are exposed in the settings center.

### Configurable areas

- Ollama runtime
  - install directory
  - executable path
  - model directory
  - service base URL
  - restart and migration workflows
- Whisper runtime
  - language
  - device
  - compute type
  - chunk settings
- managed model catalog
  - LLM
  - embedding
  - VLM
  - rerank
  - MLLM
- prompt templates
- UI preferences
- system self-check

### Important persisted files

- `backend/storage/model_config.json`
- `backend/storage/config.toml`
- `backend/storage/models/catalog.json`
- `backend/storage/ollama-runtime.json`
- `backend/storage/prompts/templates/*.json`
- `backend/storage/prompts/selection.json`

## HTTP API Surface

Base prefix: `/api`

### Health

- `GET /health`

### Tasks

- `POST /tasks/url`
- `POST /tasks/path`
- `POST /tasks/upload`
- `POST /tasks/upload/batch`
- `GET /tasks`
- `GET /tasks/stats`
- `GET /tasks/recent`
- `GET /tasks/{task_id}`
- `GET /tasks/{task_id}/source-media`
- `GET /tasks/{task_id}/artifacts/file`
- `GET /tasks/{task_id}/open-location`
- `PATCH /tasks/{task_id}/title`
- `PATCH /tasks/{task_id}/artifacts`
- `DELETE /tasks/{task_id}`
- `POST /tasks/{task_id}/cancel`
- `POST /tasks/{task_id}/pause`
- `POST /tasks/{task_id}/resume`
- `POST /tasks/{task_id}/rerun-stage-d`
- `GET /tasks/{task_id}/events`
- `GET /tasks/{task_id}/export/{kind}`

### Runtime config

- `GET /config/llm`
- `PUT /config/llm`
- `GET /config/ollama`
- `PUT /config/ollama`
- `POST /config/ollama/migrate-models`
- `POST /config/ollama/restart-service`
- `GET /config/whisper`
- `PUT /config/whisper`
- `GET /config/models`
- `POST /config/models/reload`
- `PATCH /config/models/{model_id}`
- `POST /config/models/migrate-local`
- `POST /config/models/{model_id}/download`
- `DELETE /config/models/{model_id}/download`
- `GET /config/prompts`
- `PUT /config/prompts/selection`
- `POST /config/prompts/templates`
- `PATCH /config/prompts/templates/{template_id}`
- `DELETE /config/prompts/templates/{template_id}`
- `GET /config/ui`
- `PUT /config/ui`

### Diagnostics and runtime

- `POST /self-check/start`
- `POST /self-check/{session_id}/auto-fix`
- `GET /self-check/{session_id}/report`
- `GET /self-check/{session_id}/events`
- `GET /runtime/metrics`
- `GET /runtime/paths`

### Retrieval and QA

- `POST /analyze`
- `POST /search`
- `POST /chat`
- `POST /chat/stream`
- `GET /traces/{trace_id}`

## Storage Layout

The backend writes runtime data under `backend/storage/`.

Important subtrees:

- `tasks/records/`
- `tasks/analysis-results/`
- `tasks/stage-artifacts/`
- `vector-index/`
- `event-logs/`
- `prompts/`
- `models/`

Examples:

- `backend/storage/tasks/stage-artifacts/<task_id>/D/fusion/notes-images/`
- `backend/storage/event-logs/<task_id>.jsonl`
- `backend/storage/event-logs/traces/*.jsonl`

## Development Workflow

### Install dependencies

Backend:

```bash
uv sync --directory backend --group dev
```

Frontend:

```bash
pnpm --dir frontend install
```

### Common validation commands

Backend tests:

```bash
uv run --directory backend python -m pytest
```

Backend import compilation check:

```bash
uv run --directory backend python -m compileall app
```

Frontend type-check:

```bash
pnpm --dir frontend exec tsc --noEmit
```

Frontend production build:

```bash
pnpm --dir frontend build
```

OpenSpec consistency:

```bash
python scripts/check-openspec.py
bash scripts/check-openspec.sh
powershell -ExecutionPolicy Bypass -File .\scripts\check-openspec.ps1
```

Workspace cleanup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\clean-workspace.ps1
```

```bash
bash ./scripts/clean-workspace.sh
```

## Related Documents

- [Chinese README](./README.zh-CN.md)
- [OpenSpec index](./docs/openspec/README.md)
- [Active change: build-lightweight-v2](./docs/openspec/changes/build-lightweight-v2/proposal.md)
- [Current tech stack (ZH)](./docs/current-tech-stack.zh-CN.md)
- [Frontend-driven backend execution checklist (ZH)](./docs/frontend-driven-backend-execution-checklist.zh-CN.md)
- [Git commit convention](./docs/git-commit-convention.md)

## License

This repository is released under the [MIT License](./LICENSE).
