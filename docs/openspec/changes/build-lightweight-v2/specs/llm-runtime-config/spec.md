## ADDED Requirements

### Requirement: System SHALL expose editable OpenAI-compatible LLM config API
Status: `implemented`

The system SHALL expose `/config/llm` read/update endpoints for the online generation runtime and return persisted effective values.

#### Scenario: Read current LLM config
- **WHEN** client requests `/config/llm`
- **THEN** backend returns effective config including `mode`, `load_profile`, `local_model_id`, `base_url`, `api_key`, `api_key_configured`, `model`, and transcript-correction options

#### Scenario: Update current LLM config
- **WHEN** client submits a new `/config/llm` payload
- **THEN** backend persists normalized values and returns the effective runtime config

### Requirement: LLM runtime mode SHALL normalize to API
Status: `implemented`

Generation runtime SHALL operate in OpenAI-compatible API mode.

#### Scenario: Save any LLM mode value
- **WHEN** client submits `mode` in the LLM config payload
- **THEN** backend returns effective `mode=api`

### Requirement: System SHALL persist LLM config in local model_config.json
Status: `implemented`

LLM runtime config SHALL be stored in `storage/model_config.json`.

#### Scenario: Save LLM config
- **WHEN** update API succeeds
- **THEN** backend writes the effective config to `model_config.json`

### Requirement: LLM config SHALL include provider endpoint and correction controls
Status: `implemented`

LLM config SHALL include `base_url`, `api_key`, `model`, `load_profile`, `local_model_id`, `correction_mode`, `correction_batch_size`, and `correction_overlap`.

#### Scenario: Configure OpenAI-compatible provider
- **WHEN** frontend saves provider endpoint, provider API key, and model name
- **THEN** backend persists those values and subsequent online generation requests use them

#### Scenario: Read API key state
- **WHEN** frontend requests current LLM config
- **THEN** response includes `api_key_configured` derived from the stored secret value

#### Scenario: Save out-of-range correction controls
- **WHEN** frontend submits `correction_batch_size` or `correction_overlap` outside the supported integer range
- **THEN** backend clamps the persisted values into the supported bounds before returning the effective config

### Requirement: Frontend settings SHALL expose online LLM provider parameters together with correction controls
Status: `implemented`

Frontend model configuration for `llm-default` SHALL allow users to switch between `Ollama` and `在线 API`, edit Base URL, provider API Key, model name, load profile, and keep transcript-correction controls in the same settings workflow.

#### Scenario: Open online LLM configuration dialog
- **WHEN** user configures the online LLM entry in settings
- **THEN** dialog shows OpenAI-compatible provider fields and common runtime parameters together
- **AND** the same dialog keeps `文本纠错模式`、`批大小`、`重叠窗口` controls visible for `llm-default`

### Requirement: UI settings SHALL expose Study translation defaults for LLM-backed translation decisions
Status: `implemented`

Frontend UI settings SHALL persist a normalized `study_default_translation_target` value so the study-first workbench can decide whether subtitle fallback translation may request the configured LLM runtime.

#### Scenario: Read UI settings for the Study workbench
- **WHEN** frontend requests `/config/ui`
- **THEN** backend returns `study_default_translation_target` together with other UI settings
- **AND** the value is `null` when the user has not configured a default Study translation language

#### Scenario: Save empty or blank Study translation target
- **WHEN** frontend updates `/config/ui` with an empty or whitespace-only `study_default_translation_target`
- **THEN** backend normalizes the persisted value to `null`
- **AND** study-first translation fallback keeps the LLM translation path disabled unless a platform translation track is already available

#### Scenario: Preserve legacy Study translation target values across UI updates
- **WHEN** frontend reads or re-saves `/config/ui` and the persisted `study_default_translation_target` contains a non-empty legacy value outside the current preset list
- **THEN** backend keeps that normalized value unchanged instead of coercing it into another preset
- **AND** frontend contracts remain able to surface the current value for migration without silently dropping the saved setting

#### Scenario: Enable source-specific online subtitle acquisition without new runtime fields
- **WHEN** backend enables `yt-dlp`-first subtitle acquisition for online `youtube` tasks and Bilibili-login-first AI subtitle acquisition for online `bilibili` tasks
- **THEN** existing `/config/llm` and `/config/ui` contracts remain unchanged
- **AND** the persisted `study_default_translation_target` continues to affect only later Study translation decisions rather than introducing new LLM or Whisper runtime config fields

### Requirement: Settings config surface SHALL expose dedicated Bilibili auth routes without leaking cookies
Status: `implemented`

