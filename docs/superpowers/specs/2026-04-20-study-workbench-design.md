# VidGnost Study Workbench Refactor Design

**Date:** 2026-04-20
**Status:** Approved

## Scope

This design refactors VidGnost from a task-first multimodal workbench into a local-first study workbench that keeps the existing task orchestration, SSE stream, exports, diagnostics, and configuration center intact.

The refactor covers:

- online and local video study entry points
- subtitle-track resolution with Whisper fallback
- optional translation decision and cached translated transcript layers
- study-pack generation for overview, highlights, themes, suggested questions, and top quotes
- knowledge-note capture and knowledge library views
- study-first desktop workbench structure with `Study / QA / Flow / Trace / Knowledge`
- OpenSpec and contract alignment

## Architecture

### Task Backbone

The existing task backbone remains the system of record:

- `TaskRepository` remains the source of truth for task records, source paths, artifacts, and export compatibility.
- `TaskOrchestrator` remains responsible for queued/running/paused/cancelled/completed transitions and SSE publishing.
- Stage `D` is narrowed to transcript-driven study generation. VQA prewarm remains transcript-only and is no longer blocked on frame extraction or VLM enrichment.

### Study Domain

The refactor adds a study domain under `apps/api/src/modules/study/`:

- `SubtitleTrackService` resolves source type, detects remote subtitle tracks with `yt-dlp`, persists track metadata, and falls back to Whisper when no usable track exists.
- `TranslationDecisionService` decides whether the transcript layer stays original, switches to a platform translation track, or uses an LLM-generated translation cache.
- `StudyWorkspaceService` produces the normalized study pack from transcript, summary artifacts, and generation tier.
- `SqliteStudyRepository` stores structured study entities in `storage/study/study.db`.
- `KnowledgeNoteRepository` persists task-linked notes and library filters on top of SQLite.
- `ExportFormatterService` formats study-pack, subtitle-track, translation-record, and knowledge-note exports.
- `StudyService` reads the task backbone plus the study repository to expose read models for the desktop renderer.

### Desktop Workbench

The existing processing view becomes a study-first task workbench:

- `Study` is the default mode and focuses on overview, highlights, themes, questions, subtitle tracks, transcript, and player linkage.
- `QA` keeps transcript-grounded questioning and citation jumps.
- `Flow` keeps stage progress, SSE logs, and runtime activity.
- `Trace` keeps retrieval and answer-trace inspection.
- `Knowledge` keeps notes, mindmap, saved note cards, and export actions.

The desktop shell also gains a global `Knowledge` library view. History is upgraded into a learning library with study preview metadata.

## Data Model

SQLite becomes the study-domain store. Task JSON records stay as compatibility storage.

Primary tables:

- `study_tasks`
- `study_packs`
- `study_highlights`
- `study_themes`
- `study_questions`
- `study_quotes`
- `study_state`
- `subtitle_tracks`
- `translation_records`
- `knowledge_notes`
- `export_records`

## Key Decisions

1. `workflow` remains `notes | vqa` for this delivery.
   Study is introduced as a task workbench mode and study-domain projection, not as a third workflow.

2. Remote URLs are classified explicitly as `youtube` or `bilibili`.
   The renderer can then decide between iframe playback and local media playback without inferring from raw URLs.

3. Multimodal frame extraction is removed from the default task-completion path.
   VQA keeps transcript-only retrieval prewarm to preserve grounded QA without expanding VLM debt.

4. Study-pack generation is deterministic and must degrade cleanly.
   Without an LLM, the system still produces overview/highlights/themes/questions/quotes heuristically.

5. Translation is opt-in by decision logic.
   Platform translation track wins, LLM translation is only used when the user has configured a default target language and the platform has no matching translation track.

## Verification

The implementation must ship with:

- contract validation for study and knowledge payloads
- route-level tests for study workbench projections
- repository tests for SQLite-backed study entities
- orchestrator regression tests proving transcript-only Stage D behavior
- desktop type-safe integration for study, knowledge, and history screens
