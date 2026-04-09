## ADDED Requirements

### Requirement: UI SHALL provide bilingual workbench with persistent theme
Frontend SHALL provide Simplified Chinese and English locales, and light/dark themes with persistent preference.

#### Scenario: Switch locale and reload page
- **WHEN** user changes locale in header and refreshes
- **THEN** UI keeps selected locale and renders translated labels consistently

#### Scenario: Toggle theme
- **WHEN** user toggles theme switch
- **THEN** UI updates via theme tokens without readability regression

### Requirement: UI SHALL provide a single workbench main view
Application shell SHALL render a unified workbench main area for runtime operations and settings navigation.

#### Scenario: Enter app
- **WHEN** user opens web or desktop app
- **THEN** main area renders workbench runtime view directly

### Requirement: UI SHALL support URL/path/upload task submission workflow
Workbench SHALL support task creation from `URL`, `local path`, and `file upload`.

#### Scenario: Submit task from source modal
- **WHEN** user submits valid source data
- **THEN** frontend creates task and enters runtime monitoring state

### Requirement: UI SHALL reflect task progress and logs in realtime via SSE
Workbench SHALL update active task status/progress/logs continuously from task event stream.

#### Scenario: Receive runtime events
- **WHEN** backend emits `stage/progress/log/runtime_warning` events
- **THEN** frontend updates runtime panels and warning feedback without manual refresh

### Requirement: UI SHALL provide phase tabs aligned with VM phase model
Runtime area SHALL expose phase tabs `A`, `B`, `C`, `transcript_optimize`, `D` and auto-focus based on incoming runtime events.

#### Scenario: Stage-D optimization phase starts
- **WHEN** backend enters `transcript_optimize`
- **THEN** frontend highlights corresponding phase tab and logs

### Requirement: UI SHALL render stage-D editing and preview workspace
Stage-D workspace SHALL provide notes and mindmap source editing with preview support and terminal-state editing guard.

#### Scenario: Task is still running
- **WHEN** task status is non-terminal
- **THEN** notes/mindmap editors are read-only

#### Scenario: Task becomes terminal
- **WHEN** task status becomes `completed|failed|cancelled`
- **THEN** notes/mindmap editors become editable and can be persisted

### Requirement: UI SHALL provide runtime config center with three tabs
Settings page SHALL provide `在线 LLM`, `Faster-Whisper`, and `Prompt Templates` tabs.

#### Scenario: Open settings center
- **WHEN** user clicks the global settings icon in header
- **THEN** settings page displays three tabs and supports in-place tab switching

### Requirement: UI SHALL support prompt template CRUD and active selection
Prompt template panel SHALL support create/update/delete/copy/select operations for summary and mindmap channels.

#### Scenario: Create template and switch selection
- **WHEN** user creates a template and sets it as selected
- **THEN** frontend persists template and selected IDs through config APIs

### Requirement: UI SHALL provide history modal operations
History panel SHALL support search, reopen, rename, and terminal-task delete operations.

#### Scenario: Reopen historical task
- **WHEN** user selects a historical task
- **THEN** frontend restores runtime artifacts/logs and updates active runtime context

### Requirement: UI SHALL provide completion-only export action
Workbench SHALL show one-click artifact bundle export only when active task is completed.

#### Scenario: Completed task exports bundle
- **WHEN** user clicks export action on completed task
- **THEN** frontend downloads backend bundle artifact

### Requirement: UI SHALL provide three runtime modes for VQA workflow
Runtime workspace SHALL support `flow`, `qa`, and `debug` modes for analysis, question answering, and retrieval diagnostics.

#### Scenario: Run retrieval-only action
- **WHEN** user submits query via retrieval action
- **THEN** UI shows retrieval hit comparisons and trace panel in `debug` mode

#### Scenario: Run chat action
- **WHEN** user starts QA chat
- **THEN** UI streams answer chunks, citations, and status updates in `qa` mode

### Requirement: UI SHALL support VQA trace replay in runtime panel
UI SHALL display trace identifier and fetch trace records for replay diagnostics.

#### Scenario: Refresh trace records
- **WHEN** user triggers trace refresh with valid `trace_id`
- **THEN** frontend requests `/traces/{trace_id}` and updates trace timeline

### Requirement: Desktop host SHALL resolve API base through Electron bridge
When running in Electron, frontend API client SHALL resolve backend API base from preload IPC bridge.

#### Scenario: Desktop bootstraps backend base URL
- **WHEN** renderer initializes in Electron context
- **THEN** frontend resolves API base by `vidgnostBridge.getApiBase()` before API requests
