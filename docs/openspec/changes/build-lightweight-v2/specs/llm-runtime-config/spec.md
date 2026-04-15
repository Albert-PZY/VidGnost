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
Frontend model configuration for `llm-default` SHALL allow users to switch between `Ollama` and `在线 API`, edit Base URL, provider API Key, model name, load profile, and keep transcript-correction controls in the same settings workflow.

#### Scenario: Open online LLM configuration dialog
- **WHEN** user configures the online LLM entry in settings
- **THEN** dialog shows OpenAI-compatible provider fields and common runtime parameters together
- **AND** the same dialog keeps `文本纠错模式`、`批大小`、`重叠窗口` controls visible for `llm-default`

### Requirement: LLM runtime SHALL stay synchronized with the managed `llm-default` entry
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

### Requirement: System SHALL expose editable Ollama runtime config and migration APIs
The system SHALL expose `/config/ollama` and `/config/ollama/migrate-models` so frontend settings can manage the Ollama install location, executable path, model directory, service base URL, and migration of existing model files.

#### Scenario: Read current Ollama runtime config
- **WHEN** client requests `/config/ollama`
- **THEN** backend returns `install_dir`, `executable_path`, `models_dir`, and `base_url`
- **AND** response includes a nested `service` block with current reachability, detected process metadata, configured model directory, effective model directory, and whether restart is required
- **AND** path fields are normalized as absolute filesystem paths

#### Scenario: Save current Ollama runtime config
- **WHEN** client updates `/config/ollama`
- **THEN** backend persists the effective runtime config into `backend/storage/ollama-runtime.json`
- **AND** subsequent Ollama-backed model path resolution uses the configured `models_dir`
- **AND** backend synchronizes the local process and Windows environment entries for `PATH` and `OLLAMA_MODELS` against the saved install directory and model directory
- **AND** if `llm-default` currently uses `provider=ollama`, backend re-synchronizes `/config/llm` against the updated Ollama service address

#### Scenario: Migrate existing Ollama model directory
- **WHEN** client posts `/config/ollama/migrate-models` with a new target directory
- **THEN** backend safely moves the existing Ollama model directory when needed
- **AND** backend rejects unsafe nested source-target moves
- **AND** backend updates the persisted Ollama runtime config to the new absolute target directory
- **AND** response includes the refreshed `service` state so frontend can immediately tell whether the running Ollama process is already using the new directory

#### Scenario: Restart local Ollama service after runtime changes
- **WHEN** client posts `/config/ollama/restart-service`
- **THEN** backend stops the current local Ollama service-related processes, including the tray application when present
- **AND** backend waits until the configured service port is fully released before launching a new local Ollama process
- **AND** backend starts the local Ollama process with the configured `OLLAMA_MODELS` directory and host binding when self-managed restart is available
- **AND** backend returns the current runtime config plus refreshed `service` status after the reachability check succeeds

### Requirement: System SHALL expose editable Whisper runtime config API
The system SHALL expose `/config/whisper` read/update endpoints and persist effective values into `backend/storage/config.toml`.

#### Scenario: Read Whisper config
- **WHEN** client requests `/config/whisper`
- **THEN** backend returns current persisted config or normalized defaults
- **AND** the response includes nested transcription CUDA runtime-library status, install directory, environment-configuration flag, missing-file diagnostics, and current install progress snapshot when available

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

### Requirement: Whisper GPU runtime detection SHALL reuse Ollama bundled CUDA libraries
The system SHALL surface Whisper GPU runtime readiness through `/config/whisper`, automatically discover compatible CUDA runtime directories inside the configured Ollama install directory, and stop exposing separate Whisper runtime install endpoints.

#### Scenario: Read Whisper GPU runtime readiness
- **WHEN** frontend requests `/config/whisper`
- **THEN** backend inspects the configured Ollama install directory for the required CUDA and cuDNN runtime files
- **AND** backend updates the current backend process environment with the discovered runtime directories when available
- **AND** the response includes readiness, discovered runtime directory, missing-file diagnostics, and loadability details through `runtime_libraries`

