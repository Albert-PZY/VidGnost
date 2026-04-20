## ADDED Requirements

### Requirement: System SHALL persist study history and learning-library metadata
Status: `partial`

Backend SHALL persist task metadata, source info, transcript, study artifacts, subtitle selection, translation state, and export metadata for replay retrieval and continue-learning surfaces.

#### Scenario: Query task list
- **WHEN** client requests task listing endpoint
- **THEN** backend returns tasks ordered by latest update time with total count
- **AND** each task summary carries `duration_seconds` when persisted transcript segments or source media metadata can provide a reliable duration
- **AND** each task summary MAY include study-pack readiness, knowledge-note count, recent export timestamp, and continue-learning metadata when those fields are already persisted

#### Scenario: Query task detail
- **WHEN** client requests task detail by ID
- **THEN** backend returns persisted logs, artifacts, metrics, transcript outputs, and artifact index metadata
- **AND** task-detail markdown keeps only task-relative image references whose artifact files still exist on disk
- **AND** stale task-relative image references are removed before the renderer receives the payload so the client does not request missing artifact files
- **AND** transcript timestamp and transcript text citations remain the primary evidence contract for QA replay
- **AND** compatibility-only evidence fields such as `image_path` and `visual_text` MAY still appear for legacy tasks without redefining the default study-first evidence path
- **AND** when phase `D` has persisted transcript-only QA prewarm artifacts, task detail payloads can expose `D/vqa-prewarm/index.json` through the existing artifact index and file routes
- **AND** when phase `C` has finished transcript normalization, task detail file routes can expose `C/transcript/index.json` and `C/transcript/chunks/*.json` for transcript replay surfaces
- **AND** subtitle-track artifacts, translation outputs, and study-pack artifacts MAY be exposed through the same artifact index when they exist

#### Scenario: Read persisted task history without an upfront storage migration
- **WHEN** the frontend-driven TypeScript backend queries local task history during the refactor transition
- **THEN** it can read compatible task records directly from `storage/tasks/records/*.json`
- **AND** the same persisted record payload can hydrate list、stats、recent、detail responses without requiring an immediate one-time migration step
- **AND** study-first metadata that is still absent in older task records falls back to empty or compatibility defaults instead of blocking history reads

#### Scenario: Read persisted task media and study artifacts through backend file routes
- **WHEN** client requests `GET /tasks/{task_id}/source-media` or `GET /tasks/{task_id}/artifacts/file`
- **THEN** backend resolves the task-scoped local file under persisted storage and streams it through the HTTP API
- **AND** renderer does not need direct `file://` access to source media or generated study artifacts

### Requirement: Runtime snapshots SHALL be persisted by stage
Status: `implemented`
Backend SHALL persist per-stage analysis snapshots under `analysis-results/<task_id>/<stage>.json`.

#### Scenario: Stage status changes
- **WHEN** phase `A/B/C/D` or stage-D substage state changes
- **THEN** backend updates corresponding stage snapshot files

### Requirement: History operations SHALL support title update and task deletion
Status: `implemented`
Backend SHALL allow title update for any persisted task and SHALL allow task deletion regardless of the current task status.

#### Scenario: Update history title
- **WHEN** client submits non-empty title to title-update API
- **THEN** backend persists title and returns updated summary

#### Scenario: Delete task at any status
- **WHEN** client deletes a persisted task in any status
- **THEN** backend cancels any active execution owned by that task and waits for task-owned writes to settle before removal
- **THEN** backend removes task record and related persisted artifacts
- **AND** backend removes the task-scoped temporary workspace under `temp_dir/<task_id>`
- **AND** backend removes uploaded shadow source files owned by the task under `upload_dir/<task_id>_*`
- **AND** backend removes uploaded task directories owned by the task under `upload_dir/<task_id>-*`
- **AND** backend removes task-scoped VQA trace files under `event_log_dir/traces/*.jsonl` when the trace payload references the deleted `task_id`

#### Scenario: Delete task from history view and refresh recent tasks
- **WHEN** user deletes a task from the renderer history view
- **THEN** the history list removes that task immediately after the delete request succeeds
- **AND** the application shell refreshes the recent-task summary so deleted tasks no longer remain in the sidebar

#### Scenario: Delete multiple tasks from the current history page
- **WHEN** user enters multi-select mode in the renderer history view
- **THEN** the current page exposes per-row selection toggles together with `全选本页` and `删除所选`
- **AND** any task shown on the current page is selectable for batch deletion
- **AND** after batch deletion succeeds, the history list refreshes, the recent-task summary no longer shows deleted tasks, and pagination stays within the new valid page range

### Requirement: Artifact markdown edits SHALL be supported after terminal status
Status: `implemented`
Backend SHALL allow notes/mindmap markdown update only after task reaches terminal state.

