## ADDED Requirements

### Requirement: Stage D SHALL generate notes, mindmap, and summary through the OpenAI-compatible generation path when available
Status: `implemented`

Stage `D` generation SHALL use the persisted OpenAI-compatible provider config and selected prompt templates to produce `notes_markdown`、`mindmap_markdown` and `summary_markdown` when the remote runtime is available.

#### Scenario: Stage-D generation succeeds
- **WHEN** transcript context is available and configured API is reachable
- **THEN** backend persists `notes_markdown` and `mindmap_markdown`
- **AND** backend derives `summary_markdown` from the generated notes result

#### Scenario: Local loopback OpenAI-compatible runtime remains eligible before user-confirmed save state catches up
- **WHEN** persisted LLM config points to a loopback OpenAI-compatible endpoint such as `127.0.0.1` or `localhost`
- **AND** that config already contains a non-empty `model` and reachable local runtime parameters
- **THEN** stage `D` still treats the local runtime as available even if the repository-level `user_configured` marker is still false
- **AND** successful generation records `generated_by=llm` in the fusion manifest instead of falling back only because the saved-config marker lagged behind

#### Scenario: Distinguish notes generation from VQA multimodal stage-D chain
- **WHEN** this capability spec describes Stage `D` generation
- **THEN** scope applies to notes-oriented artifacts (`notes_markdown` / `mindmap_markdown` / `summary_markdown`) and transcript optimization
- **AND** VQA-specific multimodal stage-D substages (`transcript_vectorize`、`frame_extract`、`frame_semantic`、`multimodal_index_fusion`) are tracked in the transcription and workbench capability specs instead of being declared fully implemented here

### Requirement: Transcript optimization SHALL expose observable `off`、`strict`、`rewrite` modes
Status: `implemented`

Before notes and mindmap generation, transcript optimization SHALL run through the persisted correction mode and produce task-local artifacts that reflect the selected strategy.

#### Scenario: Correction mode is `off`
- **WHEN** `correction_mode=off`
- **THEN** backend skips the LLM correction chain
- **AND** downstream notes and mindmap generation uses the raw transcript directly

#### Scenario: Correction mode is `strict`
- **WHEN** `correction_mode=strict`
- **THEN** backend performs batch-based segment correction while preserving timestamp-aligned segment structure
- **AND** backend persists corrected segment output to `D/transcript-optimize/strict-segments.json`

#### Scenario: Correction mode is `rewrite`
- **WHEN** `correction_mode=rewrite`
- **THEN** backend performs batch-based rewrite while preserving the original segment timestamp boundaries
- **AND** backend persists the rewritten segment text back into the task transcript segment structure
- **AND** backend persists the rewritten text to `D/transcript-optimize/rewrite.txt`

### Requirement: Transcript optimization SHALL persist index and full-text artifacts
Status: `implemented`

Transcript optimization SHALL persist enough metadata for workbench inspection and downstream debugging.

#### Scenario: Persist transcript optimization artifacts
- **WHEN** transcript optimization finishes
- **THEN** backend writes `D/transcript-optimize/index.json`
- **AND** backend writes `D/transcript-optimize/full.txt`
- **AND** the index captures `mode`、`status`、`fallback_used`、`fallback_reason`、`source_mode`、`batch_size` and `overlap`

#### Scenario: Stream transcript optimization preview by timestamp
- **WHEN** transcript optimization is running in `strict` or `rewrite` mode
- **THEN** SSE emits `transcript_optimized_preview` reset and done markers for the active mode
- **AND** every streamed preview segment carries the original `start` / `end` timestamp pair together with the latest corrected text
- **AND** if the LLM echoes prompt-side numbering or timestamp labels such as `[07:00 - 07:05]`, backend strips those structural prefixes before persisting corrected segment text
- **AND** fallback completion metadata is surfaced through the final preview event when any batch falls back to raw transcript text

### Requirement: Transcript optimization SHALL consume correction batch parameters
Status: `implemented`

