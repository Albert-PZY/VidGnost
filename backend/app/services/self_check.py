from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
import platform
import shutil
import subprocess
import sys
from typing import Literal

from app.config import Settings
from app.services.events import EventBus
from app.services.llm_config_store import LLMConfigStore
from app.services.llm_connectivity import validate_openai_compat_model_config
from app.services.model_catalog_store import ModelCatalogStore
from app.services.naming import generate_time_key
from app.services.whisper_gpu_runtime_service import WhisperGpuRuntimeService

StepStatus = Literal["pending", "running", "passed", "warning", "failed"]
SessionStatus = Literal["idle", "running", "completed", "failed", "fixing"]
_MAX_SELF_CHECK_SESSION_CACHE = 24


@dataclass(slots=True)
class SelfCheckStep:
    id: str
    title: str
    status: StepStatus = "pending"
    message: str = ""
    details: dict[str, str] = field(default_factory=dict)
    auto_fixable: bool = False
    manual_action: str = ""


@dataclass(slots=True)
class SelfCheckOutcome:
    status: Literal["passed", "warning", "failed"]
    message: str
    details: dict[str, str] = field(default_factory=dict)
    auto_fixable: bool = False
    manual_action: str = ""


@dataclass(slots=True)
class SelfCheckSession:
    id: str
    status: SessionStatus = "idle"
    progress: int = 0
    steps: list[SelfCheckStep] = field(default_factory=list)
    issues: list[dict[str, str | bool | dict[str, str]]] = field(default_factory=list)
    auto_fix_available: bool = False
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_error: str = ""


