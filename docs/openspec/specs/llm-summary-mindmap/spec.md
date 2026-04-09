## ADDED Requirements

### Requirement: System SHALL generate notes and mindmap via online LLM API
Stage-D generation SHALL use OpenAI-compatible completion APIs to produce structured notes markdown and markmap-compatible mindmap markdown.

#### Scenario: Stage-D generation succeeds
- **WHEN** transcript context is available and configured API is reachable
- **THEN** backend persists `notes_markdown` and `mindmap_markdown` artifacts

#### Scenario: Generation runtime fails
- **WHEN** API request times out, returns non-2xx, or fails validation
- **THEN** task transitions to `failed` with actionable error metadata

### Requirement: Prompt-template-driven generation SHALL be supported
Summary and mindmap generation SHALL resolve prompts from persisted template records and active template selection.

#### Scenario: Selected templates are applied
- **WHEN** user sets selected template IDs in config center
- **THEN** subsequent Stage-D generation uses selected template content for both channels

### Requirement: Stage-D output SHALL stream summary and mindmap deltas independently
Backend SHALL emit independent `summary_delta` and `mindmap_delta` updates for near-realtime frontend rendering.

#### Scenario: Stage-D stream is active
- **WHEN** generation starts
- **THEN** frontend receives and renders both channel deltas without waiting for final output

### Requirement: Notes content SHALL focus on normalized synthesis
Persisted `notes_markdown` SHALL be normalized synthesis output and SHALL NOT append full raw transcript by default.

#### Scenario: Persist normalized notes
- **WHEN** summary normalization finishes
- **THEN** notes artifact focuses on conclusions, evidence, and actions

### Requirement: Mermaid code fences in notes SHALL be rendered as PNG assets
When notes markdown includes Mermaid code blocks, backend SHALL render them into PNG files and replace code fences with markdown image links.

#### Scenario: Mermaid render succeeds
- **WHEN** notes contain Mermaid fences and renderer is available
- **THEN** backend stores images under `notes-images/`
- **AND** backend replaces each Mermaid fence with relative markdown image path

#### Scenario: Mermaid renderer unavailable
- **WHEN** renderer command is unavailable at runtime
- **THEN** backend keeps generation pipeline available and records renderer failure context in runtime diagnostics

### Requirement: Notes markdown SHALL reference Mermaid images by relative path
Rendered notes SHALL reference Mermaid images using relative paths (for example `notes-images/mermaid-001.png`) and SHALL NOT embed base64 data URIs.

#### Scenario: Export notes markdown
- **WHEN** client exports notes or bundle artifacts
- **THEN** markdown contains relative image references compatible with bundled `notes-images` assets
