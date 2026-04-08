# VidGnost Quick Start

## 1. Runtime Topology

VidGnost executes each analysis task with the following pipeline:

1. Source ingestion and media preparation (`A`)
2. Audio conversion and chunk planning (`B`)
3. Local transcription with `Systran/faster-whisper-small` on CPU (`C`)
4. Stage-D ordered subchain: `transcript_optimize -> fusion_delivery` (`D`)
5. Online LLM generation of notes + markmap markdown

## 2. Prerequisites

- Python 3.12
- `uv`
- Node.js 18+ with Corepack
- `pnpm`
- `ffmpeg` in system `PATH`
- Valid online LLM API credentials (`base_url`, `model`, `api_key`)

## 3. Install Dependencies

From repository root:

```bash
uv sync --project backend --python 3.12 --index-url https://pypi.tuna.tsinghua.edu.cn/simple/
pnpm --dir frontend install
```

## 4. Start Services

Backend:

```bash
cd backend
uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Frontend:

```bash
cd frontend
pnpm dev --host 0.0.0.0 --port 5173
```

Open `http://localhost:5173`.

## 5. Configure Runtime

Open `Runtime Config` in the header and fill:

1. `Online LLM`
   - `base_url`
   - `model`
   - `api_key`
2. `Faster-Whisper`
   - `model_default=small`
   - `device=cpu`
   - `compute_type` = `int8` or `float32`
   - `language`, `chunk_seconds`, and other ASR controls
3. `Prompt Templates`
   - Select summary and mindmap templates for Stage-D generation

## 6. Submit and Monitor a Task

1. Open source modal and submit URL/path/upload source.
2. Monitor realtime SSE events in runtime tabs (`A`, `B`, `C`, `transcript_optimize`, `D`).
3. Review outputs after completion:
   - transcript
   - notes markdown
   - mindmap markdown + visual render
   - subtitle exports (`SRT`, `VTT`)

## 7. Export and History

- Download bundle (`zip` on Windows, `tar` on Linux/macOS)
- Reopen historical tasks from history modal
- Edit task title
- Edit notes/mindmap markdown for terminal tasks and export latest content

## 8. Quick Troubleshooting

### 8.1 LLM API error in Stage D

Check endpoint reachability, model name, API key validity, and quota.

### 8.2 Whisper runtime error with CUDA DLL messages

Save runtime config with `device=cpu` and rerun.

### 8.3 `uv` hardlink warning

If cache and project are on different filesystems, set `UV_LINK_MODE=copy`.
