## ADDED Requirements

### Requirement: System SHALL persist task history in local files
Backend SHALL persist task metadata, source info, phase logs, transcript, notes, mindmap, and timestamps for replay retrieval.

#### Scenario: Query task list
- **WHEN** client requests task listing endpoint
- **THEN** backend returns tasks ordered by latest update time with total count

#### Scenario: Query task detail
- **WHEN** client requests task detail by ID
- **THEN** backend returns persisted logs, artifacts, metrics, and artifact index metadata

### Requirement: Runtime snapshots SHALL be persisted by stage
Backend SHALL persist per-stage analysis snapshots under `analysis-results/<task_id>/<stage>.json`.

#### Scenario: Stage status changes
- **WHEN** phase `A/B/C/D` or stage-D substage state changes
- **THEN** backend updates corresponding stage snapshot files

### Requirement: History operations SHALL support title update and terminal delete
Backend SHALL allow title update and task deletion only for terminal tasks.

#### Scenario: Update history title
- **WHEN** client submits non-empty title to title-update API
- **THEN** backend persists title and returns updated summary

#### Scenario: Reject delete for running task
- **WHEN** client attempts to delete a non-terminal task
- **THEN** backend returns conflict and keeps task record unchanged

#### Scenario: Delete terminal task
- **WHEN** client deletes completed/failed/cancelled task
- **THEN** backend removes task record and related persisted artifacts

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
