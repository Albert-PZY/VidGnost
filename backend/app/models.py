from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return utcnow()
    return utcnow()


class TaskStatus(StrEnum):
    QUEUED = "queued"
    PREPARING = "preparing"
    TRANSCRIBING = "transcribing"
    SUMMARIZING = "summarizing"
    PAUSED = "paused"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(slots=True)
class TaskRecord:
    id: str
    source_type: str
    source_input: str
    source_local_path: str | None = None

    workflow: str = "notes"
    title: str | None = None
    duration_seconds: float | None = None
    language: str = "zh"
    model_size: str = "small"
    file_size_bytes: int = 0

    status: str = TaskStatus.QUEUED.value
    progress: int = 0
    error_message: str | None = None

    transcript_text: str | None = None
    transcript_segments_json: str | None = None
    summary_markdown: str | None = None
    mindmap_markdown: str | None = None
    notes_markdown: str | None = None
    fusion_prompt_markdown: str | None = None
    stage_logs_json: str | None = None
    stage_metrics_json: str | None = None
    artifact_index_json: str | None = None
    artifact_total_bytes: int = 0

    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "TaskRecord":
        resolved_id = str(payload.get("id") or payload.get("task_id") or "")
        resolved_source_type = str(payload.get("source_type") or payload.get("source") or "")
        resolved_source_input = str(
            payload.get("source_input")
            or payload.get("source_url")
            or payload.get("source_path")
            or payload.get("url")
            or payload.get("source")
            or ""
        )
        return cls(
            id=resolved_id,
            source_type=resolved_source_type,
            source_input=resolved_source_input,
            source_local_path=_to_optional_str(payload.get("source_local_path")),
            workflow=_normalize_workflow(payload.get("workflow")),
            title=_to_optional_str(payload.get("title")),
            duration_seconds=_to_optional_float(payload.get("duration_seconds")),
            language=str(payload.get("language", "zh") or "zh"),
            model_size=str(payload.get("model_size", "small") or "small"),
            file_size_bytes=_to_int(payload.get("file_size_bytes"), default=0),
            status=str(payload.get("status", TaskStatus.QUEUED.value) or TaskStatus.QUEUED.value),
            progress=_to_int(payload.get("progress"), default=0),
            error_message=_to_optional_str(payload.get("error_message")),
            transcript_text=_to_optional_str(payload.get("transcript_text")),
            transcript_segments_json=_to_optional_str(payload.get("transcript_segments_json")),
            summary_markdown=_to_optional_str(payload.get("summary_markdown")),
            mindmap_markdown=_to_optional_str(payload.get("mindmap_markdown")),
            notes_markdown=_to_optional_str(payload.get("notes_markdown")),
            fusion_prompt_markdown=_to_optional_str(payload.get("fusion_prompt_markdown")),
            stage_logs_json=_to_optional_str(payload.get("stage_logs_json")),
            stage_metrics_json=_to_optional_str(payload.get("stage_metrics_json")),
            artifact_index_json=_to_optional_str(payload.get("artifact_index_json")),
            artifact_total_bytes=_to_int(payload.get("artifact_total_bytes"), default=0),
            created_at=parse_datetime(payload.get("created_at")),
            updated_at=parse_datetime(payload.get("updated_at")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source_type": self.source_type,
            "source_input": self.source_input,
            "source_local_path": self.source_local_path,
            "workflow": _normalize_workflow(self.workflow),
            "title": self.title,
            "duration_seconds": self.duration_seconds,
            "language": self.language,
            "model_size": self.model_size,
            "file_size_bytes": max(0, int(self.file_size_bytes)),
            "status": self.status,
            "progress": self.progress,
            "error_message": self.error_message,
            "transcript_text": self.transcript_text,
            "transcript_segments_json": self.transcript_segments_json,
            "summary_markdown": self.summary_markdown,
            "mindmap_markdown": self.mindmap_markdown,
            "notes_markdown": self.notes_markdown,
            "fusion_prompt_markdown": self.fusion_prompt_markdown,
            "stage_logs_json": self.stage_logs_json,
            "stage_metrics_json": self.stage_metrics_json,
            "artifact_index_json": self.artifact_index_json,
            "artifact_total_bytes": self.artifact_total_bytes,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


@dataclass(slots=True)
class PromptTemplateRecord:
    id: str
    channel: str
    name: str
    content: str
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PromptTemplateRecord":
        return cls(
            id=str(payload.get("id", "")),
            channel=str(payload.get("channel", "")),
            name=str(payload.get("name", "")),
            content=str(payload.get("content", "")),
            created_at=parse_datetime(payload.get("created_at")),
            updated_at=parse_datetime(payload.get("updated_at")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "channel": self.channel,
            "name": self.name,
            "content": self.content,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


@dataclass(slots=True)
class PromptTemplateSelectionRecord:
    correction_template_id: str = ""
    notes_template_id: str = ""
    mindmap_template_id: str = ""
    vqa_template_id: str = ""
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PromptTemplateSelectionRecord":
        return cls(
            correction_template_id=str(payload.get("correction_template_id", "")),
            notes_template_id=str(payload.get("notes_template_id", payload.get("summary_template_id", ""))),
            mindmap_template_id=str(payload.get("mindmap_template_id", "")),
            vqa_template_id=str(payload.get("vqa_template_id", "")),
            created_at=parse_datetime(payload.get("created_at")),
            updated_at=parse_datetime(payload.get("updated_at")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "correction_template_id": self.correction_template_id,
            "notes_template_id": self.notes_template_id,
            "mindmap_template_id": self.mindmap_template_id,
            "vqa_template_id": self.vqa_template_id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


def _normalize_workflow(value: Any) -> str:
    candidate = str(value or "").strip().lower()
    if candidate in {"notes", "vqa"}:
        return candidate
    return "notes"


def _to_optional_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def _to_optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any, *, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value != value:
            return default
        return int(value)
    text = str(value).strip()
    if not text:
        return default
    try:
        return int(text)
    except ValueError:
        try:
            return int(float(text))
        except ValueError:
            return default
