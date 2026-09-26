## ADDED Requirements

### Requirement: Study domain SHALL remain a projection and persistence domain over existing task workflows
Status: `implemented`

The system SHALL expose `study-domain` as a task-scoped projection over persisted task records, normalized transcript artifacts, stage-`D` study artifacts, and study-specific SQLite state. It SHALL NOT introduce a third workflow beyond the existing `notes` and `vqa` workflows.

#### Scenario: Build study workspace for a notes task
- **WHEN** backend materializes study data for a `notes` task
- **THEN** it keeps `workflow=notes` on the task contract
- **AND** it derives `study_preview`、`study_pack`、subtitle-track metadata、translation records、study state、and export records from the same persisted task id
- **AND** it does not create a separate `study` workflow type

#### Scenario: Build study workspace for a VQA task
- **WHEN** backend materializes study data for a `vqa` task
- **THEN** it keeps `workflow=vqa` on the task contract
- **AND** the same task id remains the owner of study-pack artifacts and transcript-only QA prewarm artifacts
- **AND** study-domain projection does not replace the VQA workflow boundary

### Requirement: Study domain SHALL persist structured study data in SQLite and mirror portable artifacts under task storage
Status: `implemented`

Backend SHALL persist study-domain structured state in `storage/study/study.sqlite` and SHALL mirror portable JSON artifacts under `storage/tasks/stage-artifacts/<task_id>/D/study/` for replay, export, and compatibility reads.

#### Scenario: Persist study-domain state
- **WHEN** backend materializes or updates study data for a task
- **THEN** it stores task-scoped rows in logical study-domain tables for `study_packs`、`study_state`、`subtitle_tracks`、`translation_records`、and `export_records`
- **AND** it stores note-scoped rows in `knowledge_notes`
- **AND** `knowledge_notes` uses `note_id` as the primary key while the other study-domain tables use `task_id`

#### Scenario: Mirror study-domain artifacts under task storage
- **WHEN** study-domain state is materialized
- **THEN** backend writes portable artifacts such as `D/study/workspace.json`、`D/study/preview.json`、`D/study/study-pack.json`、`D/study/subtitle-tracks.json`、`D/study/translation-records.json`、and `D/study/export-records.json`
- **AND** translated subtitle-track payloads MAY also be persisted under `D/study/translations/<target_language>/subtitle-track.json`
- **AND** these task-local artifacts stay attributable to the same task id as the SQLite records

#### Scenario: Read task history before study artifacts exist
- **WHEN** task list or task detail is requested for an older task that has no persisted `D/study/preview.json`
- **THEN** backend falls back to transcript-derived heuristic `study_preview`
- **AND** the absence of study SQLite rows does not block history or task-detail reads

### Requirement: Study and Knowledge API family SHALL expose task-scoped study resources without defining a new workflow
Status: `implemented`

Backend SHALL expose task-scoped Study APIs and workspace-level Knowledge APIs under the existing HTTP API surface.

#### Scenario: Read study workbench resources
- **WHEN** client requests `GET /api/tasks/:taskId/study-preview`
- **THEN** backend returns the normalized `StudyPreview`
- **AND** the preview can be derived from persisted study-domain records or transcript-first fallback logic

#### Scenario: Read full study workspace
- **WHEN** client requests `GET /api/tasks/:taskId/study-pack`
- **THEN** backend returns `StudyWorkbenchResponse`
- **AND** the payload contains `task`、`preview`、`study_pack`、`subtitle_tracks`、`translation_records`、`study_state`、and `export_records`

#### Scenario: Manage task-scoped study state and subtitle selection
- **WHEN** client requests `GET /api/tasks/:taskId/subtitle-tracks`、`POST /api/tasks/:taskId/subtitle-switch`、or `PATCH /api/tasks/:taskId/study-state`
- **THEN** backend resolves the task-scoped study workspace without redefining task ownership
- **AND** `PATCH /study-state` supports partial updates for playback position、selected theme、active highlight、favorite state、selected subtitle track、and last-opened timestamp
- **AND** backend rejects an empty study-state patch with `code=STUDY_STATE_PATCH_EMPTY`

