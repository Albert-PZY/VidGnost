<div align="center">
  <img src="./frontend/public/light.svg" alt="VidGnost Logo" width="120" />
  <h1>VidGnost</h1>
  <p><strong>API-first multimodal video analysis workbench</strong></p>
  <p>From video ingestion to structured notes, mindmap, subtitles, and exportable artifacts with realtime runtime visibility.</p>
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

## 1. What You Get

- Input sources: Bilibili URL / local file path / file upload
- Realtime workbench:
  - Stage progress, logs, elapsed time, and runtime warnings via SSE
  - Task status transitions and cancellation feedback
- Speech recognition:
  - Faster-Whisper (CPU runtime)
  - Transcript correction modes: `off` / `strict` / `rewrite`
- Stage-D generation path:
  - Keep only `transcript_optimize -> fusion_delivery`
  - No local frame extraction, no VLM frame semantics, no OCR pipeline
- Output artifacts:
  - Detailed notes, mindmap, subtitles (`SRT` / `VTT`)
  - One-click bundle export (`zip` / `tar`)
- Persistence:
  - Task history replay, title edit, terminal-task delete
  - Editable `notes.md` and `mindmap.md` with export consistency

## 2. Processing Flow

1. Stage `A`: source ingestion and normalization
2. Stage `B`: audio preprocessing and chunk planning
3. Stage `C`: Faster-Whisper transcription streaming
4. Stage `D`: ordered substage chain
   - `transcript_optimize -> fusion_delivery`

Implementation notes:

- Summarization/mindmap generation is online LLM API only.

## 3. Repository Structure

```text
VidGnost/
├─ backend/                     # FastAPI backend (Python 3.12 + uv)
│  ├─ app/
│  │  ├─ api/                   # tasks/config/health/self-check routes
│  │  ├─ services/              # pipeline/runtime/guardrails/exporters
│  │  ├─ models.py              # data record models
│  │  ├─ schemas.py             # API schemas
│  │  └─ main.py                # FastAPI entry
│  ├─ tests/                    # pytest suite
│  ├─ pyproject.toml            # backend dependencies
│  └─ uv.lock                   # lock file
├─ frontend/                    # React + Vite + TypeScript
│  ├─ src/
│  │  ├─ App.tsx                # main workbench UI
│  │  ├─ lib/api.ts             # API client
│  │  ├─ docs/                  # in-app quick-start docs
│  │  └─ i18n/                  # i18n resources
│  ├─ package.json
│  └─ pnpm-lock.yaml
├─ docs/
│  ├─ openspec/                 # OpenSpec docs
│  ├─ ui/                       # UI prompt docs
│  └─ optimization-checklist.zh-CN.md
├─ scripts/                     # bootstrap / self-check / OpenSpec check scripts
└─ AGENTS.md                    # maintainer/agent index
```

## 4. Requirements

- OS:
  - Linux / macOS / WSL (for `scripts/bootstrap-and-run.sh`)
  - Windows PowerShell 7+ (for `scripts/bootstrap-and-run.ps1`)
- Python: `3.12.x`
- Node.js: `>= 18` (Corepack enabled)
- Package management: backend `uv`, frontend `pnpm`
- System dependency: `ffmpeg` in `PATH`
- CPU runtime for Faster-Whisper transcription
- API credentials:
  - LLM API key (required for stage `D` generation)

## 5. Getting Started

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

### 5.2 Manual startup (recommended for deterministic setup)

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
pnpm dev --host 0.0.0.0 --port 5173
```

Default URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`

### 5.3 Post-start runtime config checklist

1. Open runtime config modal.
2. In `Online LLM` tab:
   - Fill LLM API (`base_url`, `model`, `api_key`)
3. In `Faster-Whisper` tab, confirm ASR defaults (`model_default`, `language`, `compute_type`, `chunk_seconds`).
4. Save config and submit task.

## 6. Runtime Config and Storage

Key persistence files:

- LLM config: `backend/storage/model_config.json`
- Whisper runtime config: `backend/storage/config.toml`
- Prompt templates: `backend/storage/prompts/templates/*.json`
- Prompt selection: `backend/storage/prompts/selection.json`
- Task records: `backend/storage/tasks/records/*.json`
- Stage artifacts: `backend/storage/tasks/stage-artifacts/<task_id>/<stage>/**`
- Analysis snapshots: `backend/storage/tasks/analysis-results/<task_id>/*.json`

Config center tabs:

- `Online LLM`
  - LLM API runtime fields
- `Faster-Whisper`
  - ASR runtime parameters and transcript correction options
- `Prompt Templates`
  - Summary/mindmap template CRUD and selection

## 7. Troubleshooting

| Symptom | Meaning | Action |
| --- | --- | --- |
| `Task failed: RuntimeError: Library cublas64_12.dll is not found` | Legacy GPU runtime expectation in old environment/config | Update to latest code and keep Whisper device as `cpu` in runtime config |
| `warning: Failed to hardlink files; falling back to full copy.` | `uv` cache and target are on different filesystems; hardlink unsupported | Set `UV_LINK_MODE=copy` to suppress warning |
| Stage D fails with API auth/connectivity errors | API credentials or endpoint unreachable | Verify `base_url/model/api_key` for LLM and test connectivity |

## 8. Development Commands

Backend tests:

```bash
cd backend
uv run pytest
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
powershell -ExecutionPolicy Bypass -File scripts/check-openspec.ps1
```

## 9. Related Docs

- [Quick Start (EN)](./frontend/src/docs/quick-start.en.md)
- [Quick Start (ZH)](./frontend/src/docs/quick-start.zh-CN.md)
- [Error Code Dictionary (ZH)](./docs/error-codes.zh-CN.md)
