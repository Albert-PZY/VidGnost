from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ModelSize = Literal["small", "medium"]
WorkflowType = Literal["notes", "vqa"]
TaskStatusPublic = Literal["queued", "running", "paused", "completed", "failed", "cancelled"]
SourceType = Literal["bilibili", "local_file", "local_path"]
PromptTemplateChannel = Literal["correction", "notes", "mindmap", "vqa"]
ModelComponentType = Literal["whisper", "llm", "embedding", "vlm", "rerank", "mllm"]
ModelRuntimeStatus = Literal["ready", "loading", "not_ready", "error"]
ModelDownloadState = Literal["idle", "downloading", "completed", "cancelled", "failed"]
BackgroundImageFillMode = Literal["cover", "contain", "repeat", "center"]


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str
    speaker: str | None = None


class TaskStepItem(BaseModel):
    id: str
    name: str
    status: Literal["pending", "processing", "completed", "error"]
    progress: int = Field(default=0, ge=0, le=100)
    duration: str = ""
    logs: list[str] = Field(default_factory=list)


class TaskCreateFromUrlRequest(BaseModel):
    url: str = Field(min_length=2)
    model_size: ModelSize = "small"
    language: str = "zh"
    workflow: WorkflowType = "notes"


class TaskCreateFromPathRequest(BaseModel):
    local_path: str = Field(min_length=1)
    model_size: ModelSize = "small"
    language: str = "zh"
    workflow: WorkflowType = "notes"


class TaskCreateResponse(BaseModel):
    task_id: str
    status: TaskStatusPublic | str
    workflow: WorkflowType = "notes"
    initial_steps: list[TaskStepItem] = Field(default_factory=list)


class TaskBatchCreateResponse(BaseModel):
    strategy: Literal["single_task_per_file", "batch_task"]
    tasks: list[TaskCreateResponse] = Field(default_factory=list)


class TaskSummaryItem(BaseModel):
    id: str
    title: str | None
    workflow: WorkflowType = "notes"
    source_type: SourceType
    source_input: str
    status: TaskStatusPublic | str
    progress: int
    file_size_bytes: int = 0
    duration_seconds: float | None = None
    created_at: datetime
    updated_at: datetime


class TaskListResponse(BaseModel):
    items: list[TaskSummaryItem]
    total: int


class TaskStatsResponse(BaseModel):
    total: int = 0
    notes: int = 0
    vqa: int = 0
    completed: int = 0


class TaskRecentItem(BaseModel):
    id: str
    title: str
    workflow: WorkflowType
    duration_seconds: float | None = None
    updated_at: datetime


class TaskRecentResponse(BaseModel):
    items: list[TaskRecentItem] = Field(default_factory=list)


class TaskDetailResponse(BaseModel):
    id: str
    title: str | None
    workflow: WorkflowType = "notes"
    source_type: SourceType
    source_input: str
    source_local_path: str | None = None
    language: str
    model_size: str
    status: TaskStatusPublic | str
    progress: int
    overall_progress: int = 0
    eta_seconds: int | None = None
    current_step_id: str = ""
    steps: list[TaskStepItem] = Field(default_factory=list)
    error_message: str | None = None
    duration_seconds: float | None = None
    transcript_text: str | None = None
    transcript_segments: list[TranscriptSegment] = Field(default_factory=list)
    summary_markdown: str | None = None
    mindmap_markdown: str | None = None
    notes_markdown: str | None = None
    fusion_prompt_markdown: str | None = None
    stage_logs: dict[str, list[str]] = Field(default_factory=dict)
    stage_metrics: dict[str, dict[str, object]] = Field(default_factory=dict)
    vm_phase_metrics: dict[str, dict[str, object]] = Field(default_factory=dict)
    artifact_total_bytes: int = 0
    artifact_index: list[dict[str, object]] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class TaskTitleUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=180)


class TaskArtifactsUpdateRequest(BaseModel):
    summary_markdown: str | None = None
    notes_markdown: str | None = None
    mindmap_markdown: str | None = None