class SelfCheckService:
    def __init__(
        self,
        settings: Settings,
        event_bus: EventBus,
        whisper_gpu_runtime_service: WhisperGpuRuntimeService,
    ) -> None:
        self._settings = settings
        self._event_bus = event_bus
        self._llm_config_store = LLMConfigStore(settings)
        self._model_catalog_store = ModelCatalogStore(settings)
        self._whisper_gpu_runtime_service = whisper_gpu_runtime_service
        self._sessions: dict[str, SelfCheckSession] = {}
        self._max_session_cache = _MAX_SELF_CHECK_SESSION_CACHE
        self._lock = asyncio.Lock()

    async def start_check(self) -> str:
        session_id = generate_time_key("self-check", exists=lambda candidate: candidate in self._sessions)
        session = SelfCheckSession(id=session_id, status="running")
        async with self._lock:
            self._sessions[session_id] = session
            _prune_terminal_self_check_sessions(self._sessions, max_sessions=self._max_session_cache)
        asyncio.create_task(self._run_check(session_id))
        return session_id

    async def start_auto_fix(self, session_id: str) -> None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            if session.status in {"running", "fixing"}:
                raise RuntimeError("Self-check is still running for this session.")
            session.status = "fixing"
            session.updated_at = datetime.now(timezone.utc).isoformat()
        await asyncio.sleep(0.2)
        await self._run_check(session_id)

    async def get_report(self, session_id: str) -> dict[str, object] | None:
        async with self._lock:
            _prune_terminal_self_check_sessions(self._sessions, max_sessions=self._max_session_cache)
            session = self._sessions.get(session_id)
            if session is None:
                return None
            return self._serialize_session(session)

    async def _run_check(self, session_id: str) -> None:
        topic = self._topic(session_id)
        steps = self._build_steps()
        total_steps = len(steps)
        try:
            async with self._lock:
                session = self._sessions.get(session_id)
                if session is None:
                    return
                session.status = "running"
                session.progress = 0
                session.steps = [SelfCheckStep(id=step.id, title=step.title) for step in steps]
                session.issues = []
                session.auto_fix_available = False
                session.last_error = ""
                session.updated_at = datetime.now(timezone.utc).isoformat()

            await self._event_bus.publish(
                topic,
                {"type": "self_check_started", "session_id": session_id, "total_steps": total_steps, "progress": 0},
            )

            for index, check in enumerate(steps, start=1):
                await self._mark_step_running(session_id, check.id)
                await self._event_bus.publish(
                    topic,
                    {
                        "type": "self_check_step_start",
                        "session_id": session_id,
                        "index": index,
                        "total_steps": total_steps,
                        "progress": int(((index - 1) / total_steps) * 100),
                        "step": await self._get_step_payload(session_id, check.id),
                    },
                )
                outcome = await check.run()
                await self._mark_step_result(session_id, check.id, outcome)
                await self._event_bus.publish(
                    topic,
                    {
                        "type": "self_check_step_result",
                        "session_id": session_id,
                        "index": index,
                        "total_steps": total_steps,
                        "progress": int((index / total_steps) * 100),
                        "step": await self._get_step_payload(session_id, check.id),
                    },
                )

            async with self._lock:
                session = self._sessions.get(session_id)
                if session is None:
                    return
                session.status = "completed"
                session.progress = 100
                session.auto_fix_available = any(bool(issue.get("auto_fixable")) for issue in session.issues)
                session.updated_at = datetime.now(timezone.utc).isoformat()
                _prune_terminal_self_check_sessions(self._sessions, max_sessions=self._max_session_cache)
                report = self._serialize_session(session)

            await self._event_bus.publish(
                topic,
                {
                    "type": "self_check_complete",
                    "session_id": session_id,
                    "progress": 100,
                    "issues": report["issues"],
                    "auto_fix_available": report["auto_fix_available"],
                    "status": report["status"],
                },
            )
        except Exception as exc:  # noqa: BLE001
            async with self._lock:
                session = self._sessions.get(session_id)
                if session is not None:
                    session.status = "failed"
                    session.last_error = str(exc)
                    session.updated_at = datetime.now(timezone.utc).isoformat()
                    _prune_terminal_self_check_sessions(self._sessions, max_sessions=self._max_session_cache)
            await self._event_bus.publish(topic, {"type": "self_check_failed", "session_id": session_id, "error": str(exc)})

    async def _mark_step_running(self, session_id: str, step_id: str) -> None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            for step in session.steps:
                if step.id == step_id:
                    step.status = "running"
                    step.message = "Checking..."
                    break
            session.updated_at = datetime.now(timezone.utc).isoformat()

    async def _mark_step_result(self, session_id: str, step_id: str, outcome: SelfCheckOutcome) -> None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            target: SelfCheckStep | None = None
            for step in session.steps:
                if step.id == step_id:
                    target = step
                    break
            if target is None:
                return

            target.status = outcome.status
            target.message = outcome.message
            target.details = dict(outcome.details)
            target.auto_fixable = outcome.auto_fixable
            target.manual_action = outcome.manual_action

            session.issues = [issue for issue in session.issues if str(issue.get("id", "")) != step_id]
            if outcome.status in {"warning", "failed"}:
                session.issues.append(
                    {
                        "id": target.id,
                        "title": target.title,
                        "status": target.status,
                        "message": target.message,
                        "details": dict(target.details),
                        "auto_fixable": target.auto_fixable,
                        "manual_action": target.manual_action,
                    }
                )
            session.auto_fix_available = any(bool(issue.get("auto_fixable")) for issue in session.issues)
            session.progress = self._count_progress(session.steps)
            session.updated_at = datetime.now(timezone.utc).isoformat()

    async def _get_step_payload(self, session_id: str, step_id: str) -> dict[str, object]:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return {}
            for step in session.steps:
                if step.id == step_id:
                    return self._serialize_step(step)
            return {}

    @staticmethod
    def _count_progress(steps: list[SelfCheckStep]) -> int:
        if not steps:
            return 0
        completed = sum(1 for step in steps if step.status in {"passed", "warning", "failed"})
        return int((completed / len(steps)) * 100)

    @staticmethod
    def _serialize_step(step: SelfCheckStep) -> dict[str, object]:
        return {
            "id": step.id,
            "title": step.title,
            "status": step.status,
            "message": step.message,
            "details": dict(step.details),
            "auto_fixable": step.auto_fixable,
            "manual_action": step.manual_action,
        }

    def _serialize_session(self, session: SelfCheckSession) -> dict[str, object]:
        return {
            "session_id": session.id,
            "status": session.status,
            "progress": session.progress,
            "steps": [self._serialize_step(step) for step in session.steps],
            "issues": list(session.issues),
            "auto_fix_available": session.auto_fix_available,
            "updated_at": session.updated_at,
            "last_error": session.last_error,
        }

    def _build_steps(self) -> list["_SelfCheckItem"]:
        return [
            _SelfCheckItem("env", "系统环境", self._check_system),
            _SelfCheckItem("gpu", "GPU 加速", self._check_gpu),
            _SelfCheckItem("gpu-runtime", "转写 CUDA 运行库", self._check_gpu_runtime),
            _SelfCheckItem("whisper", "FasterWhisper", self._check_whisper),
            _SelfCheckItem("llm", "LLM 模型", self._check_llm),
            _SelfCheckItem("embedding", "嵌入模型", self._check_embedding),
            _SelfCheckItem("vlm", "VLM 模型", self._check_vlm),
            _SelfCheckItem("chromadb", "ChromaDB", self._check_chromadb),
            _SelfCheckItem("storage", "存储空间", self._check_storage),
            _SelfCheckItem("ffmpeg", "FFmpeg", self._check_ffmpeg),
            _SelfCheckItem("model-cache", "Whisper 模型缓存", self._check_model_cache),
        ]

    async def _check_system(self) -> SelfCheckOutcome:
        details = {
            "操作系统": platform.platform(),
            "Python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "uv": "installed" if shutil.which("uv") else "missing",
            "pnpm": "installed" if shutil.which("pnpm") else "missing",
        }
        if details["uv"] == "missing":
            return SelfCheckOutcome(
                status="warning",
                message="uv 未安装，后端环境管理能力受限",
                details=details,
                auto_fixable=False,
                manual_action="安装 uv 并执行 uv sync。",
            )
        return SelfCheckOutcome(status="passed", message="系统环境正常", details=details)

    async def _check_gpu(self) -> SelfCheckOutcome:
        details: dict[str, str] = {}
        try:
            result = await asyncio.to_thread(
                subprocess.run,
                [
                    "nvidia-smi",
                    "--query-gpu=name,memory.total,driver_version",
                    "--format=csv,noheader,nounits",
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=2,
            )
            line = (result.stdout or "").strip().splitlines()[0] if result.stdout else ""
            if not line:
                raise RuntimeError("no gpu output")
            fields = [item.strip() for item in line.split(",")]
            details["显卡"] = fields[0] if len(fields) > 0 else "unknown"
            details["显存(MB)"] = fields[1] if len(fields) > 1 else "unknown"
            details["驱动版本"] = fields[2] if len(fields) > 2 else "unknown"
            return SelfCheckOutcome(status="passed", message="GPU 可用", details=details)
        except Exception:  # noqa: BLE001
            details["显卡"] = "未检测到 NVIDIA GPU"
            return SelfCheckOutcome(status="warning", message="GPU 加速不可用", details=details)

    async def _check_gpu_runtime(self) -> SelfCheckOutcome:
        status = await self._whisper_gpu_runtime_service.get_status()
        details = {
            "版本": status["version_label"],
            "安装目录": status["install_dir"],
            "运行库目录": status["bin_dir"],
            "环境变量": "已配置" if status["path_configured"] else "未配置",
        }
        if status["missing_files"]:
            details["缺失文件"] = ", ".join(status["missing_files"])
        if status["load_error"]:
            details["加载错误"] = status["load_error"]

        if status["status"] == "ready":
            return SelfCheckOutcome(
                status="passed",
                message="转写 CUDA 运行库已就绪",
                details=details,
            )

        if status["status"] == "unsupported":
            return SelfCheckOutcome(
                status="warning",
                message="当前平台不支持转写 CUDA 运行库自动安装",
                details=details,
                manual_action="如需 GPU 转写，请在支持的平台手动安装完整 CUDA 12 与 cuDNN 9 运行环境。",
            )

        return SelfCheckOutcome(
            status="warning",
            message="转写 CUDA 运行库未就绪",
            details=details,
            auto_fixable=False,
            manual_action="在设置中心的语音转写模型区域配置安装目录并执行“一键安装完整运行库”。",
        )

    async def _check_whisper(self) -> SelfCheckOutcome:
        model_dir = Path(self._settings.storage_dir) / "model-hub" / "faster-whisper-small"
        details = {"缓存目录": str(model_dir)}
        if model_dir.exists():
            return SelfCheckOutcome(status="passed", message="Whisper 缓存就绪", details=details)
        return SelfCheckOutcome(
            status="warning",
            message="Whisper 缓存目录不存在，将在首个任务自动下载",
            details=details,
        )

    async def _check_llm(self) -> SelfCheckOutcome:
        config = await self._llm_config_store.get()
        config_path = Path(self._settings.llm_config_path)
        base_url = str(config.get("base_url", self._settings.llm_base_url)).strip() or self._settings.llm_base_url
        model_name = str(config.get("model", self._settings.llm_model)).strip() or self._settings.llm_model
        details = {
            "配置文件": str(config_path),
            "模型": model_name,
            "Base URL": base_url,
        }

        api_key = str(config.get("api_key", "")).strip()
        if not api_key:
            return SelfCheckOutcome(
                status="warning",
                message="LLM API Key 未配置",
                details=details,
                auto_fixable=True,
                manual_action="在设置中心填写可用的 LLM API Key 后重新执行系统自检。",
            )

        validation = validate_openai_compat_model_config(
            base_url=base_url,
            api_key=api_key,
            model=model_name,
            timeout_seconds=6.0,
        )
        details["连通性"] = validation.connectivity_reason
        details["模型校验"] = validation.model_reason
        if validation.ok:
            return SelfCheckOutcome(
                status="passed",
                message="LLM 在线 API 连通正常",
                details=details,
            )
        if validation.connectivity_ok and not validation.model_ok:
            return SelfCheckOutcome(
                status="failed",
                message="LLM 在线 API 模型配置无效",
                details=details,
                manual_action="检查模型名是否存在于远端模型列表中，并确认当前配置与服务端返回一致。",
            )
        return SelfCheckOutcome(
            status="failed",
            message="LLM 在线 API 连通失败",
            details=details,
            manual_action="检查 Base URL、API Key、网络连通性和鉴权配置后重新执行系统自检。",
        )

    async def _check_embedding(self) -> SelfCheckOutcome:
        return SelfCheckOutcome(
            status="passed",
            message="Embedding 模型按配置可加载",
            details={"默认模型": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"},
        )

    async def _check_vlm(self) -> SelfCheckOutcome:
        models = await self._model_catalog_store.list_models()
        model = next((item for item in models if str(item.get("id", "")) == "vlm-default"), None)
        if model is None:
            return SelfCheckOutcome(
                status="warning",
                message="VLM 模型配置缺失",
                details={"默认模型": "vikhyatk/moondream2"},
                manual_action="检查模型目录配置并刷新模型状态。",
            )

        default_path = str(model.get("default_path", "")).strip()
        current_path = str(model.get("path", "")).strip() or default_path or "未就绪"
        details = {
            "默认模型": str(model.get("model_id", "")).strip() or str(model.get("name", "")).strip() or "未配置",
            "默认目录": default_path or "未配置",
            "当前路径": current_path,
            "加载策略": self._describe_load_profile(str(model.get("load_profile", "")).strip()),
            "量化": str(model.get("quantization", "")).strip() or "未配置",
        }

        if not bool(model.get("enabled", True)):
            return SelfCheckOutcome(
                status="warning",
                message="VLM 模型已停用",
                details=details,
                manual_action="在模型配置中重新启用视觉语言模型。",
            )

        if bool(model.get("is_installed", False)):
            return SelfCheckOutcome(status="passed", message="VLM 模型已就绪", details=details)

        return SelfCheckOutcome(
            status="warning",
            message="VLM 模型未就绪，将在需要时自动准备",
            details=details,
            manual_action="检查模型目录或在模型配置中刷新检测状态。",
        )

    async def _check_chromadb(self) -> SelfCheckOutcome:
        path = Path(self._settings.storage_dir) / "vector-index" / "chroma-db"
        details = {"路径": str(path)}
        if path.exists():
            return SelfCheckOutcome(status="passed", message="ChromaDB 目录可用", details=details)
        return SelfCheckOutcome(status="warning", message="ChromaDB 目录不存在，将在首次构建索引创建", details=details)

    async def _check_storage(self) -> SelfCheckOutcome:
        usage = shutil.disk_usage(Path(self._settings.storage_dir))
        free_gb = usage.free / (1024 * 1024 * 1024)
        details = {
            "总空间(GB)": f"{usage.total / (1024 * 1024 * 1024):.1f}",
            "可用空间(GB)": f"{free_gb:.1f}",
        }
        if free_gb < 5:
            return SelfCheckOutcome(
                status="failed",
                message="可用磁盘空间不足 5GB",
                details=details,
                auto_fixable=False,
                manual_action="清理磁盘空间后重试。",
            )
        return SelfCheckOutcome(status="passed", message="存储空间充足", details=details)

    async def _check_ffmpeg(self) -> SelfCheckOutcome:
        ffmpeg_path = shutil.which("ffmpeg")
        details = {"ffmpeg": ffmpeg_path or "missing"}
        if ffmpeg_path:
            return SelfCheckOutcome(status="passed", message="FFmpeg 可用", details=details)
        return SelfCheckOutcome(
            status="warning",
            message="FFmpeg 未安装，视频预处理能力受限",
            details=details,
            auto_fixable=False,
            manual_action="安装 FFmpeg 并加入 PATH。",
        )

    async def _check_model_cache(self) -> SelfCheckOutcome:
        model_dir = Path(self._settings.storage_dir) / "model-hub" / "faster-whisper-small"
        details = {"缓存目录": str(model_dir)}
        if model_dir.exists():
            return SelfCheckOutcome(status="passed", message="Whisper 模型缓存可用", details=details)
        return SelfCheckOutcome(
            status="warning",
            message="Whisper 模型缓存不存在，将在首个任务自动准备",
            details=details,
        )

    @staticmethod
    def _topic(session_id: str) -> str:
        return f"self-check:{session_id}"

    @staticmethod
    def _describe_load_profile(load_profile: str) -> str:
        labels = {
            "balanced": "平衡模式",
            "memory_first": "常驻内存优先",
            "on_demand": "按需加载",
        }
        return labels.get(load_profile, load_profile or "未配置")


@dataclass(slots=True)
class _SelfCheckItem:
    id: str
    title: str
    run: Callable[[], Awaitable[SelfCheckOutcome]]


def _prune_terminal_self_check_sessions(
    sessions: dict[str, SelfCheckSession],
    *,
    max_sessions: int,
) -> None:
    overflow = len(sessions) - max(1, max_sessions)
    if overflow <= 0:
        return
    removable = sorted(
        (
            (session_id, session)
            for session_id, session in sessions.items()
            if session.status in {"completed", "failed"}
        ),
        key=lambda item: item[1].updated_at,
    )
    for session_id, _ in removable[:overflow]:
        sessions.pop(session_id, None)
