## ADDED Requirements

### Requirement: System SHALL expose editable LLM runtime config API

The system SHALL expose `/config/llm` read/update endpoints with OpenAI-compatible runtime fields.

#### Scenario: Read current LLM config

- **WHEN** client requests `/config/llm`
- **THEN** backend returns persisted config (or defaults) including `mode`, `load_profile`, `api_key`, `base_url`, `model`, and transcript-correction options

#### Scenario: Update LLM runtime config

- **WHEN** client submits new LLM config payload
- **THEN** backend persists normalized values and returns effective config

### Requirement: LLM runtime mode SHALL resolve to API

The backend SHALL persist and return effective `mode=api` for generation runtime.

#### Scenario: Save LLM mode value

- **WHEN** client submits `mode` in update payload
- **THEN** backend returns effective `mode=api`

### Requirement: System SHALL persist LLM config in local model_config.json

LLM runtime config SHALL be stored in `backend/storage/model_config.json`.

#### Scenario: Save LLM config

- **WHEN** update API succeeds
- **THEN** backend writes effective config to `model_config.json`

### Requirement: Transcript-correction options SHALL be configurable

LLM config SHALL include stage-D correction controls: `correction_mode`, `correction_batch_size`, `correction_overlap`.

#### Scenario: Save strict correction mode

- **WHEN** user saves `correction_mode=strict`
- **THEN** subsequent tasks run timeline-preserving strict correction

#### Scenario: Save rewrite correction mode

- **WHEN** user saves `correction_mode=rewrite`
- **THEN** subsequent tasks use rewritten text as stage-D source while preserving transcript segment timeline artifacts

#### Scenario: Save correction off

- **WHEN** user saves `correction_mode=off`
- **THEN** backend skips correction substage work in phase `D`

### Requirement: System SHALL expose editable Whisper runtime config API

The system SHALL expose `/config/whisper` read/update endpoints and persist effective values into `backend/storage/config.toml`.

#### Scenario: Read Whisper config

- **WHEN** client requests `/config/whisper`
- **THEN** backend returns current persisted config or normalized defaults

#### Scenario: Save Whisper config

- **WHEN** client updates whisper runtime fields
- **THEN** backend validates and persists effective values in `config.toml`
- **AND** response may include `warnings` and `rollback_applied`

### Requirement: Whisper runtime config SHALL include ASR fields

Whisper config SHALL include:
`model_default`, `language`, `device`, `compute_type`, `model_load_profile`, `beam_size`, `vad_filter`, `chunk_seconds`, `target_sample_rate`, `target_channels`.

#### Scenario: Save ASR runtime fields

- **WHEN** client submits supported ASR fields
- **THEN** backend persists normalized effective values and applies them to subsequent tasks

### Requirement: Whisper runtime effective device SHALL be CPU

Whisper runtime config persistence SHALL normalize effective `device` to `cpu`.

#### Scenario: Save whisper config with any device value

- **WHEN** client submits whisper `device`
- **THEN** backend persists and returns effective `device=cpu`

### Requirement: Whisper runtime effective compute_type SHALL be constrained

Whisper runtime config persistence SHALL keep effective `compute_type` within `int8|float32`.

#### Scenario: Save unsupported compute_type

- **WHEN** client submits unsupported whisper `compute_type`
- **THEN** backend persists normalized `compute_type=int8`

### Requirement: Runtime config APIs SHALL ignore unsupported fields

Runtime config APIs SHALL process documented fields and ignore unsupported extra fields in payload.

#### Scenario: Submit payload with extra unsupported fields

- **WHEN** client sends unknown keys in config update payload
- **THEN** backend ignores unknown keys and keeps effective config consistent

### Requirement: Frontend task defaults SHALL follow persisted whisper config

Task submission flow SHALL use persisted whisper defaults (`model_default`, `language`) as effective runtime defaults.

#### Scenario: Submit task after saving whisper defaults

- **WHEN** user updates whisper defaults and starts new task
- **THEN** submission payload uses updated persisted defaults