The config surface SHALL expose dedicated Bilibili auth routes through `/config/bilibili-auth`、`/config/bilibili-auth/qrcode/start`、`/config/bilibili-auth/qrcode/poll`、and `/config/bilibili-auth/session`. This auth state remains separate from `/config/ui`、`/config/llm`、and model-routing config.

#### Scenario: Read Bilibili auth status from settings
- **WHEN** frontend requests `/config/bilibili-auth`
- **THEN** backend returns status, account summary, pending QR metadata, and timestamp fields needed by settings
- **AND** the response does not include raw cookie values

#### Scenario: Persist Bilibili auth state only on backend local storage
- **WHEN** backend starts QR login, completes polling, or marks the Bilibili session expired
- **THEN** backend persists the normalized auth snapshot under local backend storage
- **AND** raw cookies remain available only to backend services that call Bilibili
- **AND** frontend never reads or stores those cookie values

### Requirement: LLM runtime SHALL stay synchronized with the managed `llm-default` entry
Status: `implemented`

Persisted `/config/llm` runtime values SHALL remain aligned with the `llm-default` model entry while continuing to own transcript-correction controls.

#### Scenario: Save `llm-default` with Ollama provider
- **WHEN** frontend updates `llm-default` through `/config/models` with `provider=ollama`
- **THEN** backend synchronizes `/config/llm.base_url` to `<configured_ollama_base_url>/v1`
- **AND** `/config/llm.model` follows the configured Ollama `model_id`
- **AND** `/config/llm.api_key` is normalized to a non-empty local placeholder so the OpenAI-compatible Ollama endpoint can be called without a user-supplied secret

#### Scenario: Save `llm-default` with online API provider
- **WHEN** frontend updates `llm-default` through `/config/models` with `provider=openai_compatible`
- **THEN** backend synchronizes `/config/llm.base_url` and `/config/llm.model` from `api_base_url` and `api_model`
- **AND** existing correction controls in `/config/llm` remain effective

### Requirement: System SHALL expose Ollama runtime config with managed restart hooks
Status: `implemented`

The system SHALL expose `/config/ollama`、`/config/ollama/migrate-models` and `/config/ollama/restart-service` so frontend settings can inspect the platform-default Ollama install location, manage the model directory and service base URL, and read current runtime status.

#### Scenario: Read current Ollama runtime config
- **WHEN** client requests `/config/ollama`
- **THEN** backend returns `install_dir`, `executable_path`, `models_dir`, and `base_url`
- **AND** response includes a nested `service` block with current reachability, configured model directory, effective model directory, `can_self_restart`, and a backend-supplied status message
- **AND** path fields are normalized as absolute filesystem paths

#### Scenario: Save current Ollama runtime config
- **WHEN** client updates `/config/ollama`
- **THEN** backend persists the effective runtime config into `storage/ollama-runtime.json`
- **AND** submitted `install_dir` and `executable_path` do not override the platform-default Ollama runtime location returned by the backend
- **AND** subsequent Ollama-backed model path resolution uses the configured `models_dir`
- **AND** backend refreshes the probe result returned in the `service` block
- **AND** when managed `llm-default` currently uses Ollama, backend synchronizes `/config/llm.base_url` to `<configured_ollama_base_url>/v1`

#### Scenario: Update Ollama model directory configuration
- **WHEN** client posts `/config/ollama/migrate-models` with a new target directory
- **THEN** backend updates the persisted `models_dir` pointer when the target differs from the current config
- **AND** response explicitly states that existing Ollama model files still require manual migration
- **AND** current TS runtime does not move model files on behalf of the user

#### Scenario: Refresh Ollama service state after runtime changes
- **WHEN** client posts `/config/ollama/restart-service`
- **THEN** backend returns the refreshed probe status together with the persisted runtime config
- **AND** on supported local runtimes, backend restarts `ollama serve` with the configured executable path, service address, and `OLLAMA_MODELS`
- **AND** on Windows, backend stops both the active `ollama.exe` server process and the companion `ollama app.exe` tray process before relaunch so the configured `models_dir` can actually take effect
- **AND** when the configured local loopback port `127.0.0.1:11434` is occupied by another process, backend attempts to identify and terminate the occupying process before retrying Ollama on the same port
- **AND** when Windows itself restricts or reserves `127.0.0.1:11434`, backend keeps the persisted `base_url` unchanged and returns a clear bind-failure message instead of switching to another port
- **AND** when self-managed restart is unavailable, response keeps `can_self_restart=false` and explains the required manual action

### Requirement: System SHALL expose editable Whisper runtime config API
Status: `implemented`

The system SHALL expose `/config/whisper` read/update endpoints and persist effective values into `storage/config.toml`.

