<div align="center">
  <img src="./apps/desktop/public/icon.png" alt="VidGnost" width="88" />

  <h1>VidGnost</h1>

  <p><strong>A video knowledge engine.</strong><br />
  Turn a video or audio file into one timestamped spine — chapters, summary, mind map, concepts and
  cited answers all hang off it, and every <code>[mm:ss]</code> jumps back to the source.</p>

  <p><a href="./README.md">English</a> | <a href="./README.zh-CN.md">中文</a></p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5" />
    <img src="https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white" alt="Fastify 5" />
    <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
    <img src="https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white" alt="Electron 31" />
    <img src="https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white" alt="pnpm workspace" />
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" /></a>
  </p>
</div>

## What you get

<p align="center">
  <img src="./assets/readme/studio.jpg" width="100%"
       alt="VidGnost studio: chapter rail with timecodes on the left, a chapter summary with clickable timecode chips in the middle, Copilot on the right, persistent player bar at the bottom" />
</p>

<p align="center"><sub>A real run from this repository — a 7:26 video that produced 9 chapters and 10 concepts.
The left rail is the chapter list; every conclusion in the middle carries a timecode you can click;
Copilot answers cite the clips they came from.</sub></p>

## Why it is different

Plain transcription hands you a wall of text. Plain summarisation hands you claims you cannot check.
VidGnost builds the **timestamped structure first**, then attaches every artefact to it — so nothing is
a dead end.

<p align="center">
  <img src="./assets/readme/spine.svg" width="100%"
       alt="A timeline with four timecode anchors; chapters, summary, mind map and cited answers all sit on it" />
</p>

1. **Every claim points back to the source.** Summary highlights, transcript lines, mind map nodes,
   concepts and answers share one `seek` implementation: clicking a timecode jumps the player.
2. **Online first, local fallback.** Alibaba Cloud Model Studio (DashScope) powers chat, vision,
   embeddings, translation and file-level ASR by default; missing credentials or network failures fall
   back to local `faster-whisper`.
3. **Artefacts are structure.** Chapters are the structural unit, retrieval chunks are bound to
   chapters, and the index covers raw text, contextual prefixes and generated question variants.

## Get started

Requirements: Node.js 18+, `pnpm`, and `ffmpeg`/`ffprobe` on `PATH`.
Downloading online videos additionally needs `yt-dlp`; local Whisper needs Python 3.10+ and `uv`.

```bash
pnpm install

# terminal 1 — backend
pnpm dev:backend

# terminal 2 — the Electron desktop window
pnpm dev:desktop
```

The renderer alone (no Electron shell) is also available for browser debugging:

```bash
pnpm dev:frontend        # http://127.0.0.1:6221
```

Then drop a local file onto the library or paste a link.

## How it works

Ten ordered stages, each writing a checkpoint, so an interrupted run resumes instead of restarting:

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
so **switching a model only re-runs the stages it affects**.

### Retrieval and Q&A

1. Chunking respects chapter boundaries (target 320 tokens, 80-token overlap).
2. Each chunk gets a 50–80 token contextual prefix and three question variants — this fixes pronoun
   drop-out and colloquial phrasing.
3. Vector top-40 and BM25 top-40 recall in parallel, fused with RRF (k=60).
4. OpenRouter reranks the top 30; the best K (default 8) become evidence.
5. Global questions ("what is this about overall?") route to chapter-summary map-reduce instead of
   fragment top-k.
6. Answers stream token by token; the server validates `[mm:ss]` anchors and maps them onto structured
   citations.

## Models and credentials

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

Credentials come from environment variables; the Models workspace also accepts inline overrides and
only ever shows a masked tail:

```bash
DASHSCOPE_API_KEY=sk-xxxxxxxx      # Alibaba Cloud Model Studio
OPENROUTER_API_KEY=sk-or-v1-xxxx   # OpenRouter (rerank)
```

## Workbench

Four workspaces, one shared time coordinate system.

<p align="center">
  <img src="./assets/readme/library.jpg" width="100%"
       alt="Library: every processed video as a card with readiness, tags, duration and scale" />
</p>

- **Library** — the single entry point: readiness, tags, scale, search and delete.
- **Studio** — chapter rail / content stage / Copilot, with a persistent player bar. Five tabs (notes,
  transcript, mind map, concepts, frames) plus a live stage board while processing.
- **Models** — two scopes (online / local) subdivided by provider and capability down to individual
  models; credentials and base URLs live in the provider block, roles are assigned on the model cards.
- **Settings** — default processing options, storage directory and toolchain probing.

<p align="center">
  <img src="./assets/readme/models.jpg" width="100%"
       alt="Models workspace: online and local scopes, provider blocks with credential state, models grouped by capability with role assignment" />
</p>

The interface is dark-first: graphite canvas with an aurora wash, hairline borders, an 8pt grid,
monospaced timecodes, a global `Ctrl/⌘ + K` command palette, and a light theme verified to the same
contrast bar (`node scripts/check-theme-contrast.mjs`).

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
│  │  ├─ src/insight/         # segmentation, chapters, summary, mind map, knowledge graph, translation
│  │  ├─ src/retrieval/       # chunking, BM25, vector index, hybrid search, Q&A
│  │  ├─ src/pipeline/        # stage engine, task manager, event bus
│  │  ├─ src/store/           # task and artefact repositories
│  │  ├─ src/routes/          # HTTP and SSE routes
│  │  └─ test/                # Vitest unit tests
│  └─ desktop/                # Electron + React desktop app
│     ├─ electron/            # main process, preload, splash
│     └─ src/                 # renderer: shell / library / studio / views
├─ packages/
│  ├─ contracts/              # shared domain contracts (zod-validated request bodies)
│  └─ shared/                 # shared constants
├─ assets/readme/             # README visuals (diagram + screenshots)
├─ docs/openspec/             # proposals, design and capability specs
├─ storage/                   # runtime data (tasks, artefacts, indexes, config)
└─ scripts/                   # validation and operations scripts
```

## Verification

```bash
pnpm build                                            # build every workspace
pnpm -r typecheck                                     # typecheck all packages
pnpm -r test                                          # 40 renderer + 125 backend unit tests
node scripts/check-openspec.mjs                       # spec structure
node scripts/check-theme-contrast.mjs                 # 42 colour pairs, light and dark
node scripts/check-spec-sync.mjs                      # code changes keep specs in sync
```

## Documentation

- [OpenSpec index](./docs/openspec/README.md) — proposals, design and the nine capability specs
- [Current tech stack (zh-CN)](./docs/current-tech-stack.zh-CN.md)
- [Commit and release convention](./docs/git-commit-convention.md)

## License

Released under the [MIT License](./LICENSE).