#### Scenario: Persist edited notes and mindmap
- **WHEN** client updates artifacts for terminal task
- **THEN** backend saves markdown and returns refreshed task detail

#### Scenario: Reject edit for running task
- **WHEN** client updates artifacts for non-terminal task
- **THEN** backend returns conflict and does not mutate artifacts

### Requirement: Export endpoints SHALL provide deterministic study deliverables
Status: `partial`

System SHALL support transcript, subtitle, notes, mindmap, knowledge-note, study-pack, and bundle exports for completed tasks or persisted study materials as appropriate.

#### Scenario: Export transcript and notes
- **WHEN** client calls transcript/notes export APIs on completed task
- **THEN** backend returns UTF-8 payload with deterministic filename headers
- **AND** `notes` export returns a `.md` file when the task has no generated note-image assets
- **AND** `notes` export returns an archive containing the Markdown file plus `notes-images/**` assets when the task has generated note-image attachments

#### Scenario: Export subtitles and optional translation outputs
- **WHEN** client requests subtitle-related exports such as `srt` or `vtt`
- **THEN** backend generates subtitles from the persisted transcript or selected subtitle-track output
- **AND** backend normalizes timeline ordering and minimum segment duration
- **AND** when the task already contains a persisted translated subtitle layer, export endpoints MAY expose that translated output as an additional deterministic deliverable

#### Scenario: Export study pack or knowledge materials
- **WHEN** client requests a study-pack, knowledge-note bundle, or task bundle export
- **THEN** backend packages the persisted study artifacts that exist for that task
- **AND** transcript, overview, highlights, themes, questions, notes, and export metadata keep stable relative paths inside the package

#### Scenario: Show success confirmation after workbench export
- **WHEN** user exports `notes`, `study pack`, or `bundle` from the workbench and the renderer finishes downloading the response payload
- **THEN** the renderer shows a non-blocking success toast confirming the export has completed and the file download has started

### Requirement: Bundle export SHALL include notes image assets
Status: `implemented`
Bundle export SHALL include markdown artifacts and PNG image assets referenced from notes markdown.

#### Scenario: Bundle includes notes-images
- **WHEN** completed task contains rendered note images under `D/fusion/notes-images`
- **THEN** exported bundle includes `notes-images/**/*.png`
- **AND** `notes.md` keeps relative image paths consistent with bundle layout

### Requirement: Mindmap HTML export SHALL remain desktop-readable
Status: `implemented`
Mindmap HTML export SHALL use a white default canvas background for consistent readability.

#### Scenario: Export mindmap html
- **WHEN** client requests mindmap HTML export or bundle
- **THEN** generated HTML uses readable default text/background contrast in common desktop browsers

### Requirement: Learning-library list SHALL support composable filters and pagination
Status: `partial`

History view SHALL evolve toward a learning-library surface that supports `workflow`, `status`, `query`, and `sort` filters together with paginated retrieval so long-lived desktop sessions can locate tasks and learning materials without rendering the entire archive at once.

#### Scenario: Filter failed VQA tasks
- **WHEN** client requests task list with `workflow=vqa`, `status=failed`, and a search query
- **THEN** backend returns only matching tasks together with `total`
- **AND** frontend can page through the result set using `limit` and `offset`

#### Scenario: Navigate history pages
- **WHEN** user moves between history pages in the renderer
- **THEN** the renderer requests the next page from the backend instead of keeping an unbounded in-memory task list

#### Scenario: Open history view after the shell is already interactive
- **WHEN** user navigates from another shell section into `历史记录`
- **THEN** the shell keeps the title bar and sidebar interactive while the history module loads
- **AND** the content region MAY show a compact in-place loading placeholder before the first history payload renders
- **AND** the renderer does not block the entire shell behind a full-window loading mask for this view switch

#### Scenario: Query recent-task sidebar summary
- **WHEN** client requests the recent-task summary endpoint
- **THEN** backend returns recent tasks ordered by latest update time
- **AND** each recent-task item includes `workflow`, `updated_at`, and `duration_seconds` so the sidebar can render compact status context
- **AND** each recent-task item MAY also include continue-learning context such as study-pack readiness or knowledge-note count when available

### Requirement: History actions SHALL expose bundle export and task directory access
Status: `implemented`
History view SHALL expose direct task bundle export and task-directory access for each listed task.

#### Scenario: Open task directory from history view
- **WHEN** user invokes the open-location action for a task
- **THEN** backend returns the persisted task directory path
- **AND** Electron MAY open that path directly through the preload bridge

#### Scenario: Export completed task from history view
- **WHEN** user invokes bundle export for a completed task
- **THEN** frontend downloads the deterministic artifact bundle using the same export endpoint family as the processing workbench
- **AND** the renderer shows a non-blocking success toast after the response payload is prepared for download
