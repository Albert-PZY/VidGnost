# Acceptance Criteria: Study Workbench Refactor

**Spec:** `docs/superpowers/specs/2026-04-20-study-workbench-design.md`
**Date:** 2026-04-20
**Status:** Approved

---

## Criteria

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-001 | URL task creation classifies supported remote study sources as `youtube` or `bilibili` | API | Backend is running | `POST /api/tasks/url` persists `source_type` as `youtube` or `bilibili` instead of collapsing all remote sources to one value |
| AC-002 | Study workbench payload can be read from a completed task without requiring VQA multimodal artifacts | API | Seeded task record with transcript and D-stage text artifacts | `GET /api/study/tasks/:taskId/workbench` returns overview, highlights, themes, questions, quotes, subtitle tracks, translation status, study state, and task summary fields |
| AC-003 | Subtitle-track resolution persists track metadata for remote tasks and Whisper track metadata for local tasks | Logic | Study repository available | Resolved subtitle-track records are persisted in SQLite with stable `task_id`, `track_id`, `kind`, and availability fields |
| AC-004 | Translation decision prefers platform translation tracks before LLM translation | Logic | Remote subtitle tracks include at least one translated track | Decision result is `platform_track` and does not request LLM translation |
| AC-005 | Translation decision stays disabled when no default target language is configured | Logic | No platform translation track and no UI default target language | Decision result is `disabled` |
| AC-006 | Stage D default task completion no longer executes frame extraction or frame semantic subtasks | Logic | Task orchestrator test harness | Completed notes or study-oriented task run does not publish `frame_extract`, `frame_semantic`, or `multimodal_index_fusion` subtasks |
| AC-007 | Transcript-only QA prewarm still persists retrieval index artifacts for VQA tasks | Logic | Completed VQA task run | Task artifacts include `D/vqa-prewarm/index.json` built from transcript evidence only |
| AC-008 | History list returns study preview metadata for learning-library rendering | API | Seeded study rows and task records | `GET /api/tasks` returns study preview fields such as readiness, generation tier, highlight count, question count, note count, favorite, and last opened time |
| AC-009 | Knowledge library exposes saved note cards across tasks | API | Seeded knowledge notes in SQLite | `GET /api/knowledge/notes` returns note cards with task linkage, source kind, timestamps, filters, and export metadata |
| AC-010 | Task-level note creation persists a knowledge note without breaking existing task artifacts | API | Existing task and SQLite study repo | `POST /api/knowledge/notes` returns persisted note id and later `GET /api/knowledge/notes` includes it |
| AC-011 | Study state updates persist continue-learning metadata | API | Existing task and study repo | `PATCH /api/tasks/:taskId/study-state` persists playback position, selected theme, active highlight, and favorite flag |
| AC-012 | Study export endpoints format study-pack assets and export records | API | Completed task with study pack | `POST /api/tasks/:taskId/exports` creates an export record and `GET /api/tasks/:taskId/exports` lists it with file path and type |
| AC-013 | Desktop task workbench defaults to `Study` mode and exposes `Study / QA / Flow / Trace / Knowledge` task modes | UI interaction | Desktop renderer running with a task | Opening a task shows the new mode strip and `Study` is selected by default |
| AC-014 | Desktop `Study` mode displays overview, highlights, themes, questions, subtitle tracks, and transcript linkage | UI interaction | Task has study-pack data | The workbench renders these sections and clicking a highlight or quote can seek the player/transcript |
| AC-015 | Desktop `Knowledge` library is available from the shell and lists saved notes across tasks | UI interaction | Desktop renderer running with notes in SQLite | Shell navigation includes `Knowledge` and the view lists saved note cards with filters |
| AC-016 | History view renders learning-library metrics instead of a bare task list | UI interaction | Desktop renderer running with study preview data | History cards show last learning time, readiness, highlight/question/note counts, favorite, and recent export metadata |
| AC-017 | OpenSpec files for ingestion, transcription, history/export, and web workbench are updated to reflect the study-first baseline | Logic | Repository docs present | Target OpenSpec files contain study-domain, subtitle-track, translation, knowledge, and transcript-only QA language aligned with the implementation |
