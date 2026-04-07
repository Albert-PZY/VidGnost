## ADDED Requirements

### Requirement: System SHALL generate detailed notes, summary, and mindmap via online LLM API

Phase `D` generation SHALL call OpenAI-compatible chat completion API to produce detailed notes, concise summary, and markmap-compatible mindmap markdown.

#### Scenario: Notes, summary, and mindmap generation succeeds

- **WHEN** transcript source context is available and online API is reachable
- **THEN** backend persists `notes_markdown`, `summary_markdown`, and `mindmap_markdown` artifacts

#### Scenario: LLM API call fails

- **WHEN** remote API returns timeout/non-2xx/error payload
- **THEN** task transitions to `failed` with actionable error metadata

### Requirement: Generation runtime mode SHALL resolve to API

Detailed-notes/summary/mindmap runtime SHALL execute by effective online API configuration.

#### Scenario: Run stage-D generation

- **WHEN** backend starts notes/mindmap generation
- **THEN** backend resolves runtime parameters from saved online LLM config

### Requirement: Stage D SHALL stream notes, summary, and mindmap outputs incrementally

Backend SHALL stream notes, summary, and mindmap deltas independently so frontend can render each channel in near realtime.

#### Scenario: Multi-channel streaming

- **WHEN** stage `D` starts generation
- **THEN** backend emits `notes_delta`, `summary_delta`, and `mindmap_delta` independently
- **AND** frontend renders each channel without waiting for final completion

### Requirement: Notes artifact SHALL be generated independently from summary artifact

Persisted `notes_markdown` SHALL be generated from transcript evidence cards, outline planning, section-by-section writing, and coverage patching, and SHALL NOT be composed by wrapping `summary_markdown`.

#### Scenario: Persist notes after independent notes pipeline succeeds

- **WHEN** notes pipeline finishes
- **THEN** backend stores notes artifact as structured markdown with a single top-level title
- **AND** notes preserve definitions, steps, examples, comparisons, constraints, caveats, and terms from transcript evidence

### Requirement: Prompt-template-driven generation SHALL be supported

Summary, notes, and mindmap generation SHALL resolve system prompts from template records persisted in local files.

#### Scenario: Use selected templates for all channels

- **WHEN** user selects template IDs in config center
- **THEN** backend loads selected template content for summary/notes/mindmap channels
- **AND** subsequent tasks use selected templates until selection changes

### Requirement: Prompt templates SHALL be persisted as split files

Template persistence SHALL store one template per file and keep active selection in a separate file.

#### Scenario: Create or update template

- **WHEN** frontend performs template CRUD
- **THEN** backend writes `storage/prompts/templates/<template_id>.json`
- **AND** backend maintains selection in `storage/prompts/selection.json`

### Requirement: Summary source context SHALL use notes-pipeline artifacts

Stage `D` summary generation source SHALL use detailed notes and outline artifacts produced earlier in phase `D`.

#### Scenario: Notes pipeline artifacts are available

- **WHEN** stage `D` prepares concise summary prompt context
- **THEN** backend composes context from outline and detailed notes artifacts
- **AND** summary output remains aligned with the independently generated notes structure

### Requirement: Stage D SHALL fail explicitly when generation runtime is unavailable

If generation runtime cannot produce notes/mindmap, backend SHALL fail phase `D` with explicit error classification.

#### Scenario: All generation attempts fail

- **WHEN** configured API attempts fail during phase `D`
- **THEN** backend raises terminal error with condensed attempt reasons
- **AND** task status becomes `failed`
