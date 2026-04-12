## ADDED Requirements

### Requirement: System SHALL provide per-task runtime event stream
Backend SHALL expose per-task event stream endpoint and emit ordered runtime events for lifecycle, logs, progress, and generation deltas.

#### Scenario: Subscribe task stream
- **WHEN** client connects to `/tasks/{task_id}/events`
- **THEN** backend responds with `text/event-stream`
- **AND** emits historical buffered events before live updates

### Requirement: Task events SHALL include stage-aware context
Stage-related events SHALL carry phase keys aligned with runtime model: `A`, `B`, `C`, `transcript_optimize`, `D`.

#### Scenario: Stage transition arrives
- **WHEN** runtime enters next phase/subphase
- **THEN** event payload includes explicit stage key and status metadata

### Requirement: Task events SHALL include trace identifiers
Each task event SHALL include `trace_id` for diagnostics and replay correlation.

#### Scenario: Publisher omits trace identifier
- **WHEN** event publisher does not provide `trace_id`
- **THEN** event bus injects task-scoped trace ID automatically

### Requirement: Runtime warning SHALL be streamed as structured events
Backend SHALL emit `runtime_warning` events for degraded-but-continuable conditions.

#### Scenario: Non-fatal runtime risk detected
- **WHEN** backend detects warning condition during execution
- **THEN** stream emits warning with `stage`, `code`, `component`, `action`, and human-readable message

### Requirement: SSE infrastructure SHALL bound in-memory queue and history
Event stream layer SHALL keep bounded per-subscriber queues and release terminal task history when no subscribers remain.

#### Scenario: Long-running high-frequency stream
- **WHEN** publisher rate exceeds consumer speed
- **THEN** queue remains bounded and process memory does not grow unbounded

#### Scenario: Terminal task has no subscribers
- **WHEN** task reaches terminal state and subscribers disconnect
- **THEN** in-memory history for that task is released

### Requirement: Runtime events SHALL be persisted to JSONL without blocking stream
Backend SHALL append task events to local JSONL logs while keeping stream delivery available.

#### Scenario: Event-log append fails
- **WHEN** local storage write fails
- **THEN** stream delivery continues
- **AND** backend logs diagnostic failure details

### Requirement: Self-check sessions SHALL provide event stream
Backend SHALL expose self-check session event stream endpoint for progress and autofix logs.

#### Scenario: Subscribe self-check stream
- **WHEN** client connects to `/self-check/{session_id}/events`
- **THEN** backend emits ordered self-check events until terminal state

### Requirement: VQA chat streaming SHALL publish typed incremental events
`POST /chat/stream` SHALL stream structured event payloads containing trace metadata, incremental answer chunks, status updates, and completion sentinel.

#### Scenario: Stream starts and emits citations
- **WHEN** chat stream begins
- **THEN** stream emits citation payload with `type="citations"` and `trace_id`

#### Scenario: Stream emits answer deltas
- **WHEN** model returns incremental text
- **THEN** stream emits `type="chunk"` with `delta` and `trace_id`

#### Scenario: Stream emits status and completion
- **WHEN** backend updates stream state and finishes
- **THEN** stream emits `type="status"` updates and terminal sentinel `[DONE]`

#### Scenario: Stream error and fallback
- **WHEN** stream mode fails and backend auto-falls back
- **THEN** stream emits error/status signals with same `trace_id` and preserves diagnostic continuity

### Requirement: Task stream payloads SHALL remain renderer-friendly for stage output panes
Per-task runtime events SHALL carry stable renderer-facing fields so the workbench can render bounded stage-output feeds without bespoke event decoding per stage. Payloads SHALL preserve `timestamp`, `type`, optional `original_type`, optional `stage`, and at least one human-readable text field among `message`, `text`, or `title`.

#### Scenario: Renderer paints the stage-output feed
- **WHEN** frontend receives buffered or live task events from `/tasks/{task_id}/events`
- **THEN** each event exposes enough metadata for the renderer to show stage badges, timestamps, and readable copy in the stage-output tab
- **AND** frontend MAY keep only a bounded recent window of those events locally without losing event meaning