#### Scenario: Enable Whisper GPU mode
- **WHEN** frontend saves whisper `device=auto|cuda`
- **THEN** backend accepts the device value only when the detected Ollama bundled runtime is ready for GPU execution
- **AND** task preflight returns a conflict response when GPU mode is requested but the Ollama bundled runtime is unavailable

### Requirement: Managed model catalog SHALL expose install, routing, and online API state for settings UI
The system SHALL expose `/config/models` and related model-management APIs with effective path, default path, provider, runtime toggles, online API parameters, install state, and download progress for frontend settings.

#### Scenario: Load model list in settings
- **WHEN** frontend requests `/config/models`
- **THEN** backend returns each model entry with `provider`, `model_id`, `default_path`, `path`, `is_installed`, `supports_managed_download`, and optional `download` status
- **AND** online-capable entries also expose `api_base_url`, `api_key_configured`, `api_model`, `api_timeout_seconds`, and image-upload bounds when the component can send images
- **AND** backend may additionally return an inferred effective protocol marker for diagnostics, but frontend settings do not require a manual protocol selector

### Requirement: Managed model catalog SHALL support provider-specific routing with absolute local paths
The system SHALL keep `whisper-default` on the managed local runtime path, allow `llm-default`, `embedding-default`, `vlm-default`, and `rerank-default` to switch between `Ollama` and `在线 API`, and expose `mllm-default` as a dedicated online multimodal entry. All returned local paths SHALL use absolute filesystem paths rather than logical URI forms.

#### Scenario: Load Ollama-backed model entries
- **WHEN** frontend requests `/config/models`
- **THEN** `llm-default`, `embedding-default`, `vlm-default`, and `rerank-default` return `provider=ollama`
- **AND** installed entries expose `path` and `default_path` as absolute paths resolved under the configured Ollama `models_dir`
- **AND** backend derives `is_installed` and readiness from the local Ollama tags state or the configured manifest directories on disk when the service has not yet returned `/api/tags`
- **AND** `whisper-default` continues to report install state from the managed local runtime directory

#### Scenario: Load Whisper entry before local files exist
- **WHEN** frontend requests `/config/models` and `whisper-default` has not been prepared locally
- **THEN** backend returns `path=""`
- **AND** `default_path` still exposes the managed absolute install target directory for that component

#### Scenario: Configure remote API routing for model entries
- **WHEN** frontend updates `llm-default`, `embedding-default`, `vlm-default`, `rerank-default`, or `mllm-default` with `provider=openai_compatible`
- **THEN** backend persists `api_base_url`, `api_key`, `api_model`, and `api_timeout_seconds`
- **AND** backend infers the effective remote protocol from the configured service endpoint and model component type
- **AND** image-capable entries additionally persist `api_image_max_bytes` and `api_image_max_edge`
- **AND** the entry becomes `is_installed=true` only when base URL, API key, model name, and enabled state together satisfy the remote-ready contract

#### Scenario: Start managed model download for Ollama-backed entries
- **WHEN** frontend requests `/config/models/{model_id}/download` for `llm-default`, `embedding-default`, `vlm-default`, or `rerank-default`
- **THEN** backend starts `Ollama pull` for the configured managed model id
- **AND** download progress is merged back into subsequent `/config/models` responses
- **AND** completion marks the entry ready without copying model weights into `backend/storage/model-hub`

#### Scenario: Skip duplicate pull when current Ollama already recognizes the model
- **WHEN** frontend requests `/config/models/{model_id}/download` for an Ollama-backed managed entry and the active Ollama service already exposes that model in `/api/tags`
- **THEN** backend returns a completed download snapshot explaining that no new pull is required
- **AND** backend does not start an additional `Ollama pull` job

