# VidGnost Quick Start (Current Build)

## 1. Runtime Architecture

The current pipeline is simplified to:

1. Local audio preprocessing and chunking
2. Local `Systran/faster-whisper-small` transcription (GPU-only)
3. Stage D subchain: `transcript_optimize -> fusion_delivery`
4. Online LLM generation for detailed notes and mindmap

Removed from this build:

- Local video frame extraction stage
- VLM frame semantic recognition stage
- OCR-related pipeline

## 2. Prerequisites

- Python 3.12
- `uv`
- Node.js + `pnpm`
- `ffmpeg` (required)
- NVIDIA driver + CUDA runtime (required by GPU-only Faster-Whisper)

## 3. Startup

From project root:

- Backend deps: `uv sync --project backend`
- Frontend deps: `pnpm --dir frontend install`

Then run backend and frontend dev servers as usual.

## 4. Runtime Config

In Runtime Config Center:

1. In `Online LLM` tab, fill:
   - `base_url`
   - `model`
   - `api_key`
2. In `Faster-Whisper` tab, confirm:
   - `model_default` (fixed to `small`)
   - `language`
   - `compute_type`
   - `chunk_seconds`

## 5. FAQ

### 5.1 Stage-D API auth or timeout errors

Check:

- `base_url` reachability
- `model` correctness
- `api_key` validity and quota

### 5.2 CUDA warnings from bootstrap scripts

Check:

- `nvidia-smi` availability
- backend venv dependencies installed via `uv sync`
- CUDA runtime and driver compatibility