The persisted correction config SHALL influence how transcript batches are sent to the LLM correction chain.

#### Scenario: Apply correction batching controls
- **WHEN** backend runs `strict` or `rewrite` correction
- **THEN** it uses the configured `correction_batch_size`
- **AND** it reuses the configured `correction_overlap` to build overlapping windows between batches

#### Scenario: Correction batch returns invalid structured output
- **WHEN** a `strict` or `rewrite` correction batch returns empty content or a line count that does not match the requested window
- **THEN** backend falls back to the original batch text for that window instead of aborting stage `D`
- **AND** transcript optimization metadata records `fallback_used=true` together with the batch-specific fallback reason

### Requirement: Stage-D generation SHALL fail soft through explicit fallback artifacts
Status: `implemented`

When the remote generation runtime is unavailable, returns empty content, or errors, backend SHALL fall back to heuristic notes and mindmap content instead of failing the entire task.

#### Scenario: Notes generation falls back
- **WHEN** the notes generation request fails, times out, or returns empty content
- **THEN** backend emits a fallback notes artifact
- **AND** fallback content starts with a visible notice line `> 当前为回退生成结果：...`

#### Scenario: Mindmap generation falls back
- **WHEN** the mindmap generation request fails, times out, or returns empty content
- **THEN** backend emits a fallback mindmap artifact
- **AND** task status can still continue to `completed` when downstream persistence succeeds

### Requirement: Stage-D output SHALL persist artifact provenance manifest
Status: `implemented`

Backend SHALL persist provenance metadata for notes, mindmap, and summary artifacts so the frontend can distinguish normal generation from fallback generation.

#### Scenario: Persist fusion manifest
- **WHEN** stage `D` finishes
- **THEN** backend writes `D/fusion/manifest.json`
- **AND** each channel records `generated_by=llm|fallback`
- **AND** fallback channels also record `fallback_reason`

### Requirement: Prompt-template-driven generation SHALL be supported
Status: `implemented`

Summary and mindmap generation SHALL resolve prompts from persisted template records and active template selection.

#### Scenario: Selected templates are applied
- **WHEN** user sets selected template IDs in config center
- **THEN** subsequent Stage-D generation uses selected template content for `correction`、`notes` and `mindmap`

#### Scenario: Default templates keep the Python-era baseline copy
- **WHEN** backend repairs or recreates the built-in default templates
- **THEN** `notes` and `mindmap` defaults use the long-form project baseline prompts carried forward from the pre-TS Python backend
- **AND** `correction` and `vqa` defaults use the concise baseline copy from that same Python-era template set
- **AND** the repair path updates stale built-in template content back to that baseline while keeping template IDs and selection wiring stable

#### Scenario: Default notes prompt stays distinct from dedicated mindmap generation
- **WHEN** backend repairs or recreates the built-in default templates
- **THEN** the default `notes` template avoids dedicated `思维导图` wording that can collapse notes generation into the separate mindmap channel
- **AND** the default `mindmap` template remains the only built-in template responsible for standalone markmap-style hierarchy output

### Requirement: Notes content SHALL focus on normalized synthesis
Status: `implemented`

Persisted `notes_markdown` SHALL focus on normalized conclusions, evidence, and action-ready text instead of appending the full raw transcript by default.

#### Scenario: Persist normalized notes
- **WHEN** summary normalization finishes
- **THEN** notes artifact focuses on conclusions, evidence, and actions

### Requirement: Markdown artifacts SHALL remain markdown-first for frontend rendering and export
Status: `implemented`

Backend SHALL persist notes and mindmap as markdown content and keep markdown rendering concerns in the frontend workbench or export layer.

#### Scenario: Persist markdown artifacts
- **WHEN** Stage `D` generation completes
- **THEN** backend writes markdown artifacts under `D/fusion/*.md`
- **AND** current TS runtime does not require server-side `summary_delta` / `mindmap_delta` streaming or server-side Mermaid-to-PNG conversion to complete the task
