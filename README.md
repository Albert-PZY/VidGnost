<div align="center">
  <img src="./frontend/public/light.svg" alt="VidGnost Logo" width="120" />
  <h1>VidGnost</h1>
  <p><strong>Electron-ready multimodal video analysis workbench</strong></p>
  <p>Local transcription, online LLM generation, VQA retrieval/chat, realtime observability, and reproducible exports.</p>
</div>

<div align="center">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

<div align="center">

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19.2.4-61DAFB?logo=react&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-41.2.0-47848F?logo=electron&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![uv](https://img.shields.io/badge/backend-uv-6C47FF)
![pnpm](https://img.shields.io/badge/frontend-pnpm-F69220?logo=pnpm&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

## 1. Product Snapshot

VidGnost is a local-first video analysis workbench with web and Electron runtime forms:

- Source ingestion: Bilibili URL, local file path, file upload
- Async runtime pipeline: `A -> B -> C -> D`, with stage-D subflow `transcript_optimize -> fusion_delivery`
- Local ASR: `faster-whisper` (`small`, CPU)
- Online generation: notes + mindmap through OpenAI-compatible APIs
- VQA workflow: retrieval/search, chat streaming, and trace replay
- Realtime observability: SSE logs/progress/warnings with per-event trace metadata
- Persistence and replay: task history, editable titles, editable notes/mindmap markdown
- Deterministic export: transcript, notes, mindmap, subtitles (`srt`/`vtt`), bundle (`zip`/`tar`)

## 2. Runtime and Architecture

### 2.1 End-to-end pipeline

1. Stage `A`: source validation and media preparation
2. Stage `B`: audio conversion and chunk planning
3. Stage `C`: streaming transcription
4. Stage `D`: transcript optimization and notes/mindmap fusion

### 2.2 Workbench modes

- `flow`: runtime status, phase logs, transcript and generation editing/preview
- `qa`: retrieval-augmented answer streaming with evidence citations
- `debug`: dense/sparse/RRF/rerank comparison and trace record replay

### 2.3 Host forms

- Web: React + Vite app with backend API base `http://localhost:8000/api`
- Desktop: Electron (`main/preload/renderer`) with IPC bridge
  - Electron checks `/api/health` and can auto-spawn backend via `uv run uvicorn`

## 3. API Surface (Current)

Base URL: `/api`

- Health
  - `GET /health`
- Tasks and runtime
  - `POST /tasks/url`
  - `POST /tasks/path`
  - `POST /tasks/upload`
  - `GET /tasks`
  - `GET /tasks/{task_id}`
  - `PATCH /tasks/{task_id}/title`
  - `PATCH /tasks/{task_id}/artifacts`
  - `DELETE /tasks/{task_id}`
  - `POST /tasks/{task_id}/cancel`
  - `POST /tasks/{task_id}/rerun-stage-d`
  - `GET /tasks/{task_id}/events` (SSE)
  - `GET /tasks/{task_id}/export/{kind}`
- Runtime config
  - `GET/PUT /config/llm`
  - `GET/PUT /config/whisper`
  - `GET /config/prompts`
  - `PUT /config/prompts/selection`
  - `POST /config/prompts/templates`
  - `PATCH /config/prompts/templates/{template_id}`
  - `DELETE /config/prompts/templates/{template_id}`
- Self-check
  - `POST /self-check/start`
  - `POST /self-check/{session_id}/auto-fix`
  - `GET /self-check/{session_id}/report`
  - `GET /self-check/{session_id}/events` (SSE)
- VQA
  - `POST /search`
  - `POST /chat`
  - `POST /chat/stream` (SSE-like stream response)
  - `POST /analyze`
  - `GET /traces/{trace_id}`

## 4. Mermaid Note Rendering Contract

- Stage-D note output supports Mermaid code fences in LLM markdown.
- Backend converts Mermaid blocks into PNG files under `notes-images/`.
- Markdown artifacts reference images by relative paths (for example `![Mermaid 1](notes-images/mermaid-001.png)`), not base64.
- Bundle export includes `notes-images/**/*.png` assets.

## 5. Repository Layout

```text
VidGnost/
├─ backend/                              # FastAPI backend (Python 3.12 + uv)
│  ├─ app/
│  │  ├─ api/                            # health/tasks/config/self-check/vqa routes
│  │  ├─ services/                       # pipeline, summarizer, retrieval, trace, exporters
│  │  ├─ schemas.py
│  │  └─ main.py
│  ├─ tests/
│  ├─ pyproject.toml
│  └─ uv.lock
├─ frontend/                             # React + Electron + TypeScript
│  ├─ src/
│  │  ├─ main/                           # Electron main process entry
│  │  ├─ preload/                        # Electron preload bridge
│  │  ├─ components/
│  │  ├─ hooks/
│  │  ├─ lib/
│  │  └─ App.tsx
│  ├─ electron.vite.config.ts
│  ├─ package.json
│  └─ pnpm-lock.yaml
├─ docs/
│  ├─ openspec/
│  └─ electron-fullstack-rebuild-plan.zh-CN.md
├─ scripts/
└─ AGENTS.md
```

## 6. Prerequisites

- Python `3.12.x`
- Node.js `>=18` with Corepack enabled
- Backend package manager: `uv`
- Frontend package manager: `pnpm`
- `ffmpeg` available in `PATH`
- Online LLM API credentials for stage-D generation and VQA answer quality

## 7. Run the Project

### 7.1 One-click bootstrap scripts

Linux/macOS/WSL:

```bash
cd VidGnost
./scripts/bootstrap-and-run.sh
```

Windows PowerShell:

```powershell
cd VidGnost
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-and-run.ps1
```

### 7.2 Manual web mode

Backend:

```bash
cd backend
uv sync --python 3.12
uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Frontend:

```bash
cd frontend
pnpm install
pnpm dev --host 0.0.0.0 --port 5173
```

### 7.3 Electron desktop mode

```bash
cd frontend
pnpm install
pnpm desktop:dev
```

Build desktop packages:

```bash
cd frontend
pnpm desktop:build
```

## 8. Storage Layout

- Runtime config
  - `backend/storage/model_config.json`
  - `backend/storage/config.toml`
  - `backend/storage/prompts/templates/*.json`
  - `backend/storage/prompts/selection.json`
- Task state and artifacts
  - `backend/storage/tasks/records/*.json`
  - `backend/storage/tasks/analysis-results/<task_id>/<stage>.json`
  - `backend/storage/tasks/stage-artifacts/<task_id>/<stage>/**`
  - `backend/storage/tasks/stage-artifacts/<task_id>/D/fusion/notes-images/**/*.png`
- Observability
  - `backend/storage/tasks/runtime-warnings/<task_id>.jsonl`
  - `backend/storage/event-logs/<task_id>.jsonl`
  - `backend/storage/event-logs/traces/*.jsonl`

## 9. Development Checks

Backend:

```bash
cd backend
uv run pytest
uv run python -m compileall app
```

Frontend:

```bash
cd frontend
pnpm lint
pnpm build
pnpm test
```

OpenSpec:

```bash
python scripts/check-openspec.py
bash scripts/check-openspec.sh
powershell -ExecutionPolicy Bypass -File scripts/check-openspec.ps1
```

## 10. Related Documents

- [OpenSpec Index](./docs/openspec/README.md)
- [Active Change: build-lightweight-v2](./docs/openspec/changes/build-lightweight-v2/proposal.md)
- [Electron Fullstack Rebuild Plan (ZH)](./docs/electron-fullstack-rebuild-plan.zh-CN.md)
- [Git Commit Convention](./docs/git-commit-convention.md)
