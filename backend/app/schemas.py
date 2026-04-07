from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ModelSize = Literal["small"]
SourceType = Literal["bilibili", "local_file"]


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class TaskCreateFromUrlRequest(BaseModel):
    url: str = Field(min_length=2)
    model_size: ModelSize = "small"
    language: str = "zh"


class TaskCreateFromPathRequest(BaseModel):
    local_path: str = Field(min_length=1)
    model_size: ModelSize = "small"
    language: str = "zh"


class TaskCreateResponse(BaseModel):
    task_id: str
    status: str


class TaskSummaryItem(BaseModel):
    id: str
    title: str | None
    source_type: SourceType
    source_input: str
    status: str
    progress: int
    created_at: datetime
    updated_at: datetime


class TaskListResponse(BaseModel):
    items: list[TaskSummaryItem]
    total: int


class TaskDetailResponse(BaseModel):
    id: str
    title: str | None
    source_type: SourceType
    source_input: str
    language: str
    model_size: str
    status: str
    progress: int
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


PromptTemplateChannel = Literal["summary", "mindmap"]


class PromptTemplateItem(BaseModel):
    id: str
    channel: PromptTemplateChannel
    name: str
    content: str
    is_default: bool = False
    created_at: datetime
    updated_at: datetime


class PromptTemplateBundleResponse(BaseModel):
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
    selected_summary_template_id: str = Field(min_length=1)
    selected_mindmap_template_id: str = Field(min_length=1)


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
    warnings: list[str] = Field(default_factory=list)
    rollback_applied: bool = False


class WhisperConfigUpdateRequest(BaseModel):
    model_default: Literal["small"] = "small"
    language: str = "zh"
    device: str = "auto"
    compute_type: str = "int8"
    model_load_profile: Literal["balanced", "memory_first"] = "balanced"
    beam_size: int = Field(default=5, ge=1, le=12)
    vad_filter: bool = True
    chunk_seconds: int = Field(default=180, ge=30, le=1200)
    target_sample_rate: int = Field(default=16000, ge=8000, le=48000)
    target_channels: int = Field(default=1, ge=1, le=2)


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
    auto_fixable: bool = False
    manual_action: str = ""


class SelfCheckIssueResponse(BaseModel):
    id: str
    title: str
    status: str
    message: str
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
