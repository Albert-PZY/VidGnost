from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

StageType = Literal["A", "B", "C", "D"]
TaskErrorCategory = Literal["input", "download", "transcription", "generation", "export", "runtime"]

_CATEGORY_HINTS: dict[TaskErrorCategory, str] = {
    "input": "输入源检查失败，请确认链接、文件路径或上传文件可用。",
    "download": "下载或媒体准备失败，请检查网络连接、源地址可访问性和磁盘空间。",
    "transcription": "转写阶段失败，请检查 Whisper 模型文件、音频分块和 CPU 资源。",
    "generation": "内容生成阶段失败，请检查在线 LLM 配置、鉴权信息和网络连通性。",
    "export": "导出阶段失败，请检查目标产物是否完整并重试导出。",
    "runtime": "运行时失败，请查看阶段日志中的详细上下文后重试。",
}


@dataclass(slots=True)
class TaskFailureInfo:
    category: TaskErrorCategory
    reason: str
    hint: str


def classify_task_failure(*, stage: StageType, exc: Exception) -> TaskFailureInfo:
    reason = f"{type(exc).__name__}: {exc}"
    message = reason.lower()

    if isinstance(exc, (FileNotFoundError, PermissionError)):
        return _build_failure("input", reason)
    if "api key" in message or "llm api" in message:
        return _build_failure("generation", reason)
    if "export" in message or "artifact" in message:
        return _build_failure("export", reason)

    if stage == "A":
        if _contains_any(message, ("download", "yt-dlp", "bilibili", "probe", "ingest")):
            return _build_failure("download", reason)
        return _build_failure("input", reason)
    if stage == "B":
        if _contains_any(message, ("ffmpeg", "audio", "chunk", "wav", "convert")):
            return _build_failure("download", reason)
        return _build_failure("runtime", reason)
    if stage == "C":
        if _contains_any(message, ("whisper", "transcrib", "segment", "cublas", "model")):
            return _build_failure("transcription", reason)
        return _build_failure("transcription", reason)
    if stage == "D":
        if _contains_any(message, ("openai", "llm", "summary", "mindmap", "timeout", "connect")):
            return _build_failure("generation", reason)
        return _build_failure("generation", reason)
    return _build_failure("runtime", reason)


def _contains_any(message: str, patterns: tuple[str, ...]) -> bool:
    return any(pattern in message for pattern in patterns)


def _build_failure(category: TaskErrorCategory, reason: str) -> TaskFailureInfo:
    return TaskFailureInfo(category=category, reason=reason, hint=_CATEGORY_HINTS[category])