#### Scenario: Read Whisper config
- **WHEN** client requests `/config/whisper`
- **THEN** backend returns current persisted config or normalized defaults
- **AND** when `storage/config.toml` is absent, normalized defaults include `chunk_seconds=30`
- **AND** the response includes nested `runtime_libraries` status derived from current executable and model detection

#### Scenario: Save Whisper config
- **WHEN** client updates whisper runtime fields
- **THEN** backend validates and persists effective values in `config.toml`
- **AND** response may include `warnings` and `rollback_applied`

### Requirement: Whisper runtime config SHALL preserve supported device and compute preferences without implying managed runtime install
Status: `partial`

Whisper config SHALL include `model_default`, `language`, `device`, `compute_type`, `model_load_profile`, `beam_size`, `vad_filter`, `chunk_seconds`, `target_sample_rate`, and `target_channels`.

#### Scenario: Save supported device value
- **WHEN** client submits whisper `device=auto|cpu|cuda`
- **THEN** backend persists and returns the same supported value after normalization

#### Scenario: Save unsupported compute type
- **WHEN** client submits unsupported whisper `compute_type`
- **THEN** backend persists normalized `compute_type=int8`

#### Scenario: Read Whisper runtime readiness
- **WHEN** frontend requests `/config/whisper`
- **THEN** backend reports whether the local Python runtime, `faster-whisper` probe, and the configured model path are ready
- **AND** current TS runtime does not expose managed Whisper model download, Python dependency installation, or managed CUDA runtime installation endpoints

### Requirement: Managed model catalog SHALL expose routing and readiness state for settings UI
Status: `implemented`

The system SHALL expose `/config/models` and related model-management APIs with effective path, default path, provider, runtime toggles, online API parameters, install state, and optional download snapshots for frontend settings.

#### Scenario: Load model list in settings
- **WHEN** frontend requests `/config/models`
- **THEN** backend returns each model entry with `provider`, `model_id`, `default_path`, `path`, `is_installed`, `supports_managed_download`, and optional `download` status
- **AND** online-capable entries also expose `api_base_url`, `api_key_configured`, `api_model`, and `api_timeout_seconds`
- **AND** each entry includes `size_bytes` from the current runtime source instead of a synthesized display path

### Requirement: Managed model catalog SHALL support provider-specific routing with absolute local paths
Status: `implemented`

The system SHALL keep `whisper-default` on the local runtime path, and allow `llm-default`, `embedding-default`, and `rerank-default` to switch between `Ollama` and `在线 API`. All returned local paths SHALL use absolute filesystem paths rather than logical URI forms.

#### Scenario: Load Ollama-backed model entries
- **WHEN** frontend requests `/config/models`
- **THEN** Ollama-backed entries expose `path` and `default_path` as absolute paths resolved under the configured Ollama `models_dir`
- **AND** backend derives `is_installed` from live Ollama tag discovery or the remote-ready contract rather than from a synthesized filesystem path or managed pull job

#### Scenario: Resolve managed model sizes from live runtime sources
- **WHEN** frontend requests `/config/models`
- **THEN** Ollama-backed entries derive `size_bytes` from the live `/api/tags` response returned by the configured Ollama service when that service is reachable
- **AND** if the configured Ollama service is unreachable but the configured `models_dir` still contains valid local manifest and blob files, backend derives `is_installed=true` and `size_bytes` from those local Ollama artifacts
- **AND** the same offline fallback does not upgrade Ollama-backed entries to `ready`; readiness still reflects current service reachability
- **AND** local entries such as `whisper-default` derive `size_bytes` by measuring the effective filesystem path recursively when it exists
- **AND** backend returns `size_bytes=0` when the runtime source is unavailable or the effective local path does not exist

#### Scenario: Run runtime diagnostics for retrieval models
- **WHEN** backend executes system self-check for managed retrieval models
- **THEN** it verifies `embedding-default` and `rerank-default` independently against the current managed model catalog
- **AND** Ollama-backed entries use the current Ollama tag discovery result for readiness instead of assuming that a configured local path alone means the model is available

#### Scenario: Accept equivalent Ollama model aliases during retrieval self-check
- **WHEN** `embedding-default` or `rerank-default` is configured with an Ollama model id such as `bge-m3`
- **AND** the reachable OpenAI-compatible `/models` response reports the same model through an equivalent alias such as `bge-m3:latest` or a registry-prefixed variant
- **THEN** backend treats the configured id and the reported alias as the same managed model
- **AND** the retrieval self-check reports `check_depth=model_verified` instead of a false missing-model result

#### Scenario: Configure remote API routing for model entries
- **WHEN** frontend updates `llm-default`, `embedding-default`, or `rerank-default` with `provider=openai_compatible`
- **THEN** backend persists `api_base_url`, `api_key`, `api_model`, and `api_timeout_seconds`
- **AND** the entry becomes `is_installed=true` only when base URL, API key, model name, and enabled state together satisfy the remote-ready contract

