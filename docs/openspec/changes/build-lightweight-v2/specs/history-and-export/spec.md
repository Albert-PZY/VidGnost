## ADDED Requirements

### Requirement: System SHALL persist task history in local files
The system SHALL persist task metadata, source information, stage logs, transcript, summary, mindmap, and timestamps in local JSON files for later retrieval.

#### Scenario: Query task list
- **WHEN** client requests history endpoint
- **THEN** server returns paginated tasks ordered by latest update time

#### Scenario: Query task list with search keyword
- **WHEN** client requests history endpoint with query keyword
- **THEN** server returns tasks filtered by title/source input that match the keyword

#### Scenario: Query task detail
- **WHEN** client requests a task ID
- **THEN** server returns full task detail including persisted stage logs and artifacts if available

#### Scenario: Reopen historical session
- **WHEN** user reopens a completed task after service restart
- **THEN** server returns previously persisted logs, summary, and mindmap for session-style replay

### Requirement: Task runtime snapshots SHALL be persisted as per-stage files
The backend SHALL persist runtime analysis snapshots in per-stage files (`analysis-results/<task_id>/<stage>.json`) and SHALL NOT aggregate all stage snapshots into one monolithic task-level JSON.

#### Scenario: Persist stage-level analysis snapshots
- **WHEN** stage `A/B/C/D` or stage-`D` substage status changes
- **THEN** backend writes/updates corresponding stage snapshot file for that stage/substage key
- **AND** stage-level cleanup can remove only affected stage files by prefix without touching other stage snapshots

### Requirement: Task deletion SHALL remove stage-artifact subtree
Deleting a terminal task SHALL remove associated stage-artifact files to avoid orphaned local persistence data.

#### Scenario: Delete terminal task with stage artifacts
- **WHEN** client deletes a terminal task
- **THEN** backend removes task record, stage metrics, runtime warnings, event logs
- **AND** backend removes `tasks/stage-artifacts/<task_id>/` and `tasks/analysis-results/<task_id>/` directories

### Requirement: Task detail SHALL include stage metrics and artifact index metadata
Task persistence SHALL include stage-level observability metrics and artifact index/size metadata for replay diagnostics and storage governance.

#### Scenario: Query task detail with observability metadata
- **WHEN** client requests task detail
- **THEN** response includes `stage_metrics` per stage (`A/B/C/D`) and `artifact_total_bytes`
- **AND** response includes `artifact_index` entries for generated deliverables

### Requirement: Frontend SHALL surface history operations in modal workflow
The frontend SHALL expose history browsing and keyword search through modal interactions triggered by sidebar actions, while keeping history retrieval logic backed by the same history APIs.

#### Scenario: Search history in modal
- **WHEN** user opens history modal and submits a keyword
- **THEN** frontend requests history API with that keyword and renders filtered tasks in the modal list

#### Scenario: Rename task title in modal
- **WHEN** user edits a task title and confirms save in history modal
- **THEN** frontend calls history title update API and reflects the latest title in list and detail views

#### Scenario: Delete task in modal
- **WHEN** user confirms delete action for a terminal task in history modal
- **THEN** frontend calls history delete API and removes the task from history list

#### Scenario: Delete confirmation and result feedback
- **WHEN** user clicks delete icon in history modal
- **THEN** frontend presents an in-app confirmation modal and uses themed toast notifications to report action result

### Requirement: System SHALL support history title update and task deletion APIs
The backend SHALL provide explicit APIs to update a task title and delete a historical task.
Deletion SHALL reject non-terminal tasks to avoid deleting records currently in active pipeline execution.

#### Scenario: Update task title
- **WHEN** client calls title update API with non-empty title
- **THEN** server persists updated title and returns updated task summary payload

#### Scenario: Reject deleting running task
- **WHEN** client calls delete API for task in non-terminal status
- **THEN** server returns conflict response and keeps task record unchanged

#### Scenario: Delete completed task
- **WHEN** client calls delete API for completed/failed task
- **THEN** server removes task record and returns no-content response

### Requirement: System SHALL support post-generation artifact markdown edits
The backend SHALL provide task-artifact update API for terminal tasks so frontend can persist manually adjusted notes/mindmap markdown before export.

#### Scenario: Update notes/mindmap markdown after task completion
- **WHEN** client calls artifact update API for a completed task with edited notes/mindmap markdown
- **THEN** server persists updated markdown fields and returns latest task detail payload

#### Scenario: Reject artifact update for running task
- **WHEN** client calls artifact update API for a non-terminal task
- **THEN** server returns conflict response and keeps persisted artifacts unchanged

### Requirement: System SHALL provide artifact export endpoints
The system SHALL provide export endpoints for transcript, summary/notes, mindmap, and subtitles.
Subtitle generation SHALL be based on persisted `transcript_segments(start/end/text)` and SHALL NOT depend on a specific ASR engine implementation.

#### Scenario: Export SRT subtitle for completed task
- **WHEN** client requests `GET /tasks/{task_id}/export/srt` for a completed task
- **THEN** server returns UTF-8 `SRT` payload generated from persisted transcript segments
- **AND** subtitle timestamps use `HH:MM:SS,mmm`

#### Scenario: Export VTT subtitle for completed task
- **WHEN** client requests `GET /tasks/{task_id}/export/vtt` for a completed task
- **THEN** server returns UTF-8 `VTT` payload generated from persisted transcript segments
- **AND** subtitle timestamps use `HH:MM:SS.mmm`

#### Scenario: Normalize subtitle boundaries during export
- **WHEN** transcript segments contain overlap, non-positive duration, or empty text items
- **THEN** export logic filters empty text segments
- **AND** ensures each subtitle item has positive duration via minimum-duration compensation
- **AND** clips overlapping boundaries to keep timeline monotonic

#### Scenario: Export markdown notes
- **WHEN** client requests markdown export for a completed task
- **THEN** server returns generated markdown file payload
- **AND** notes content includes detailed notes section only
- **AND** notes content excludes full transcript section

#### Scenario: Bundle export contains focused deliverables and subtitles
- **WHEN** client requests bundle export for a completed task
- **THEN** archive includes `transcript.txt`, `notes.md`, `mindmap.md`, `mindmap.html`, `*.subtitles.srt`, and `*.subtitles.vtt`
- **AND** archive excludes `summary.md`, `stage-logs.json`, and `meta.json`
- **AND** `notes.md` / `mindmap.md` content uses latest persisted values (including post-generation manual edits)

#### Scenario: Mindmap HTML export keeps white background for readability
- **WHEN** client exports or bundles `mindmap.html`
- **THEN** exported HTML uses white background as default canvas theme
- **AND** rendered text remains readable in common desktop browsers
