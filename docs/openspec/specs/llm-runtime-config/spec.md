## ADDED Requirements

### Requirement: System SHALL expose editable OpenAI-compatible LLM config API
The system SHALL expose `/config/llm` read/update endpoints for the online generation runtime and return persisted effective values.

#### Scenario: Read current LLM config
- **WHEN** client requests `/config/llm`
- **THEN** backend returns effective config including `mode`, `load_profile`, `local_model_id`, `base_url`, `api_key`, `api_key_configured`, `model`, and transcript-correction options

#### Scenario: Update current LLM config
- **WHEN** client submits a new `/config/llm` payload
- **THEN** backend persists normalized values and returns the effective runtime config

### Requirement: LLM runtime mode SHALL normalize to API
Generation runtime SHALL operate in OpenAI-compatible API mode.

#### Scenario: Save any LLM mode value
- **WHEN** client submits `mode` in the LLM config payload
- **THEN** backend returns effective `mode=api`

### Requirement: System SHALL persist LLM config in local model_config.json
LLM runtime config SHALL be stored in `backend/storage/model_config.json`.

#### Scenario: Save LLM config
- **WHEN** update API succeeds
- **THEN** backend writes the effective config to `model_config.json`

### Requirement: LLM config SHALL include provider endpoint and correction controls
LLM config SHALL include `base_url`, `api_key`, `model`, `load_profile`, `local_model_id`, `correction_mode`, `correction_batch_size`, and `correction_overlap`.

#### Scenario: Configure OpenAI-compatible provider
- **WHEN** frontend saves provider endpoint, provider API key, and model name
- **THEN** backend persists those values and subsequent online generation requests use them

#### Scenario: Read API key state
- **WHEN** frontend requests current LLM config
- **THEN** response includes `api_key_configured` derived from the stored secret value

### Requirement: Frontend settings SHALL expose online LLM provider parameters
Frontend model configuration for the online LLM SHALL allow users to edit Base URL, provider API Key, model name, load profile, and correction controls from the settings center.

#### Scenario: Open online LLM configuration dialog
- **WHEN** user configures the online LLM entry in settings
- **THEN** dialog shows OpenAI-compatible provider fields and common runtime parameters together

### Requirement: System SHALL expose editable Whisper runtime config API
The system SHALL expose `/config/whisper` read/update endpoints and persist effective values into `backend/storage/config.toml`.

#### Scenario: Read Whisper config
- **WHEN** client requests `/config/whisper`
- **THEN** backend returns current persisted config or normalized defaults
- **AND** the response includes nested Whisper GPU runtime-library status, install directory, environment-configuration flag, missing-file diagnostics, and current install progress snapshot when available

#### Scenario: Save Whisper config
- **WHEN** client updates whisper runtime fields
- **THEN** backend validates and persists effective values in `config.toml`
- **AND** response may include `warnings` and `rollback_applied`

### Requirement: Whisper runtime config SHALL preserve supported device and compute preferences
Whisper config SHALL include `model_default`, `language`, `device`, `compute_type`, `model_load_profile`, `beam_size`, `vad_filter`, `chunk_seconds`, `target_sample_rate`, and `target_channels`.

#### Scenario: Save supported device value
- **WHEN** client submits whisper `device=auto|cpu|cuda`
- **THEN** backend persists and returns the same supported value

#### Scenario: Save unsupported device value
- **WHEN** client submits an unsupported whisper `device`
- **THEN** backend normalizes and returns effective `device=cpu`

#### Scenario: Save unsupported compute type
- **WHEN** client submits unsupported whisper `compute_type`
- **THEN** backend persists normalized `compute_type=int8`

### Requirement: Whisper GPU runtime management SHALL expose editable install config and managed install actions
The system SHALL expose `/config/whisper/runtime-libraries` and `/config/whisper/runtime-libraries/install` so frontend settings can persist an install directory, toggle environment-variable configuration, inspect runtime readiness, and trigger a managed install of the bundled NVIDIA runtime set.

#### Scenario: Save Whisper GPU runtime config
- **WHEN** frontend saves a Whisper GPU runtime-library configuration
- **THEN** backend persists `install_dir` and `auto_configure_env` into `backend/storage/config.toml`
- **AND** backend applies the configured install directory to the current backend process environment when the runtime directory exists

#### Scenario: Start managed Whisper GPU runtime install
- **WHEN** frontend requests `/config/whisper/runtime-libraries/install`
- **THEN** backend launches the bundled installer script from repository root path `scripts/install-whisper-gpu-runtime.ps1`
- **AND** the installer resolves package URLs from NVIDIA official redist manifests instead of hard-coded third-party mirrors
- **AND** the returned runtime-library status exposes install progress, package-level progress text, and final readiness diagnostics

### Requirement: Managed model catalog SHALL expose install and download state for settings UI
The system SHALL expose `/config/models` and related model-management APIs with effective path, default path, install state, and download progress for frontend settings.

#### Scenario: Load model list in settings
- **WHEN** frontend requests `/config/models`
- **THEN** backend returns each model entry with `default_path`, `path`, `is_installed`, `supports_managed_download`, and optional `download` status

### Requirement: Runtime config APIs SHALL ignore unsupported fields
Runtime config APIs SHALL process documented fields and ignore unsupported extra fields in payloads.

#### Scenario: Submit payload with extra unsupported fields
- **WHEN** client sends unknown keys in runtime config update payload
- **THEN** backend ignores unknown keys and keeps effective config consistent