#### Scenario: Normalize loopback OpenAI-compatible routing without a user secret
- **WHEN** frontend configures `llm-default`、`embedding-default`、`rerank-default`, or `vlm-default` to a loopback OpenAI-compatible endpoint such as `http://127.0.0.1:11434/v1`
- **AND** the submitted payload leaves `api_key` empty
- **THEN** backend normalizes a non-empty local placeholder API key into the effective runtime snapshot
- **AND** the shared model catalog keeps the entry callable for local loopback runtimes without implying that a remote provider secret was configured

### Requirement: Managed model catalog SHALL expose `vlm-default` routing for visual inference
Status: `implemented`

The model catalog SHALL expose `vlm-default` as a first-class configurable component in settings so VQA visual stages can bind to a managed model entry.

#### Scenario: Load VLM entry in settings
- **WHEN** frontend requests `/config/models`
- **THEN** response includes the `vlm-default` entry with provider, model_id, routing fields, and readiness flags aligned to shared contracts
- **AND** UI shows the VLM entry in the same model configuration workflow as LLM/embedding/rerank

#### Scenario: Auto-adopt local Ollama vision model for `vlm-default`
- **WHEN** frontend requests `/config/models`
- **AND** the configured Ollama runtime already exposes an installed vision-capable model
- **AND** persisted `vlm-default` still points to the baseline remote default routing
- **THEN** backend normalizes `vlm-default.provider=ollama`
- **AND** `model_id` and `api_model` follow the preferred local vision model discovered from Ollama tags
- **AND** `api_base_url` follows `<configured_ollama_base_url>/v1`
- **AND** `api_key` is normalized to a non-empty local placeholder so loopback OpenAI-compatible calls work without a user-supplied secret

#### Scenario: Configure remote API routing for `vlm-default`
- **WHEN** frontend updates `vlm-default` with `provider=openai_compatible`
- **THEN** backend persists `api_base_url`, `api_key`, `api_model`, and `api_timeout_seconds` for visual inference routing
- **AND** the catalog keeps the explicit remote routing instead of auto-replacing it with an Ollama model

#### Scenario: Configure default rerank output count from settings
- **WHEN** frontend loads or updates the `rerank-default` model entry through `/config/models`
- **THEN** backend exposes `rerank_top_n` as an integer configuration field
- **AND** the field accepts values in the documented bounded runtime range
- **AND** VQA search, analysis, and streaming chat use the persisted `rerank_top_n` as the default final candidate count whenever the client request does not override `top_k`

#### Scenario: Save out-of-range model tuning integers
- **WHEN** frontend updates bounded integer fields such as `rerank_top_n` or `api_timeout_seconds` with unsupported values
- **THEN** backend clamps each persisted field into the corresponding supported integer range before returning the refreshed model catalog

#### Scenario: Read legacy or corrupted model catalog values
- **WHEN** frontend requests `/config/models`
- **AND** persisted catalog entries contain out-of-range bounded integers or stale legacy values
- **THEN** backend normalizes bounded integer fields such as `max_batch_size`, `rerank_top_n`, and `api_timeout_seconds` into the supported runtime ranges before responding
- **AND** the returned catalog remains consumable by the shared contracts schema without leaking invalid numeric payloads to the settings UI

### Requirement: Managed model actions SHALL return descriptive snapshots when the runtime is not self-managed
Status: `implemented`

The `/config/models/:modelId/download` family SHALL keep frontend status copy aligned with current runtime behavior even when actual managed pull is unavailable.

#### Scenario: Request download for an already ready model
- **WHEN** frontend requests `/config/models/{model_id}/download` for a model that is already ready
- **THEN** backend returns a completed download snapshot explaining that no repeated action is required

#### Scenario: Request download for a non-ready local or Ollama-backed model
- **WHEN** frontend requests `/config/models/{model_id}/download` for a model that is not yet ready
- **THEN** backend returns a failed or explanatory download snapshot describing the required manual preparation path
- **AND** current TS runtime does not start `Ollama pull` or managed Whisper model download jobs

#### Scenario: Request bulk local-model migration
- **WHEN** frontend posts `/config/models/migrate-local`
- **THEN** backend returns the current placeholder migration result
- **AND** current TS runtime does not move local model directories automatically

### Requirement: Runtime config APIs SHALL ignore unsupported fields
Status: `implemented`

Runtime config APIs SHALL process documented fields and ignore unsupported extra fields in payloads.

#### Scenario: Submit payload with extra unsupported fields
- **WHEN** client sends unknown keys in runtime config update payload
- **THEN** backend ignores unknown keys and keeps effective config consistent
