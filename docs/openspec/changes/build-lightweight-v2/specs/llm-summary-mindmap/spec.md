## ADDED Requirements

### Requirement: System SHALL generate structured notes and mindmap via online LLM API
Phase `D` generation SHALL call OpenAI-compatible chat completion API to produce detailed notes and markmap-compatible mindmap markdown.

#### Scenario: Notes and mindmap generation succeeds
- **WHEN** transcript source context is available and online API is reachable
- **THEN** backend persists `notes_markdown` and `mindmap_markdown` artifacts

#### Scenario: LLM API call fails
- **WHEN** remote API returns timeout/non-2xx/error payload
- **THEN** task transitions to `failed` with actionable error metadata

### Requirement: Summary runtime mode SHALL resolve to API
Summary/mindmap runtime SHALL execute by effective online API configuration.

#### Scenario: Run stage-D generation
- **WHEN** backend starts notes/mindmap generation
- **THEN** backend resolves runtime parameters from saved online LLM config

### Requirement: Stage D SHALL stream summary and mindmap outputs incrementally
Backend SHALL stream notes and mindmap deltas independently so frontend can render both channels in near realtime.

#### Scenario: Parallel channel streaming
- **WHEN** stage `D` starts generation
- **THEN** backend emits `summary_delta` and `mindmap_delta` independently
- **AND** frontend renders both channels without waiting for final completion

### Requirement: Notes artifact SHALL be composed from normalized summary output
Persisted `notes_markdown` SHALL be composed from normalized summary structure and SHALL NOT append full raw transcript blocks by default.

#### Scenario: Persist notes after summary normalization
- **WHEN** summary generation succeeds
- **THEN** backend stores notes artifact as structured markdown
- **AND** notes focus on conclusions, actions, and evidence highlights

### Requirement: Prompt-template-driven generation SHALL be supported
Summary and mindmap generation SHALL resolve system prompts from template records persisted in local files.

#### Scenario: Use selected templates for both channels
- **WHEN** user selects template IDs in config center
- **THEN** backend loads selected template content for summary/mindmap channels
- **AND** subsequent tasks use selected templates until selection changes

### Requirement: Prompt templates SHALL be persisted as split files
Template persistence SHALL store one template per file and keep active selection in a separate file.

#### Scenario: Create or update template
- **WHEN** frontend performs template CRUD
- **THEN** backend writes `storage/prompts/templates/<template_id>.json`
- **AND** backend maintains selection in `storage/prompts/selection.json`

### Requirement: Summary source context SHALL use transcript artifacts
Stage `D` summarization source SHALL use transcript text and transcript-optimization results.

#### Scenario: Transcript source is available
- **WHEN** stage `D` prepares prompt context
- **THEN** backend composes context from transcript artifacts with correction outputs

### Requirement: Stage D SHALL fail explicitly when generation runtime is unavailable
If generation runtime cannot produce notes/mindmap, backend SHALL fail phase `D` with explicit error classification.

#### Scenario: All generation attempts fail
- **WHEN** configured API attempts fail during phase `D`
- **THEN** backend raises terminal error with condensed attempt reasons
- **AND** task status becomes `failed`