class VQASearchRequest(BaseModel):
    query_text: str | None = Field(default=None, min_length=1)
    question: str | None = Field(default=None, min_length=1)
    task_id: str | None = None
    video_paths: list[str] = Field(default_factory=list)
    top_k: int | None = Field(default=None, ge=1, le=50)


class VQAChatRequest(BaseModel):
    query_text: str | None = Field(default=None, min_length=1)
    question: str | None = Field(default=None, min_length=1)
    task_id: str | None = None
    video_paths: list[str] = Field(default_factory=list)
    top_k: int | None = Field(default=None, ge=1, le=50)
    stream: bool = True


class VQAAnalyzeRequest(BaseModel):
    query_text: str | None = Field(default=None, min_length=1)
    question: str | None = Field(default=None, min_length=1)
    task_id: str | None = None
    video_paths: list[str] = Field(default_factory=list)
    top_k: int | None = Field(default=None, ge=1, le=50)


class HealthResponse(BaseModel):
    status: Literal["ok"]
    app: str
    version: str


class LLMConfigResponse(BaseModel):
    mode: Literal["api"] = "api"
    load_profile: Literal["balanced", "memory_first"] = "balanced"
    local_model_id: str
    api_key: str
    api_key_configured: bool = False
    base_url: str
    model: str
    correction_mode: Literal["off", "strict", "rewrite"]
    correction_batch_size: int = Field(ge=6, le=80)
    correction_overlap: int = Field(ge=0, le=20)


class LLMConfigUpdateRequest(BaseModel):
    mode: Literal["api"] = "api"
    load_profile: Literal["balanced", "memory_first"] = "balanced"
    local_model_id: str = "Qwen/Qwen2.5-7B-Instruct"
    api_key: str = ""
    base_url: str = ""
    model: str = ""
    correction_mode: Literal["off", "strict", "rewrite"] = "strict"
    correction_batch_size: int = Field(default=24, ge=6, le=80)
    correction_overlap: int = Field(default=3, ge=0, le=20)


class PromptTemplateItem(BaseModel):
    id: str
    channel: PromptTemplateChannel
    name: str
    content: str
    is_default: bool = False
    created_at: datetime
    updated_at: datetime


class PromptTemplateBundleResponse(BaseModel):
    templates: list[PromptTemplateItem] = Field(default_factory=list)
    selection: dict[PromptTemplateChannel, str] = Field(default_factory=dict)
    summary_templates: list[PromptTemplateItem] = Field(default_factory=list)
    mindmap_templates: list[PromptTemplateItem] = Field(default_factory=list)
    selected_summary_template_id: str = ""
    selected_mindmap_template_id: str = ""


class PromptTemplateCreateRequest(BaseModel):
    channel: PromptTemplateChannel
    name: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1)


class PromptTemplateUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1)


class PromptTemplateSelectionUpdateRequest(BaseModel):
    correction: str | None = None
    notes: str | None = None
    mindmap: str | None = None
    vqa: str | None = None


class WhisperRuntimeLibrariesProgressResponse(BaseModel):
    state: Literal["idle", "installing", "paused", "completed", "failed"] = "idle"
    message: str = ""
    current_package: str = ""
    downloaded_bytes: int = 0
    total_bytes: int = 0
    percent: float = Field(default=0.0, ge=0.0, le=100.0)
    speed_bps: float = Field(default=0.0, ge=0.0)
    resumable: bool = False
    updated_at: str = ""


class WhisperRuntimeLibrariesResponse(BaseModel):
    install_dir: str
    auto_configure_env: bool = True
    version_label: str
    platform_supported: bool = True
    ready: bool = False
    status: Literal["ready", "not_ready", "installing", "paused", "failed", "unsupported"] = "not_ready"
    message: str = ""
    bin_dir: str = ""
    missing_files: list[str] = Field(default_factory=list)
    discovered_files: dict[str, str] = Field(default_factory=dict)
    load_error: str = ""
    path_configured: bool = False
    progress: WhisperRuntimeLibrariesProgressResponse = Field(default_factory=WhisperRuntimeLibrariesProgressResponse)


