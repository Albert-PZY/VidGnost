## ADDED Requirements

### Requirement: UI SHALL provide bilingual minimalist workbench with theme switching
The frontend SHALL provide Simplified Chinese and English locales, plus light/dark themes with accessibility-friendly contrast.

#### Scenario: Switch locale and persist preference
- **WHEN** user switches locale in header and refreshes page
- **THEN** UI keeps selected locale and renders translated labels consistently

#### Scenario: Toggle theme
- **WHEN** user toggles theme control
- **THEN** workbench surfaces update via theme tokens without readability regression

### Requirement: UI SHALL support full input-to-result workflow
The workbench SHALL support `URL / local path / upload` task creation and show end-to-end analysis outputs.

#### Scenario: Submit task from source modal
- **WHEN** user submits a valid source
- **THEN** frontend creates task and enters runtime monitoring state

### Requirement: UI SHALL reflect task status and progress in realtime via SSE
The workbench SHALL update active task status/progress/logs continuously from SSE events.

#### Scenario: Active task is running
- **WHEN** backend emits stage/progress/log events
- **THEN** frontend updates runtime status and progress without waiting for manual refresh

### Requirement: UI SHALL provide task cancellation control
Runtime panel SHALL provide stop action for non-terminal tasks and reflect terminal cancellation state.

#### Scenario: Cancel active task
- **WHEN** user clicks stop and backend emits `task_cancelled`
- **THEN** UI updates task state to `cancelled` and stops running indicator

### Requirement: UI SHALL display VNC-style stage tabs aligned with runtime substage model
Runtime area SHALL display tabs `A`, `B`, `C`, `transcript_optimize`, `D` and auto-switch according to incoming stage events.

#### Scenario: Backend enters substage `transcript_optimize`
- **WHEN** stage event indicates `transcript_optimize`
- **THEN** UI highlights corresponding tab and displays related logs/metrics

### Requirement: UI SHALL stream stage C transcript output
Stage `C` panel SHALL render incremental transcript stream and keep latest output visible.

#### Scenario: Receive transcript delta events
- **WHEN** backend emits transcript deltas
- **THEN** transcript panel appends text incrementally and keeps bottom-follow behavior

### Requirement: UI SHALL render stage D dual-pane editing and preview
Stage `D` SHALL render notes and mindmap in source+preview split panes; source panes become editable after task reaches terminal state.

#### Scenario: Task still running stage D
- **WHEN** task status is non-terminal
- **THEN** notes/mindmap source editors are read-only

#### Scenario: Task finished
- **WHEN** task status becomes `completed|failed|cancelled`
- **THEN** notes/mindmap source editors become editable for manual adjustments

### Requirement: Runtime config modal SHALL provide three tabs
Config modal SHALL provide `在线 LLM`, `Faster-Whisper`, and `Prompt Templates` tabs.

#### Scenario: Open config modal
- **WHEN** user clicks runtime config entry
- **THEN** modal shows three tabs and allows switching without leaving page context

### Requirement: 在线 LLM tab SHALL expose editable LLM API fields
在线 LLM tab SHALL expose `mode`, `load_profile`, `base_url`, `model`, `api_key` fields for stage-D generation runtime.

#### Scenario: Save LLM API config
- **WHEN** user edits and saves LLM API fields
- **THEN** frontend persists values via `/config/llm` and refreshes effective config

### Requirement: Faster-Whisper tab SHALL expose ASR runtime settings
Faster-Whisper tab SHALL expose model/language/device/compute/chunk/vad and related runtime fields with save feedback.

#### Scenario: Save whisper runtime config
- **WHEN** user saves edited ASR config
- **THEN** frontend persists config and updates local draft with backend effective values

### Requirement: Faster-Whisper tab SHALL support transcript correction mode selection
UI SHALL expose `correction_mode` (`off|strict|rewrite`) with batch/overlap parameters.

#### Scenario: Select strict correction mode
- **WHEN** user saves strict mode and batch settings
- **THEN** frontend persists LLM correction config and subsequent tasks run strict correction

### Requirement: Prompt template panel SHALL support CRUD and selection
Prompt template panel SHALL support template create/update/delete/copy/select for summary and mindmap channels.

#### Scenario: Create template and set selection
- **WHEN** user creates new template and switches active selection
- **THEN** frontend persists template content and selected IDs via config APIs

### Requirement: UI SHALL replay persisted artifacts and logs from task history
History panel SHALL allow restoring transcript/logs/notes/mindmap from terminal tasks.

#### Scenario: Open historical completed task
- **WHEN** user selects task from history modal
- **THEN** frontend loads persisted runtime artifacts and renders them in corresponding stage panels

### Requirement: UI SHALL provide one-click artifact bundle download after completion
After task completion, UI SHALL provide contextual bundle export action.

#### Scenario: Download bundle from completed task
- **WHEN** user clicks bundle download action
- **THEN** frontend requests backend bundle export endpoint and downloads archive

### Requirement: UI SHALL normalize backend errors and warnings for user feedback
Frontend API client SHALL parse structured backend error payload and surface clear messages in toast/runtime panels.

#### Scenario: Backend returns structured error
- **WHEN** API response includes `{ code, message, detail }`
- **THEN** frontend displays `message` and keeps diagnostic metadata for debugging

#### Scenario: Receive `runtime_warning` SSE event
- **WHEN** backend emits runtime warning during task execution
- **THEN** UI appends warning log and shows warning toast immediately

### Requirement: UI SHALL provide in-app quick-start documentation view
Header quick-start entry SHALL switch main area to markdown guide view while preserving theme and locale style consistency.

#### Scenario: Open quick-start page
- **WHEN** user clicks quick-start entry
- **THEN** main content switches to documentation view with outline navigation and markdown body
