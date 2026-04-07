<div align="center">
  <img src="./frontend/public/light.svg" alt="VidGnost Logo" width="120" />
  <h1>VidGnost</h1>
  <p><strong>API-first multimodal video analysis workbench</strong></p>
  <p>Analyze videos end to end with local transcription, online LLM generation, realtime observability, and exportable deliverables.</p>
</div>

<div align="center">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

<div align="center">

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19.2.4-61DAFB?logo=react&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![uv](https://img.shields.io/badge/backend-uv-6C47FF)
![pnpm](https://img.shields.io/badge/frontend-pnpm-F69220?logo=pnpm&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

<div align="center">

[Quick Start (EN)](./frontend/src/docs/quick-start.en.md) · [Quick Start (ZH)](./frontend/src/docs/quick-start.zh-CN.md)

</div>

## 1. Product Overview

VidGnost is a local-first execution workbench for video understanding:

- Source ingestion: Bilibili URL, local path, or direct upload
- Realtime runtime view: phase progress, logs, elapsed timing, warnings, and task lifecycle via SSE
- Speech transcription: local `Systran/faster-whisper-small` on CPU
- Stage-D generation: ordered subchain `transcript_optimize -> fusion_delivery`
- Deliverables: structured notes, markmap markdown, subtitles (`SRT` / `VTT`), and bundle export (`zip` / `tar`)
- Persistence: replayable task history, editable title, editable notes/mindmap markdown, and artifact metadata

## 2. Runtime Flow

1. Stage `A`: source validation and media preparation
2. Stage `B`: audio conversion and chunk planning
3. Stage `C`: Faster-Whisper transcription stream
4. Stage `D`: transcript optimization + online LLM notes/mindmap generation

Key runtime contracts:

- ASR runtime is CPU-only.
- Stage `D` generation uses online LLM API configuration from config center.
- Runtime warnings are surfaced as structured SSE events and persisted for replay diagnostics.

## 3. Repository Layout

```text
VidGnost/
├─ backend/                     # FastAPI backend (Python 3.12 + uv)
│  ├─ app/
│  │  ├─ api/                   # tasks/config/health/self-check routes
│  │  ├─ services/              # pipeline/runtime/guardrails/exporters
│  │  ├─ models.py              # data models
│  │  ├─ schemas.py             # API schemas
│  │  └─ main.py                # FastAPI entry
│  ├─ tests/                    # pytest suite
│  ├─ pyproject.toml            # backend dependencies
│  └─ uv.lock                   # lock file
├─ frontend/                    # React + Vite + TypeScript
│  ├─ src/
│  │  ├─ App.tsx                # workbench entry
│  │  ├─ lib/api.ts             # API client
│  │  ├─ docs/                  # in-app quick-start docs
│  │  └─ i18n/                  # i18n resources
│  ├─ package.json
│  └─ pnpm-lock.yaml
├─ docs/
│  ├─ openspec/                 # OpenSpec docs
│  ├─ ui/                       # UI prompt docs
│  └─ optimization-checklist.zh-CN.md
├─ scripts/                     # bootstrap / self-check / OpenSpec checks
└─ AGENTS.md                    # maintainer + agent index
```

## 4. Prerequisites

- OS:
  - Linux / macOS / WSL (`scripts/bootstrap-and-run.sh`)
  - Windows PowerShell 7+ (`scripts/bootstrap-and-run.ps1`)
- Python `3.12.x`
- Node.js `>=18` (Corepack enabled)
- Package managers: backend `uv`, frontend `pnpm`
- `ffmpeg` available in system `PATH`
- Online LLM API key for stage `D` generation

## 5. Start the Project

### 5.1 One-click bootstrap

Linux / macOS / WSL:

```bash
cd VidGnost
./scripts/bootstrap-and-run.sh
```

Windows PowerShell:

```powershell
cd VidGnost
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-and-run.ps1
```

### 5.2 Manual startup

Backend:

```bash
cd backend
uv sync --python 3.12 --index-url https://pypi.tuna.tsinghua.edu.cn/simple/
uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Frontend:

```bash
cd frontend
pnpm install
# Optional: override backend API base URL for local multi-env setup.
# Example: VITE_API_BASE_URL=http://127.0.0.1:18000/api
pnpm dev --host 0.0.0.0 --port 5173
```

Default URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`

### 5.3 Runtime configuration checklist

1. Open runtime config modal.
2. In `Online LLM` tab, fill `base_url`, `model`, `api_key`.
3. In `Faster-Whisper` tab, confirm:
   - `model_default=small`
   - `device=cpu`
   - `compute_type=int8|float32`
   - `language`, `chunk_seconds`, and other ASR knobs
4. Save config and submit a task.

## 6. Persistence and Storage

Primary files and directories:

- LLM config: `backend/storage/model_config.json`
- Whisper runtime config: `backend/storage/config.toml`
- Prompt templates: `backend/storage/prompts/templates/*.json`
- Prompt selection: `backend/storage/prompts/selection.json`
- Task records: `backend/storage/tasks/records/*.json`
- Stage artifacts: `backend/storage/tasks/stage-artifacts/<task_id>/<stage>/**`
- Stage snapshots: `backend/storage/tasks/analysis-results/<task_id>/<stage>.json`
- Runtime warnings: `backend/storage/tasks/runtime-warnings/<task_id>.jsonl`
- Event logs: `backend/storage/event-logs/<task_id>.jsonl`

## 7. Troubleshooting

| Symptom | Meaning | Action |
| --- | --- | --- |
| `Task failed: RuntimeError: Library cublas64_12.dll is not found` | Whisper runtime was configured as CUDA in this environment | Save runtime config with `device=cpu` and rerun task |
| `warning: Failed to hardlink files; falling back to full copy.` | `uv` cache and target directories are on different filesystems | Set `UV_LINK_MODE=copy` to suppress warning |
| Stage D fails with auth/connectivity errors | Online LLM endpoint or credentials are invalid | Verify `base_url`, `model`, `api_key`, and quota |

## 8. Development Commands

Backend checks:

```bash
cd backend
uv run pytest
uv run python -m compileall app
```

Frontend checks:

```bash
cd frontend
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

OpenSpec checks:

```bash
python scripts/check-openspec.py
bash scripts/check-openspec.sh
powershell -ExecutionPolicy Bypass -File scripts/check-openspec.ps1
```

## 9. Related Documentation

- [Quick Start (EN)](./frontend/src/docs/quick-start.en.md)
- [Quick Start (ZH)](./frontend/src/docs/quick-start.zh-CN.md)
- [Error Code Dictionary (ZH)](./docs/error-codes.zh-CN.md)
