## ADDED Requirements

### Requirement: System SHALL persist task history in local files
System SHALL persist task metadata, source info, phase logs, transcript, notes, mindmap, and timestamps in local JSON files for later retrieval.

#### Scenario: Query task list
- **WHEN** client requests history endpoint
- **THEN** server returns paginated tasks ordered by latest update time

#### Scenario: Query task list with keyword
- **WHEN** client requests history endpoint with query keyword
- **THEN** server returns tasks filtered by title/source input match

#### Scenario: Query task detail
- **WHEN** client requests task detail by ID
- **THEN** server returns persisted phase logs and artifacts if available

#### Scenario: Reopen historical session
- **WHEN** user reopens a completed task after service restart
- **THEN** server returns persisted logs, notes, and mindmap for replay

### Requirement: Task history listing SHALL use incremental local index
Backend SHALL maintain `tasks/index.json` incrementally to accelerate history query and avoid full-record scans on every list request.

#### Scenario: List history with large local task set
- **WHEN** client requests history list
- **THEN** backend applies keyword filter and pagination on index entries first
- **AND** backend loads only paged records from `tasks/records/*.json`

### Requirement: Task runtime snapshots SHALL be persisted as per-stage files
Backend SHALL persist runtime analysis snapshots in per-stage files (`analysis-results/<task_id>/<stage>.json`) and SHALL NOT aggregate all phase snapshots into one monolithic JSON.

#### Scenario: Persist stage-level analysis snapshots
- **WHEN** phase `A/B/C/D` or stage-`D` substage status changes
- **THEN** backend writes corresponding snapshot file for that stage/substage key
- **AND** stage-level cleanup can target affected snapshots by prefix

### Requirement: Task deletion SHALL remove stage-artifact subtree
Deleting terminal task SHALL remove associated stage-artifact files to avoid orphaned local persistence.

#### Scenario: Delete terminal task with stage artifacts
- **WHEN** client deletes terminal task
- **THEN** backend removes task record, stage metrics, runtime warnings, and event logs
- **AND** backend removes `tasks/stage-artifacts/<task_id>/` and `tasks/analysis-results/<task_id>/` directories

### Requirement: Task detail SHALL include stage metrics and artifact index metadata
Task persistence SHALL include stage observability metrics and artifact index/size metadata for replay diagnostics and storage governance.

#### Scenario: Query task detail with observability metadata
- **WHEN** client requests task detail
- **THEN** response includes `stage_metrics` for `A/B/C/D` and `artifact_total_bytes`
- **AND** response includes `artifact_index` for generated deliverables

### Requirement: Frontend SHALL surface history operations in modal workflow
Frontend SHALL expose history browsing and keyword search through modal interactions triggered by sidebar actions.

#### Scenario: Search history in modal
- **WHEN** user opens history modal and submits keyword
- **THEN** frontend requests history API with keyword and renders filtered list

#### Scenario: Rename task title in modal
- **WHEN** user edits task title and confirms save
- **THEN** frontend calls title-update API and refreshes list/detail views

#### Scenario: Delete task in modal
- **WHEN** user confirms delete action for terminal task
- **THEN** frontend calls delete API and removes task from modal list

#### Scenario: Delete confirmation and feedback
- **WHEN** user clicks delete icon in history modal
- **THEN** frontend presents in-app confirmation modal and themed toast result

### Requirement: System SHALL support history title update and task deletion APIs
Backend SHALL provide explicit APIs to update task title and delete historical task.
Deletion SHALL reject non-terminal tasks to protect active pipeline execution.

#### Scenario: Update task title
- **WHEN** client calls title-update API with non-empty title
- **THEN** server persists title and returns updated summary payload

#### Scenario: Reject deleting running task
- **WHEN** client calls delete API for non-terminal task
- **THEN** server returns conflict response and keeps task record

#### Scenario: Delete completed task
- **WHEN** client calls delete API for completed/failed/cancelled task
- **THEN** server removes task record and returns no-content response

### Requirement: System SHALL support post-generation artifact markdown edits
Backend SHALL provide task-artifact update API for terminal tasks so frontend can persist adjusted notes/mindmap markdown before export.

#### Scenario: Update notes/mindmap markdown after completion
- **WHEN** client calls artifact update API for terminal task with edited markdown
- **THEN** server persists updated fields and returns latest task detail

#### Scenario: Reject artifact update for running task
- **WHEN** client calls artifact update API for non-terminal task
- **THEN** server returns conflict response and keeps artifacts unchanged

### Requirement: System SHALL provide artifact export endpoints
System SHALL provide export endpoints for transcript, notes, mindmap, and subtitles.
Subtitle generation SHALL be based on persisted `transcript_segments(start/end/text)`.

#### Scenario: Export SRT subtitle for completed task
- **WHEN** client requests `GET /tasks/{task_id}/export/srt` for completed task
- **THEN** server returns UTF-8 `SRT` generated from persisted transcript segments
- **AND** subtitle timestamps use `HH:MM:SS,mmm`

#### Scenario: Export VTT subtitle for completed task
- **WHEN** client requests `GET /tasks/{task_id}/export/vtt` for completed task
- **THEN** server returns UTF-8 `VTT` generated from persisted transcript segments
- **AND** subtitle timestamps use `HH:MM:SS.mmm`

#### Scenario: Normalize subtitle boundaries during export
- **WHEN** transcript segments contain overlap, non-positive duration, or empty text
- **THEN** export logic filters empty text items
- **AND** ensures each subtitle item has positive duration via minimum compensation
- **AND** clips overlaps to keep timeline monotonic

#### Scenario: Export markdown notes
- **WHEN** client requests markdown export for completed task
- **THEN** server returns generated markdown payload
- **AND** notes content includes detailed notes section

#### Scenario: Bundle export contains focused deliverables and subtitles
- **WHEN** client requests bundle export for completed task
- **THEN** archive includes `transcript.txt`, `notes.md`, `mindmap.md`, `mindmap.html`, `*.subtitles.srt`, and `*.subtitles.vtt`
- **AND** `notes.md` / `mindmap.md` use latest persisted values (including manual edits)

#### Scenario: Mindmap HTML export keeps white background
- **WHEN** client exports or bundles `mindmap.html`
- **THEN** exported HTML uses white background as default canvas theme
- **AND** rendered text remains readable in common desktop browsers
