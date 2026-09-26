<div align="center">
  <img src="./apps/desktop/public/icon.png" alt="VidGnost Logo" width="112" />
  <h1>VidGnost</h1>
  <p><strong>A video knowledge engine</strong></p>
  <p>Turn any video or audio file into timestamp-anchored, searchable, answerable and exportable knowledge.</p>
</div>

<div align="center">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

## The problem

After watching a video you need three things: what it said, at which minute it said it, and what else you can ask about it.
Plain transcription gives you a wall of text; plain summarisation gives you claims you cannot verify.

VidGnost builds a **timestamped structural spine first**, then attaches every artefact to that spine.

- every conclusion carries an `[mm:ss]` anchor
- every answer cites clips you can click to jump to and play
- chapters, summary, mind map and concept graph all share one time coordinate system

## Three product principles

1. **Every claim points back to the source.** Summary highlights, transcript lines, mind map nodes, concepts and
   answers all use one shared `seek` implementation — clicking a timecode jumps the player.
2. **Online first, local fallback.** Alibaba Cloud Model Studio (DashScope) powers chat, vision, embeddings,
   translation and file-level ASR by default; unconfigured credentials or network failures fall back to local `faster-whisper`.
3. **Artefacts are structure.** Chapters are structural units, retrieval chunks are bound to chapters, and the index
   covers raw text, contextual prefixes and generated question variants.

## Pipeline

Ten ordered stages, each writing a checkpoint so an interrupted run can resume:

| # | Stage | Output |
| --- | --- | --- |
| 1 | `ingest` | media on disk, duration and content fingerprint |
| 2 | `audio` | 16 kHz mono audio and ASR chunks |
| 3 | `transcribe` | sentence/word timestamps, SRT, plain text |
| 4 | `structure` | semantic paragraphs, chapters with bullets and anchors |
| 5 | `insight` | TL;DR, highlights, actions, questions, glossary, tags |
| 6 | `mindmap` | mind map tree plus Mermaid source |
| 7 | `knowledge` | lightweight concept/relation graph |
| 8 | `vision` | key frames, on-screen text, multimodal captions |
| 9 | `index` | contextual prefixes, question variants, vector + BM25 index |
| 10 | `finalize` | Markdown report, JSON pack, translation artefacts |

The stage cache key is `sha1(stage | source fingerprint | relevant model routes | relevant options)`,
so **switching a model only re-runs the affected stages**.

## Model routing

The pipeline depends on roles, never on concrete model names:

| Role | Default model | Provider |
| --- | --- | --- |
| `llm.fast` | `qwen3.8-flash` | DashScope |
| `llm.balanced` | `qwen3.8-27b` | DashScope |
| `llm.reasoning` | `deepseek-v4-pro-0813` | DashScope |
| `llm.quality` | `qwen3.8-max-0902` | DashScope |
| `llm.bulk` | `qwen3.8-2.4t-a95b` | DashScope |
| `llm.fallback` | `deepseek-v4-flash-0731` | DashScope |
| `vision.primary` | `qwen3.8-omni-flash` | DashScope |
| `asr.online` | `qwen-audio-3.1-asr-flash-filetrans` | DashScope |
| `asr.local` | `faster-whisper` | local |
| `embedding` | `qwen3.7-text-embedding-flash` | DashScope |
| `rerank` | `nvidia/llama-nemotron-rerank-vl-1b-v2:free` | OpenRouter |
| `translate` | `qwen-mt-uni` | DashScope |

Credentials come from environment variables, and the settings page accepts inline overrides.
The UI only ever shows a masked tail:

```bash
DASHSCOPE_API_KEY=sk-xxxxxxxx      # Alibaba Cloud Model Studio
OPENROUTER_API_KEY=sk-or-v1-xxxx   # OpenRouter (rerank)
```

## Retrieval and Q&A

1. Chunking respects chapter boundaries (target 320 tokens, 80-token overlap).
2. Each chunk gets a 50–80 token contextual prefix and three question variants — this fixes pronoun drop-out and
   colloquial phrasing.
3. Vector top-40 and BM25 top-40 recall in parallel, fused with RRF (k=60).
4. OpenRouter reranks the top 30; the best K (default 8) become evidence.
5. Global questions ("what is this about overall?") route to chapter-summary map-reduce instead of fragment top-k.
6. Answers stream token by token; the server validates `[mm:ss]` anchors and maps them onto structured citations.

## Getting started

Requirements: Node.js 18+, `pnpm`, and `ffmpeg`/`ffprobe` on PATH.
Downloading online videos additionally needs `yt-dlp`; local Whisper needs Python 3.10+ and `uv`.

```bash
pnpm install

# terminal 1 — backend
pnpm --filter @vidgnost/api dev

# terminal 2 — renderer in the browser
pnpm --filter @vidgnost/desktop dev --host 127.0.0.1 --port 6221

# or launch the Electron desktop window directly
pnpm --filter @vidgnost/desktop desktop:dev
```

Defaults:

- API: `http://127.0.0.1:8666/api`
- Renderer: `http://127.0.0.1:6221`

## Workbench

- **Library** — the single entry point for every processed video: readiness, tags, scale, search and delete.
- **Studio** — chapter rail / content stage / Copilot, with a persistent player bar at the bottom. Five tabs
  (notes, transcript, mind map, concepts, frames) plus a live stage board while processing.
- **Models** — provider credential state, role routing, and a runtime self-check that performs real network calls.
- **Settings** — default processing options, local Whisper configuration and toolchain probing.

The interface is dark-first: graphite canvas with aurora tint, hairline borders, an 8pt grid,
monospaced timecodes and a global `Ctrl/⌘ + K` command palette.

## Repository layout

```text
VidGnost/
├─ apps/
│  ├─ api/                    # Fastify + TypeScript backend
│  │  ├─ python/              # isolated faster-whisper Python worker
│  │  ├─ src/core/            # config, errors, fs, text, process
│  │  ├─ src/providers/       # model catalogue, role routing, provider clients, health checks
│  │  ├─ src/media/           # source resolution, audio extraction, key frames, perceptual hashing
│  │  ├─ src/asr/             # online/local transcription orchestration and normalisation
│  │  ├─ src/insight/         # segmentation, chapters, summary, mind map, knowledge graph, proofreading, translation
│  │  ├─ src/retrieval/       # chunking, BM25, vector index, hybrid search, Q&A
│  │  ├─ src/pipeline/        # stage engine, task manager, event bus
│  │  ├─ src/store/           # task and artefact repositories
│  │  ├─ src/routes/          # HTTP and SSE routes
│  │  └─ test/                # Vitest unit tests
│  └─ desktop/                # Electron + React desktop app
│     ├─ electron/            # main process, preload, splash
│     └─ src/                 # renderer: shell / library / studio / config
├─ packages/
│  ├─ contracts/              # shared domain contracts (zod-validated request bodies)
│  └─ shared/                 # shared constants
├─ docs/openspec/             # proposals, design and capability specs
├─ storage/                   # runtime data (tasks, artefacts, indexes, config)
└─ scripts/                   # validation and operations scripts
```

## Verification

```bash
pnpm typecheck                                        # typecheck all three packages
pnpm --filter @vidgnost/api test                      # backend unit tests
pnpm --filter @vidgnost/desktop test                  # renderer unit tests
node scripts/check-openspec.mjs                       # OpenSpec validation
```

## Documentation

- [OpenSpec index](./docs/openspec/README.md)
- [Current tech stack (zh-CN)](./docs/current-tech-stack.zh-CN.md)
- [Commit convention](./docs/git-commit-convention.md)

## License

Released under the [MIT License](./LICENSE).
