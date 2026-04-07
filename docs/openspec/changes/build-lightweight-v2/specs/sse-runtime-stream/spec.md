## ADDED Requirements

### Requirement: System SHALL provide per-task SSE runtime stream
The system SHALL expose per-task SSE endpoint and emit ordered runtime events for stage lifecycle, logs, progress, and generated outputs.

#### Scenario: Subscribe task event stream
- **WHEN** client connects to `/tasks/{task_id}/events`
- **THEN** backend returns `text/event-stream`
- **AND** emits events in chronological order for the task

### Requirement: SSE events SHALL include stage-aware context
Stage-related events SHALL carry stage key aligned with runtime phase model: `A`, `B`, `C`, `transcript_optimize`, `D`.

#### Scenario: Stage transition event arrives
- **WHEN** runtime starts next phase/subphase
- **THEN** backend emits stage event with explicit phase key and status metadata

### Requirement: SSE events SHALL include trace identifiers
Each event SHALL carry `trace_id` for cross-event diagnostics.

#### Scenario: Event published without trace id
- **WHEN** publisher does not provide `trace_id`
- **THEN** event bus injects task-scoped trace identifier automatically

### Requirement: Runtime log events SHALL expose elapsed timing metadata
`log` events SHALL include `elapsed_seconds` when stage start timestamp is known.

#### Scenario: Receive stage log while stage is running
- **WHEN** backend emits `log` event during a running stage
- **THEN** payload includes `elapsed_seconds`
- **AND** frontend can render realtime running duration

### Requirement: Runtime log events SHALL support optional substage context
`log` events SHOULD include optional `substage` for fine-grained tracing inside stage `D`.

#### Scenario: Stage D emits substage logs
- **WHEN** stage `D` executes `transcript_optimize` or `fusion_delivery`
- **THEN** backend may emit `log` with `stage="D"` and matching `substage`

### Requirement: System SHALL emit structured runtime-warning events
The SSE stream SHALL emit `runtime_warning` events for degraded but non-fatal runtime conditions.

#### Scenario: Runtime precheck warning
- **WHEN** backend detects non-fatal runtime risk during precheck
- **THEN** backend emits `runtime_warning` with `stage`, `message`, `code`, `component`, `action`

### Requirement: Transcript optimization preview events SHALL support timeline metadata
`transcript_optimized_preview` events SHOULD support optional `start` / `end` fields for strict-mode timeline rendering.

#### Scenario: Emit strict correction preview segment
- **WHEN** strict correction returns segment-level result
- **THEN** preview event includes `text`, `start`, `end`, and stream metadata

### Requirement: Compat stream mode SHALL publish batch payload directly
When backend uses compatibility mode, it SHALL publish full batch text payload and SHALL NOT split into pseudo character stream chunks.

#### Scenario: Emit compat summary/mindmap update
- **WHEN** backend emits compat-mode delta
- **THEN** payload contains full text batch for that update

### Requirement: SSE layer SHALL bound in-memory queue and history
The SSE layer SHALL bound per-subscriber queue and release task history after terminal events when no subscribers remain.

#### Scenario: High-volume long task stream
- **WHEN** one subscriber consumes slower than publish rate
- **THEN** queue remains bounded and backend avoids unbounded memory growth

#### Scenario: Terminal task stream has no subscribers
- **WHEN** task reaches `completed|failed|cancelled` and all subscribers disconnect
- **THEN** in-memory stream history for that task is released

### Requirement: SSE event bus SHALL persist runtime events to JSONL log
Backend SHALL append emitted task events to `storage/event-logs/{task_id}.jsonl` for postmortem diagnostics without blocking online stream delivery.

#### Scenario: Local event-log write fails
- **WHEN** JSONL append fails for local I/O reason
- **THEN** backend keeps SSE delivery path available
- **AND** surfaces storage error via logs/metrics

### Requirement: System SHALL provide SSE stream for self-check sessions
The system SHALL expose SSE endpoint for self-check sessions and stream step progress, issue results, and auto-fix logs.

#### Scenario: Subscribe self-check stream
- **WHEN** client connects to `/self-check/{session_id}/events`
- **THEN** backend emits ordered self-check/autofix events until terminal state

### Requirement: Self-check stream cache SHALL be bounded
Self-check stream/session cache SHALL evict oldest terminal sessions when capacity is exceeded.

#### Scenario: Self-check sessions exceed cache capacity
- **WHEN** process accumulates more sessions than configured cache size
- **THEN** running sessions are retained
- **AND** oldest terminal sessions are pruned first
