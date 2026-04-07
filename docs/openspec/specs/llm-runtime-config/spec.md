## ADDED Requirements

### Requirement: System SHALL expose editable LLM runtime config API
The system SHALL expose `/config/llm` read/update endpoints with OpenAI-compatible runtime fields.

#### Scenario: Read current config
- **WHEN** client requests `/config/llm`
- **THEN** backend returns persisted config (or defaults) including `mode`, `load_profile`, `api_key`, `base_url`, `model`, and transcript-correction options

#### Scenario: Update LLM runtime config
- **WHEN** client submits new LLM config payload
- **THEN** backend persists normalized values and returns saved effective config

### Requirement: LLM mode SHALL be normalized to API-only
The backend SHALL normalize LLM runtime mode to `api` in current profile.

#### Scenario: Legacy local mode submitted
- **WHEN** client submits `mode=local` or equivalent legacy value
- **THEN** backend persists/returns effective `mode=api`

### Requirement: System SHALL persist LLM config in local model_config.json
LLM runtime config SHALL be stored in `backend/storage/model_config.json`.

#### Scenario: Save config
- **WHEN** update API succeeds
- **THEN** backend writes effective config to `model_config.json`

### Requirement: Transcript-correction options SHALL be configurable
LLM config SHALL include transcript-correction controls used in stage `D`: `correction_mode`, `correction_batch_size`, `correction_overlap`.

#### Scenario: Save strict correction mode
- **WHEN** user saves `correction_mode=strict`
- **THEN** subsequent tasks run strict timeline-preserving correction behavior

#### Scenario: Save rewrite correction mode
- **WHEN** user saves `correction_mode=rewrite`
- **THEN** subsequent tasks use rewrite text for summarization input while keeping timeline segment artifacts unchanged

#### Scenario: Save correction off
- **WHEN** user saves `correction_mode=off`
- **THEN** backend skips transcript correction in stage `D`

### Requirement: System SHALL expose editable Whisper runtime config API
The system SHALL expose `/config/whisper` read/update endpoints and persist effective runtime values into `backend/storage/config.toml`.

#### Scenario: Read Whisper config
- **WHEN** client requests `/config/whisper`
- **THEN** backend returns current persisted config or normalized defaults

#### Scenario: Save Whisper config
- **WHEN** client updates whisper runtime fields
- **THEN** backend validates and persists effective values in `config.toml`
- **AND** response may contain `warnings` and `rollback_applied`

### Requirement: Whisper runtime config SHALL include ASR-only fields
Whisper config SHALL include:
`model_default`, `language`, `device`, `compute_type`, `model_load_profile`, `beam_size`, `vad_filter`, `chunk_seconds`, `target_sample_rate`, `target_channels`.

#### Scenario: Save ASR runtime fields
- **WHEN** client submits supported ASR fields
- **THEN** backend persists normalized effective values and applies them to subsequent tasks

### Requirement: Runtime config API SHALL not expose visual runtime fields
Runtime config API surface SHALL NOT include frame-extraction or VLM fields in current profile.

#### Scenario: Client submits removed visual fields
- **WHEN** payload includes legacy visual fields
- **THEN** backend ignores unsupported fields and keeps ASR-only effective config

### Requirement: Runtime config API SHALL not expose local deployment endpoints
Runtime config API surface SHALL NOT include runtime-prepare deployment/status or Whisper preload session endpoints in current profile.

#### Scenario: Client requests removed local deployment endpoint
- **WHEN** client calls legacy local deployment/preload endpoint
- **THEN** endpoint is unavailable by design and frontend SHALL rely on API-only config workflow

### Requirement: Frontend task defaults SHALL follow persisted whisper config
Task submission flow SHALL use persisted whisper defaults (`model_default`, `language`) as effective runtime defaults.

#### Scenario: Submit task after saving whisper defaults
- **WHEN** user updates whisper defaults and starts a new task
- **THEN** submission payload uses updated persisted defaults
