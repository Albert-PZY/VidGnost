## ADDED Requirements

### Requirement: System SHALL persist task history in local files
Backend SHALL persist task metadata, source info, phase logs, transcript, notes, mindmap, and timestamps for replay retrieval.

#### Scenario: Query task list
- **WHEN** client requests task listing endpoint
- **THEN** backend returns tasks ordered by latest update time with total count
- **AND** each task summary carries `duration_seconds` when persisted transcript segments or source media metadata can provide a reliable duration

#### Scenario: Query task detail
- **WHEN** client requests task detail by ID
- **THEN** backend returns persisted logs, artifacts, metrics, and artifact index metadata
- **AND** task-detail markdown keeps only task-relative image references whose artifact files still exist on disk
- **AND** stale task-relative image references are removed before the renderer receives the payload so the client does not request missing artifact files
- **AND** VQA-related detail payloads in the current baseline keep transcript timestamp/text citations and MAY include frame-semantic citation fields such as `image_path` and `visual_text` when retrieval hits originate from VLM keyframe evidence
- **AND** when phase `D` has persisted VQA prewarm artifacts, task detail payloads can expose `D/vqa-prewarm/frames.json` and `D/vqa-prewarm/index.json` through the existing artifact index and file routes

#### Scenario: Read persisted task history without an upfront storage migration
- **WHEN** the frontend-driven TypeScript backend queries local task history during the refactor transition
- **THEN** it can read compatible task records directly from `storage/tasks/records/*.json`
- **AND** the same persisted record payload can hydrate list、stats、recent、detail responses without requiring an immediate one-time migration step

#### Scenario: Read persisted task media and fusion artifacts through backend file routes
- **WHEN** client requests `GET /tasks/{task_id}/source-media` or `GET /tasks/{task_id}/artifacts/file`
- **THEN** backend resolves the task-scoped local file under persisted storage and streams it through the HTTP API
- **AND** renderer does not need direct `file://` access to source media or generated fusion artifacts

### Requirement: Runtime snapshots SHALL be persisted by stage
Backend SHALL persist per-stage analysis snapshots under `analysis-results/<task_id>/<stage>.json`.

#### Scenario: Stage status changes
- **WHEN** phase `A/B/C/D` or stage-D substage state changes
- **THEN** backend updates corresponding stage snapshot files

### Requirement: History operations SHALL support title update and task deletion
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
Backend SHALL allow notes/mindmap markdown update only after task reaches terminal state.

#### Scenario: Persist edited notes and mindmap
- **WHEN** client updates artifacts for terminal task
- **THEN** backend saves markdown and returns refreshed task detail

#### Scenario: Reject edit for running task
- **WHEN** client updates artifacts for non-terminal task
- **THEN** backend returns conflict and does not mutate artifacts

### Requirement: Export endpoints SHALL provide deterministic deliverables
System SHALL support transcript, notes, mindmap, subtitle, and bundle exports for completed tasks.

#### Scenario: Export transcript and notes
- **WHEN** client calls transcript/notes export APIs on completed task
- **THEN** backend returns UTF-8 payload with deterministic filename headers
- **AND** `notes` export returns a `.md` file when the task has no generated note-image assets
- **AND** `notes` export returns an archive containing the Markdown file plus `notes-images/**` assets when the task has generated note-image attachments

#### Scenario: Show success confirmation after workbench notes or bundle export
- **WHEN** user exports `notes` or `bundle` from the processing workbench and the renderer finishes downloading the response payload
- **THEN** the renderer shows a non-blocking success toast confirming the export has completed and the file download has started

#### Scenario: Export subtitles
- **WHEN** client requests `srt` or `vtt`
- **THEN** backend generates subtitles from persisted transcript segments
- **AND** backend normalizes timeline ordering and minimum segment duration

### Requirement: Bundle export SHALL include notes image assets
Bundle export SHALL include markdown artifacts and PNG image assets referenced from notes markdown.

#### Scenario: Bundle includes notes-images
- **WHEN** completed task contains rendered note images under `D/fusion/notes-images`
- **THEN** exported bundle includes `notes-images/**/*.png`
- **AND** `notes.md` keeps relative image paths consistent with bundle layout

### Requirement: Mindmap HTML export SHALL remain desktop-readable
Mindmap HTML export SHALL use a white default canvas background for consistent readability.

#### Scenario: Export mindmap html
- **WHEN** client requests mindmap HTML export or bundle
- **THEN** generated HTML uses readable default text/background contrast in common desktop browsers

### Requirement: History list SHALL support composable filters and pagination
History view SHALL support `workflow`, `status`, `query`, and `sort` filters together with paginated list retrieval so long-lived desktop sessions can locate tasks without rendering the entire archive at once.

#### Scenario: Filter failed VQA tasks
- **WHEN** client requests task list with `workflow=vqa`, `status=failed`, and a search query
- **THEN** backend returns only matching tasks together with `total`
- **AND** frontend can page through the result set using `limit` and `offset`

#### Scenario: Navigate history pages
- **WHEN** user moves between history pages in the renderer
- **THEN** the renderer requests the next page from the backend instead of keeping an unbounded in-memory task list

#### Scenario: Query recent-task sidebar summary
- **WHEN** client requests the recent-task summary endpoint
- **THEN** backend returns recent tasks ordered by latest update time
- **AND** each recent-task item includes `workflow`, `updated_at`, and `duration_seconds` so the sidebar can render compact status context

### Requirement: History actions SHALL expose bundle export and task directory access
History view SHALL expose direct task bundle export and task-directory access for each listed task.

#### Scenario: Open task directory from history view
- **WHEN** user invokes the open-location action for a task
- **THEN** backend returns the persisted task directory path
- **AND** Electron MAY open that path directly through the preload bridge

#### Scenario: Export completed task from history view
- **WHEN** user invokes bundle export for a completed task
- **THEN** frontend downloads the deterministic artifact bundle using the same export endpoint family as the processing workbench
- **AND** the renderer shows a non-blocking success toast after the response payload is prepared for download