class WhisperConfigResponse(BaseModel):
    model_default: str
    language: str
    device: str
    compute_type: str
    model_load_profile: Literal["balanced", "memory_first"] = "balanced"
    beam_size: int
    vad_filter: bool
    chunk_seconds: int
    target_sample_rate: int
    target_channels: int
    runtime_libraries: WhisperRuntimeLibrariesResponse
    warnings: list[str] = Field(default_factory=list)
    rollback_applied: bool = False


class WhisperConfigUpdateRequest(BaseModel):
    model_default: Literal["small", "medium"] = "small"
    language: str = "zh"
    device: str = "auto"
    compute_type: str = "int8"
    model_load_profile: Literal["balanced", "memory_first"] = "balanced"
    beam_size: int = Field(default=5, ge=1, le=12)
    vad_filter: bool = True
    chunk_seconds: int = Field(default=180, ge=30, le=1200)
    target_sample_rate: int = Field(default=16000, ge=8000, le=48000)
    target_channels: int = Field(default=1, ge=1, le=2)


class WhisperRuntimeLibrariesUpdateRequest(BaseModel):
    install_dir: str = ""
    auto_configure_env: bool = True


class WhisperRuntimeLibrariesInstallRequest(BaseModel):
    install_dir: str | None = None
    auto_configure_env: bool | None = None


class OllamaRuntimeConfigResponse(BaseModel):
    service: "OllamaServiceStatusResponse"
    install_dir: str
    executable_path: str
    models_dir: str
    base_url: str


class OllamaRuntimeConfigUpdateRequest(BaseModel):
    install_dir: str = ""
    executable_path: str = ""
    models_dir: str = ""
    base_url: str = ""


class OllamaModelsMigrationRequest(BaseModel):
    target_dir: str = Field(min_length=1)


class OllamaModelsMigrationResponse(BaseModel):
    service: "OllamaServiceStatusResponse"
    source_dir: str
    target_dir: str
    moved: bool = False
    message: str = ""
    warnings: list[str] = Field(default_factory=list)


class OllamaServiceStatusResponse(BaseModel):
    reachable: bool = False
    process_detected: bool = False
    process_id: int | None = None
    executable_path: str = ""
    configured_models_dir: str = ""
    effective_models_dir: str = ""
    models_dir_source: Literal["env", "default", "unknown"] = "unknown"
    using_configured_models_dir: bool = False
    restart_required: bool = False
    can_self_restart: bool = False
    message: str = ""


class LocalModelsMigrationRequest(BaseModel):
    target_root: str = Field(min_length=1)


class LocalModelsMigrationResponse(BaseModel):
    target_root: str
    moved: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ModelDownloadStatus(BaseModel):
    state: ModelDownloadState = "idle"
    message: str = ""
    current_file: str = ""
    downloaded_bytes: int = 0
    total_bytes: int = 0
    percent: float = Field(default=0.0, ge=0.0, le=100.0)
    speed_bps: float = Field(default=0.0, ge=0.0)
    updated_at: str = ""


class ModelDescriptor(BaseModel):
    id: str
    component: ModelComponentType
    name: str
    provider: str = "local"
    model_id: str
    path: str = ""
    default_path: str = ""
    status: ModelRuntimeStatus = "ready"
    quantization: str = ""
    load_profile: str = "balanced"
    max_batch_size: int = 1
    rerank_top_n: int = Field(default=8, ge=1, le=20)
    frame_interval_seconds: int = Field(default=10, ge=1, le=600)
    enabled: bool = True
    size_bytes: int = 0
    is_installed: bool = False
    supports_managed_download: bool = False
    download: ModelDownloadStatus | None = None
    last_check_at: str = ""
    api_base_url: str = ""
    api_key: str = ""
    api_key_configured: bool = False
    api_model: str = ""
    api_protocol: str = "openai_compatible"
    api_timeout_seconds: int = Field(default=120, ge=10, le=600)
    api_image_max_bytes: int = Field(default=524288, ge=32768, le=8388608)
    api_image_max_edge: int = Field(default=1280, ge=256, le=4096)


