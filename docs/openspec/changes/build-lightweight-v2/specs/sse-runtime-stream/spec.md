## ADDED Requirements

### Requirement: System SHALL provide per-task runtime event stream
Status: `implemented`

Backend SHALL expose a per-task event stream endpoint and emit ordered runtime events for lifecycle, logs, progress, and terminal notifications.

#### Scenario: Subscribe task stream
- **WHEN** client connects to `/tasks/{task_id}/events`
- **THEN** backend responds with `text/event-stream`
- **AND** emits historical buffered events before live updates

### Requirement: Task events SHALL include stage-aware context
Status: `implemented`

Stage-related events SHALL carry phase keys aligned with the runtime model: `A`、`B`、`C`、`D` and optional stage-`D` substages.

#### Scenario: Stage transition arrives
- **WHEN** runtime enters the next phase or subphase
- **THEN** event payload includes explicit stage key and status metadata

### Requirement: Task events SHALL include trace identifiers
Status: `implemented`

Each task event SHALL include `trace_id` for diagnostics and replay correlation.

#### Scenario: Publisher omits trace identifier
- **WHEN** event publisher does not provide `trace_id`
- **THEN** event bus injects a topic-scoped trace ID automatically

### Requirement: SSE infrastructure SHALL bound in-memory queue and history
Status: `implemented`

Event stream layer SHALL keep bounded per-subscriber queues and release terminal task history when no subscribers remain.

#### Scenario: Long-running high-frequency stream
- **WHEN** publisher rate exceeds consumer speed
- **THEN** queue remains bounded and process memory does not grow unbounded

#### Scenario: Terminal task has no subscribers
- **WHEN** task reaches terminal state and subscribers disconnect
- **THEN** in-memory history for that task is released

### Requirement: Runtime events SHALL be persisted to JSONL without blocking stream delivery
Status: `implemented`

Backend SHALL append task and self-check events to local JSONL logs while keeping stream delivery available.

#### Scenario: Event-log append fails
- **WHEN** local storage write fails
- **THEN** stream delivery continues
- **AND** backend logs diagnostic failure details

### Requirement: Self-check sessions SHALL provide event stream
Status: `implemented`

Backend SHALL expose self-check session event stream endpoint for progress and autofix logs.

#### Scenario: Subscribe self-check stream
- **WHEN** client connects to `/self-check/{session_id}/events`
- **THEN** backend emits ordered self-check events until terminal state

#### Scenario: Consume self-check progress incrementally
- **WHEN** renderer receives ordered self-check events for the same session
- **THEN** it MAY update the live diagnostics timeline and step status directly from stream payloads without reloading the full report on every event
- **AND** it performs an additional report fetch only for initial hydration, manual refresh, or terminal-state reconciliation

#### Scenario: Prune expired self-check stream topic
- **WHEN** a self-check session is evicted from the retained session cache
- **THEN** backend releases the corresponding topic queue, buffered history, and trace-sequence bookkeeping from memory
- **AND** persisted JSONL event logs for that expired session MAY be deleted together with the session snapshot

### Requirement: VQA chat streaming SHALL publish typed incremental events
Status: `implemented`

`POST /chat/stream` SHALL stream structured event payloads containing trace metadata, incremental answer chunks, status updates, citations, and explicit completion or error events.

#### Scenario: Stream starts and emits citations
- **WHEN** chat stream begins
- **THEN** stream emits citation payload with `type="citations"` and `trace_id`

#### Scenario: Stream emits answer deltas
- **WHEN** answer generation is in progress
- **THEN** stream emits `type="chunk"` events with `delta` and `trace_id`

#### Scenario: Stream emits status and completion
- **WHEN** backend updates stream state and finishes normally
- **THEN** stream emits `type="status"` updates
- **AND** stream ends with a structured `type="done"` event instead of a raw `[DONE]` sentinel

#### Scenario: Stream transport fails
- **WHEN** the stream transport fails before completion
- **THEN** backend emits a structured `type="error"` payload with a stable error code

### Requirement: Task stream payloads SHALL remain renderer-friendly for stage output panes
Status: `implemented`

Per-task runtime events SHALL carry stable renderer-facing fields so the workbench can render bounded stage-output feeds without bespoke event decoding per stage. Payloads SHALL preserve `timestamp`, `type`, optional `original_type`, optional `stage`, and at least one human-readable text field among `message`, `text`, or `title`.

#### Scenario: Renderer paints the stage-output feed
- **WHEN** frontend receives buffered or live task events from `/tasks/{task_id}/events`
- **THEN** each event exposes enough metadata for the renderer to show stage badges, timestamps, and readable copy in the stage-output tab
- **AND** frontend MAY keep only a bounded recent window of those events locally without losing event meaning

### Requirement: Task stream contract SHALL NOT overstate non-emitted event types
Status: `implemented`

The spec baseline SHALL match current publishers instead of assuming preview-only delta events that are not emitted by the backend today.

#### Scenario: Review current task event publishers
- **WHEN** backend publishes task runtime events in the current TS runtime
- **THEN** the guaranteed baseline covers lifecycle, progress, log, and terminal events
- **AND** current spec does not require `runtime_warning`、`summary_delta` or `mindmap_delta` publishers as part of the implemented contract