#### Scenario: Block duplicate pull when files exist but the service has not switched directories
- **WHEN** frontend requests `/config/models/{model_id}/download` for an Ollama-backed managed entry and the model files already exist under the configured `models_dir` but the current Ollama service is still using another directory or is not yet running
- **THEN** backend returns a failed download snapshot with guidance to start or restart Ollama first
- **AND** backend does not issue a redundant `Ollama pull`

#### Scenario: Batch migrate local-directory model entries
- **WHEN** frontend posts `/config/models/migrate-local` with a target root directory
- **THEN** backend plans a single bulk migration for configured Whisper local directories and installed Ollama-managed model storage under the configured `models_dir`
- **AND** backend moves each `provider=local` model path into a component-specific subdirectory under the target root when that move is safe
- **AND** backend rewrites the affected model `path` fields and Ollama runtime `models_dir` to the new absolute filesystem locations
- **AND** backend requests confirmation before continuing when active analysis tasks are still running
- **AND** backend restarts the local Ollama service when self-managed restart is available so the migrated model directory takes effect immediately
- **AND** entries already inside the target root, missing source paths, or conflicting with existing targets are reported as skipped rather than overwritten

#### Scenario: Configure VLM frame sampling interval from settings
- **WHEN** frontend loads or updates the `vlm-default` model entry through `/config/models`
- **THEN** backend exposes `frame_interval_seconds` as an integer configuration field
- **AND** the field accepts values in the documented bounded runtime range
- **AND** subsequent frame extraction for VQA evidence generation uses the persisted interval value instead of a hard-coded sampling cadence

#### Scenario: Configure default rerank output count from settings
- **WHEN** frontend loads or updates the `rerank-default` model entry through `/config/models`
- **THEN** backend exposes `rerank_top_n` as an integer configuration field
- **AND** the field accepts values in the documented bounded runtime range
- **AND** VQA search, analysis, and streaming chat use the persisted `rerank_top_n` as the default final candidate count whenever the client request does not override `top_k`

### Requirement: VQA runtime SHALL support remote multimodal retrieval when compatible models are configured
The VQA runtime SHALL open a joint text-image retrieval route when `mllm-default` is ready and `embedding-default` supports multimodal remote embedding, and SHALL otherwise fall back to the original text-oriented route.

#### Scenario: Use the multimodal retrieval route
- **WHEN** `mllm-default` is enabled with a complete online API config and `embedding-default` is configured with a multimodal-compatible remote protocol
- **THEN** backend prepares retrieval documents with transcript text plus keyframe image content
- **AND** dense embedding, rerank, and answer generation reuse those joint text-image inputs
- **AND** answer generation may attach up to the bounded number of encoded keyframes to the final multimodal chat request

#### Scenario: Fall back to the text retrieval route
- **WHEN** `mllm-default` is unavailable or the embedding entry does not support multimodal remote embedding
- **THEN** backend keeps the original transcript-plus-visual-description vectorization route
- **AND** VLM frame descriptions and text-vector retrieval continue to drive the downstream RAG chain

#### Scenario: Send bounded image payloads to remote vision-capable APIs
- **WHEN** backend sends keyframes to a remote `vlm`, `rerank`, `embedding`, or `mllm` entry
- **THEN** backend encodes images as base64 or data-URL payloads compatible with the selected provider
- **AND** backend compresses oversized images toward the configured `api_image_max_bytes` and `api_image_max_edge` bounds before upload
- **AND** provider-specific protocol differences such as Alibaba Bailian embedding or rerank payload shape are normalized behind the runtime client
- **AND** OpenAI-compatible vision providers that require a single `user` message with `content[]` receive a normalized multimodal request shape even when the internal prompt builder starts from `system + user` messages

### Requirement: Runtime config APIs SHALL ignore unsupported fields
Runtime config APIs SHALL process documented fields and ignore unsupported extra fields in payloads.

#### Scenario: Submit payload with extra unsupported fields
- **WHEN** client sends unknown keys in runtime config update payload
- **THEN** backend ignores unknown keys and keeps effective config consistent