class ModelListResponse(BaseModel):
    items: list[ModelDescriptor] = Field(default_factory=list)


class ModelReloadRequest(BaseModel):
    model_id: str | None = None


class ModelUpdateRequest(BaseModel):
    name: str | None = None
    provider: str | None = None
    model_id: str | None = None
    path: str | None = None
    status: ModelRuntimeStatus | None = None
    load_profile: str | None = None
    quantization: str | None = None
    max_batch_size: int | None = Field(default=None, ge=1, le=64)
    rerank_top_n: int | None = Field(default=None, ge=1, le=20)
    frame_interval_seconds: int | None = Field(default=None, ge=1, le=600)
    enabled: bool | None = None
    api_base_url: str | None = None
    api_key: str | None = None
    api_model: str | None = None
    api_protocol: str | None = None
    api_timeout_seconds: int | None = Field(default=None, ge=10, le=600)
    api_image_max_bytes: int | None = Field(default=None, ge=32768, le=8388608)
    api_image_max_edge: int | None = Field(default=None, ge=256, le=4096)


class UISettingsResponse(BaseModel):
    language: Literal["zh", "en"] = "zh"
    font_size: int = Field(default=14, ge=12, le=20)
    auto_save: bool = True
    theme_hue: int = Field(default=220, ge=0, le=360)
    background_image: str | None = None
    background_image_opacity: int = Field(default=28, ge=0, le=100)
    background_image_blur: int = Field(default=0, ge=0, le=40)
    background_image_scale: float = Field(default=1.0, ge=1.0, le=4.0)
    background_image_focus_x: float = Field(default=0.5, ge=0.0, le=1.0)
    background_image_focus_y: float = Field(default=0.5, ge=0.0, le=1.0)
    background_image_fill_mode: BackgroundImageFillMode = "cover"


class UISettingsUpdateRequest(BaseModel):
    language: Literal["zh", "en"] | None = None
    font_size: int | None = Field(default=None, ge=12, le=20)
    auto_save: bool | None = None
    theme_hue: int | None = Field(default=None, ge=0, le=360)
    background_image: str | None = None
    background_image_opacity: int | None = Field(default=None, ge=0, le=100)
    background_image_blur: int | None = Field(default=None, ge=0, le=40)
    background_image_scale: float | None = Field(default=None, ge=1.0, le=4.0)
    background_image_focus_x: float | None = Field(default=None, ge=0.0, le=1.0)
    background_image_focus_y: float | None = Field(default=None, ge=0.0, le=1.0)
    background_image_fill_mode: BackgroundImageFillMode | None = None


class SelfCheckStartResponse(BaseModel):
    session_id: str
    status: str


class SelfCheckAutoFixResponse(BaseModel):
    session_id: str
    status: str


class SelfCheckStepResponse(BaseModel):
    id: str
    title: str
    status: str
    message: str
    details: dict[str, str] = Field(default_factory=dict)
    auto_fixable: bool = False
    manual_action: str = ""


class SelfCheckIssueResponse(BaseModel):
    id: str
    title: str
    status: str
    message: str
    details: dict[str, str] = Field(default_factory=dict)
    auto_fixable: bool = False
    manual_action: str = ""


class SelfCheckReportResponse(BaseModel):
    session_id: str
    status: str
    progress: int
    steps: list[SelfCheckStepResponse] = Field(default_factory=list)
    issues: list[SelfCheckIssueResponse] = Field(default_factory=list)
    auto_fix_available: bool = False
    updated_at: str
    last_error: str = ""


class RuntimeMetricsResponse(BaseModel):
    uptime_seconds: int = 0
    cpu_percent: float = 0
    memory_used_bytes: int = 0
    memory_total_bytes: int = 0
    gpu_percent: float = 0
    gpu_memory_used_bytes: int = 0
    gpu_memory_total_bytes: int = 0
    sampled_at: str = ""


class RuntimePathsResponse(BaseModel):
    storage_dir: str
    event_log_dir: str
    trace_log_dir: str