#### Scenario: Manage knowledge notes through study-domain APIs
- **WHEN** client requests `GET /api/knowledge/notes`、`POST /api/knowledge/notes`、`PATCH /api/knowledge/notes/:noteId`、or `DELETE /api/knowledge/notes/:noteId`
- **THEN** backend returns or mutates task-attributed study notes without requiring a dedicated knowledge workflow
- **AND** backend rejects an empty or unknown note id with `code=KNOWLEDGE_NOTE_ID_INVALID` or `code=KNOWLEDGE_NOTE_NOT_FOUND` as appropriate

### Requirement: Study domain SHALL model subtitle tracks and translation records on a transcript-first baseline
Status: `partial`

Study-domain contracts SHALL expose subtitle-track candidates and translation decisions for playback, export, and continue-learning surfaces while keeping the current transcript-first pipeline baseline intact.

#### Scenario: Materialize subtitle tracks for online and local tasks
- **WHEN** backend builds subtitle-track metadata
- **THEN** `SubtitleTrack.kind` is one of `source`、`platform_translation`、`whisper`、or `llm_translation`
- **AND** `SubtitleTrack.availability` is one of `available`、`generated`、`missing`、or `failed`
- **AND** online `youtube` tasks may probe platform subtitle metadata through `yt-dlp`, while online `bilibili` tasks may reuse `source=bilibili-auth` subtitle metadata written by phase `C`
- **AND** when phase `C` can normalize a usable platform subtitle track, study-domain consumes that same task transcript state instead of forcing a second Whisper transcript source
- **AND** local tasks still expose a `source` track placeholder together with a Whisper track on the study-domain surface

#### Scenario: Resolve preferred study subtitle track
- **WHEN** backend materializes the study workspace
- **THEN** it prefers the persisted selected track when that track id is still available
- **AND** otherwise it prefers the translation decision's preferred track
- **AND** otherwise it falls back to the subtitle bundle default track or the first available study-domain track

#### Scenario: Apply translation gating and source priority
- **WHEN** backend resolves translation records
- **THEN** `TranslationRecord.source` is one of `disabled`、`original`、`platform_track`、or `llm_generated`
- **AND** `TranslationRecord.status` is one of `disabled`、`pending`、`ready`、or `failed`
- **AND** if no preferred target language is configured, backend persists a disabled translation record instead of blocking the study workflow
- **AND** if the preferred language matches the available source track language, backend records `source=original`
- **AND** if a matching platform translation track exists, backend records `source=platform_track`
- **AND** only when the preferred target language exists and no usable platform translation track is available MAY backend generate or reuse an `llm_translation` subtitle track

#### Scenario: Keep subtitle-track metadata aligned with the main transcript source
- **WHEN** study-domain materializes subtitle tracks and translation records on the current baseline
- **THEN** study-pack generation still derives from normalized transcript artifacts produced by the main pipeline
- **AND** for online `youtube` tasks, those phase-`C` transcript artifacts MAY originate from `yt-dlp` platform subtitles before Whisper fallback is considered
- **AND** for online `bilibili` tasks, those phase-`C` transcript artifacts MAY originate from logged-in Bilibili AI subtitles before Whisper fallback is considered
- **AND** when platform subtitles are unavailable, study-domain continues to consume the fallback Whisper transcript artifacts without changing downstream study contracts

### Requirement: Study state SHALL capture continue-learning state per task
Status: `implemented`

Study-domain state SHALL persist task-scoped continue-learning information in a normalized `StudyState` contract.

#### Scenario: Persist continue-learning cursor
- **WHEN** client updates task study state
- **THEN** backend persists `playback_position_seconds`、`selected_theme_id`、`active_highlight_id`、`last_selected_subtitle_track_id`、`is_favorite`、and `last_opened_at`
- **AND** values remain task-scoped instead of global across the workspace

