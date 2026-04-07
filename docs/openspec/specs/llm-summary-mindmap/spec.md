## ADDED Requirements

### Requirement: System SHALL generate structured notes and mindmap via online LLM API
Stage `D` generation SHALL call OpenAI-compatible chat completion API to produce detailed notes and markmap-compatible mindmap markdown.

#### Scenario: Notes and mindmap generation succeeds
- **WHEN** transcript source context is available and LLM API is reachable
- **THEN** backend persists `notes_markdown` and `mindmap_markdown` artifacts

#### Scenario: LLM API call fails
- **WHEN** remote API returns timeout/non-2xx/error payload
- **THEN** task transitions to `failed` with actionable error metadata

### Requirement: Summary runtime mode SHALL be API-only
Summary/mindmap runtime resolution SHALL normalize to API path in current profile.

#### Scenario: Legacy local-mode payload arrives
- **WHEN** payload/config carries `mode=local` or `local_model_id`
- **THEN** backend normalizes execution mode to `api`
- **AND** generation behavior stays consistent with API-only design

### Requirement: Stage D SHALL stream summary and mindmap outputs incrementally
The backend SHALL stream summary and mindmap deltas independently so frontend can render both channels in near real time.

#### Scenario: Parallel channel streaming
- **WHEN** stage `D` starts generation
- **THEN** backend emits `summary_delta` and `mindmap_delta` events independently
- **AND** frontend can render both channels without waiting for final completion

### Requirement: Notes artifact SHALL be composed from normalized summary output
Persisted `notes_markdown` SHALL be composed from normalized summary structure and SHALL NOT append full raw transcript blocks by default.

#### Scenario: Persist notes after summary normalization
- **WHEN** summary generation succeeds
- **THEN** backend stores notes artifact as structured markdown
- **AND** notes keep focus on key conclusions/actions/evidence instead of full transcript dump

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

### Requirement: Summary source context SHALL use transcript artifacts only
Stage `D` summarization source SHALL use transcript text and transcript-optimization results only.

#### Scenario: Transcript source is available
- **WHEN** stage `D` prepares prompt context
- **THEN** backend composes source context from transcript artifacts without visual evidence sections

### Requirement: Stage D SHALL fail explicitly when generation runtime is unavailable
If generation runtime cannot produce notes/mindmap, backend SHALL fail stage `D` with explicit error classification and SHALL NOT fabricate synthetic fallback content.

#### Scenario: All generation attempts fail
- **WHEN** all configured API attempts fail during stage `D`
- **THEN** backend raises terminal error with condensed attempt reasons
- **AND** task status becomes `failed`