#### Scenario: Normalize selected subtitle track during state update
- **WHEN** client patches `last_selected_subtitle_track_id`
- **THEN** backend accepts the track id only if it still exists in the current study workspace
- **AND** otherwise backend normalizes the persisted selected track to `null`

### Requirement: Knowledge notes SHALL persist task-attributed study assets
Status: `implemented`

Study-domain knowledge notes SHALL persist excerpts and note text that remain attributable to a task, source type, source kind, optional study theme, and optional time/reference context.

#### Scenario: Create a knowledge note
- **WHEN** client posts a knowledge note
- **THEN** backend persists `task_id`、`study_theme_id`、`source_type`、`source_kind`、`title`、`excerpt`、`note_markdown`、`source_start_seconds`、`source_end_seconds`、`source_reference_id`、`source_reference_label`、`tags`、`created_at`、and `updated_at`
- **AND** `source_kind` is restricted to `transcript`、`qa_answer`、`summary`、`highlight`、`quote`、or `manual`
- **AND** timestamp or reference context remains nullable so manually created notes can still be stored without fabricating transcript offsets

#### Scenario: Filter knowledge library
- **WHEN** client requests `GET /api/knowledge/notes`
- **THEN** backend supports filtering by `task_id`、`source_type`、`source_kind`、`study_theme_id`、and `tag`
- **AND** the response returns `items`、`total`、`filters`、and task-scoped `export_records` for `knowledge_notes` when `task_id` is present

### Requirement: Study-domain exports SHALL persist export records and remain compatible with task export routes
Status: `implemented`

Study-domain export operations SHALL persist task-scoped export records while staying compatible with the existing task export family.

#### Scenario: Create study-domain export records
- **WHEN** client requests `POST /api/tasks/:taskId/exports`
- **THEN** backend formats one of `study_pack`、`subtitle_tracks`、`translation_records`、or `knowledge_notes`
- **AND** backend writes the formatted payload under `D/study/exports/<timestamp>-<export_kind>.<ext>`
- **AND** backend persists an `ExportRecord` with `id`、`task_id`、`export_kind`、`format`、`file_path`、and `created_at`

#### Scenario: List study-domain export records
- **WHEN** client requests `GET /api/tasks/:taskId/exports`
- **THEN** backend returns export records ordered by `created_at` descending from the study SQLite store

#### Scenario: Download study-domain exports through the compatibility task export route
- **WHEN** client requests `GET /api/tasks/:taskId/export/:kind` with `kind=study_pack|subtitle_tracks|translation_records|knowledge_notes`
- **THEN** backend routes the request through study-domain formatting logic
- **AND** the compatibility download route remains gated to completed tasks on the current baseline

### Requirement: Study pack generation and transcript-only QA SHALL stay aligned on the same transcript-first baseline
Status: `implemented`

Study-domain workspace generation SHALL stay transcript-first, and VQA preparation SHALL remain transcript-only on the same task boundary.

#### Scenario: Generate study pack from normalized transcript
- **WHEN** backend materializes a study workspace
- **THEN** it derives `overview`、`highlights`、`themes`、`questions`、and `quotes` from normalized transcript text or transcript segments
- **AND** `StudyPack.generation_tier` and `StudyPack.readiness` reflect the current transcript-derived or degraded readiness state

#### Scenario: Prepare transcript-only QA for VQA workflow
- **WHEN** phase `D` runs for a `vqa` task
- **THEN** backend executes `transcript_vectorize` and `vqa_prewarm` after `study_pack_generate`
- **AND** backend persists transcript-only QA prewarm artifacts under `D/vqa-prewarm/`
- **AND** image-evidence fields remain compatibility-only for legacy tasks instead of redefining the study-first QA baseline

#### Scenario: Skip transcript-only QA preparation for notes workflow
- **WHEN** phase `D` runs for a `notes` task
- **THEN** backend still materializes the study workspace and study-domain persistence
- **AND** transcript-only QA preparation substages are marked as skipped rather than promoting a multimodal prerequisite
