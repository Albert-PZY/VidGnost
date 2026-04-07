from __future__ import annotations

import asyncio
import platform
import shutil
import subprocess
import sys
import tomllib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from app.config import Settings
from app.services.events import EventBus
from app.services.naming import generate_time_key

StepStatus = Literal["pending", "running", "passed", "warning", "failed"]
SessionStatus = Literal["idle", "running", "completed", "failed", "fixing"]
_MAX_SELF_CHECK_SESSION_CACHE = 24


@dataclass(slots=True)
class SelfCheckStep:
    id: str
    title: str
    status: StepStatus = "pending"
    message: str = ""
    auto_fixable: bool = False
    manual_action: str = ""


@dataclass(slots=True)
class SelfCheckOutcome:
    status: Literal["passed", "warning", "failed"]
    message: str
    auto_fixable: bool = False
    manual_action: str = ""


@dataclass(slots=True)
class SelfCheckSession:
    id: str
    status: SessionStatus = "idle"
    progress: int = 0
    steps: list[SelfCheckStep] = field(default_factory=list)
    issues: list[dict[str, str | bool]] = field(default_factory=list)
    auto_fix_available: bool = False
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_error: str = ""


class SelfCheckService:
    def __init__(self, settings: Settings, event_bus: EventBus) -> None:
        self._settings = settings
        self._event_bus = event_bus
        self._sessions: dict[str, SelfCheckSession] = {}
        self._max_session_cache = _MAX_SELF_CHECK_SESSION_CACHE
        self._lock = asyncio.Lock()
        self._project_root = Path(__file__).resolve().parents[3]

    async def start_check(self) -> str:
        session_id = generate_time_key(
            "self-check", exists=lambda candidate: candidate in self._sessions
        )
        session = SelfCheckSession(id=session_id, status="running")
        async with self._lock:
            self._sessions[session_id] = session
            _prune_terminal_self_check_sessions(
                self._sessions, max_sessions=self._max_session_cache
            )
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
        asyncio.create_task(self._run_auto_fix(session_id))

    async def get_report(self, session_id: str) -> dict[str, object] | None:
        async with self._lock:
            _prune_terminal_self_check_sessions(
                self._sessions, max_sessions=self._max_session_cache
            )
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
                {
                    "type": "self_check_started",
                    "session_id": session_id,
                    "total_steps": total_steps,
                    "progress": 0,
                },
            )

            for index, check in enumerate(steps, start=1):
                await self._mark_step_running(session_id, check.id)
                step_progress = int(((index - 1) / total_steps) * 100)
                await self._event_bus.publish(
                    topic,
                    {
                        "type": "self_check_step_start",
                        "session_id": session_id,
                        "index": index,
                        "total_steps": total_steps,
                        "progress": step_progress,
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
                session.auto_fix_available = any(
                    bool(issue.get("auto_fixable")) for issue in session.issues
                )
                session.updated_at = datetime.now(timezone.utc).isoformat()
                _prune_terminal_self_check_sessions(
                    self._sessions, max_sessions=self._max_session_cache
                )
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
                    _prune_terminal_self_check_sessions(
                        self._sessions, max_sessions=self._max_session_cache
                    )
            await self._event_bus.publish(
                topic,
                {
                    "type": "self_check_failed",
                    "session_id": session_id,
                    "error": str(exc),
                },
            )

    async def _run_auto_fix(self, session_id: str) -> None:
        topic = self._topic(session_id)
        await self._event_bus.publish(topic, {"type": "self_fix_started", "session_id": session_id})
        script_path, command = self._auto_fix_command()
        if not script_path.exists():
            await self._mark_fix_failed(session_id, f"Auto-fix script not found: {script_path}")
            await self._event_bus.publish(
                topic,
                {
                    "type": "self_fix_failed",
                    "session_id": session_id,
                    "error": f"Auto-fix script not found: {script_path}",
                },
            )
            return

        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(self._project_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        assert process.stdout is not None
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            message = line.decode("utf-8", errors="replace").strip()
            if message:
                await self._event_bus.publish(
                    topic,
                    {
                        "type": "self_fix_log",
                        "session_id": session_id,
                        "message": message,
                    },
                )

        code = await process.wait()
        if code != 0:
            error_text = f"Auto-fix script exited with code {code}."
            await self._mark_fix_failed(session_id, error_text)
            await self._event_bus.publish(
                topic, {"type": "self_fix_failed", "session_id": session_id, "error": error_text}
            )
            return

        await self._event_bus.publish(
            topic,
            {
                "type": "self_fix_log",
                "session_id": session_id,
                "message": "Auto-fix finished. Running validation again...",
            },
        )
        await self._run_check(session_id)
        report = await self.get_report(session_id)
        await self._event_bus.publish(
            topic,
            {
                "type": "self_fix_complete",
                "session_id": session_id,
                "status": "completed",
                "issues": (report or {}).get("issues", []),
                "auto_fix_available": bool((report or {}).get("auto_fix_available", False)),
            },
        )

    async def _mark_fix_failed(self, session_id: str, error_text: str) -> None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            session.status = "failed"
            session.last_error = error_text
            session.updated_at = datetime.now(timezone.utc).isoformat()

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

    async def _mark_step_result(
        self, session_id: str, step_id: str, outcome: SelfCheckOutcome
    ) -> None:
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
            target.auto_fixable = outcome.auto_fixable
            target.manual_action = outcome.manual_action

            session.issues = [
                issue for issue in session.issues if str(issue.get("id", "")) != step_id
            ]
            if outcome.status in {"warning", "failed"}:
                session.issues.append(
                    {
                        "id": target.id,
                        "title": target.title,
                        "status": target.status,
                        "message": target.message,
                        "auto_fixable": target.auto_fixable,
                        "manual_action": target.manual_action,
                    }
                )
            session.auto_fix_available = any(
                bool(issue.get("auto_fixable")) for issue in session.issues
            )
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

    def _auto_fix_command(self) -> tuple[Path, list[str]]:
        if sys.platform == "win32":
            script = self._project_root / "scripts" / "self-check-auto-fix.ps1"
            return script, ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(script)]
        script = self._project_root / "scripts" / "self-check-auto-fix.sh"
        return script, ["bash", str(script)]

    def _build_steps(self) -> list["_SelfCheckItem"]:
        return [
            _SelfCheckItem("env", "Runtime Environment", self._check_runtime_environment),
            _SelfCheckItem("uv", "Python Package Manager (uv)", self._check_uv),
            _SelfCheckItem("pnpm", "Frontend Package Manager (pnpm)", self._check_pnpm),
            _SelfCheckItem("ffmpeg", "FFmpeg", self._check_ffmpeg),
            _SelfCheckItem("config-files", "Runtime Config Files", self._check_config_files),
            _SelfCheckItem(
                "whisper-config",
                "Faster-Whisper Runtime Config",
                self._check_whisper_runtime_config,
            ),
            _SelfCheckItem("model-cache", "Whisper Model Cache", self._check_model_cache),
        ]

    async def _check_runtime_environment(self) -> SelfCheckOutcome:
        py_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        system = platform.system() or "Unknown"
        if sys.version_info[:2] != (3, 12):
            return SelfCheckOutcome(
                status="failed",
                message=f"{system} · Python {py_version} (requires == 3.12.x)",
                manual_action="安装 Python 3.12 后重新创建后端虚拟环境并执行 uv sync。",
            )
        return SelfCheckOutcome(status="passed", message=f"{system} · Python {py_version}")

    async def _check_uv(self) -> SelfCheckOutcome:
        uv_path = shutil.which("uv")
        if uv_path:
            version = await self._try_read_version(["uv", "--version"])
            return SelfCheckOutcome(status="passed", message=f"Detected at {uv_path} ({version})")
        return SelfCheckOutcome(
            status="failed",
            message="uv is not available in PATH.",
            auto_fixable=True,
            manual_action="安装 uv 并确保 PATH 可访问。",
        )

    async def _check_pnpm(self) -> SelfCheckOutcome:
        pnpm_path = shutil.which("pnpm")
        if pnpm_path:
            version = await self._try_read_version(["pnpm", "--version"])
            return SelfCheckOutcome(
                status="passed", message=f"Detected at {pnpm_path} (v{version})"
            )
        return SelfCheckOutcome(
            status="failed",
            message="pnpm is not available in PATH.",
            auto_fixable=True,
            manual_action="安装 Node.js + Corepack，并启用 pnpm。",
        )

    async def _check_ffmpeg(self) -> SelfCheckOutcome:
        ffmpeg_path = shutil.which("ffmpeg")
        if ffmpeg_path:
            version = await self._try_read_version(["ffmpeg", "-version"])
            return SelfCheckOutcome(
                status="passed", message=f"Detected at {ffmpeg_path} ({version})"
            )
        return SelfCheckOutcome(
            status="failed",
            message="ffmpeg command is missing.",
            auto_fixable=bool(
                shutil.which("winget") if sys.platform == "win32" else shutil.which("apt-get")
            ),
            manual_action="安装 ffmpeg 并确保 PATH 可访问。",
        )

    async def _check_config_files(self) -> SelfCheckOutcome:
        llm_path = Path(self._settings.llm_config_path)
        runtime_path = Path(self._settings.runtime_config_path)
        missing: list[str] = []
        if not llm_path.exists():
            missing.append(llm_path.name)
        if not runtime_path.exists():
            missing.append(runtime_path.name)
        if missing:
            return SelfCheckOutcome(
                status="warning",
                message=f"Missing config files: {', '.join(missing)}",
                auto_fixable=True,
                manual_action="执行自动修复或在前端保存一次配置。",
            )
        return SelfCheckOutcome(
            status="passed", message="model_config.json and config.toml are present."
        )

    async def _check_whisper_runtime_config(self) -> SelfCheckOutcome:
        runtime_path = Path(self._settings.runtime_config_path)
        if not runtime_path.exists():
            return SelfCheckOutcome(
                status="warning",
                message="config.toml not found.",
                auto_fixable=True,
                manual_action="执行自动修复生成默认 runtime 配置。",
            )
        try:
            payload = tomllib.loads(runtime_path.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError:
            return SelfCheckOutcome(
                status="failed",
                message="config.toml has invalid TOML syntax.",
                manual_action="修复 config.toml 语法，或在前端重新保存配置。",
            )
        whisper = payload.get("whisper", {})
        device = str(whisper.get("device", "")).strip().lower()
        compute_type = str(whisper.get("compute_type", "")).strip().lower()
        if device != "cpu":
            return SelfCheckOutcome(
                status="warning",
                message=f"whisper.device is `{device or 'empty'}` (CPU-only expects `cpu`).",
                auto_fixable=True,
                manual_action="在前端保存运行配置，后端会归一化 device=cpu。",
            )
        if compute_type not in {"int8", "float32"}:
            return SelfCheckOutcome(
                status="warning",
                message=f"whisper.compute_type is `{compute_type or 'empty'}` (allowed: int8/float32).",
                auto_fixable=True,
                manual_action="设置 compute_type 为 int8 或 float32。",
            )
        return SelfCheckOutcome(status="passed", message=f"device=cpu, compute_type={compute_type}")

    async def _check_model_cache(self) -> SelfCheckOutcome:
        model_dir = Path(self._settings.storage_dir) / "model-hub" / "faster-whisper-small"
        if not model_dir.exists():
            return SelfCheckOutcome(
                status="warning",
                message="Whisper small model cache folder does not exist yet.",
                manual_action="首次转录任务会自动创建并缓存 Whisper 模型。",
            )

        required_files = [
            ".ready.json",
            "config.json",
            "model.bin",
            "tokenizer.json",
            "vocabulary.txt",
        ]
        missing: list[str] = []
        for file_name in required_files:
            target = model_dir / file_name
            if not target.exists() or not target.is_file():
                missing.append(file_name)
                continue
            if file_name != ".ready.json" and target.stat().st_size <= 0:
                missing.append(file_name)

        if missing:
            return SelfCheckOutcome(
                status="warning",
                message=f"Whisper small cache incomplete: missing {', '.join(missing)}",
                manual_action="运行一次分析任务以自动下载并修复 Whisper small 模型缓存。",
            )

        total_bytes = 0
        for file_name in required_files:
            target = model_dir / file_name
            if target.exists() and target.is_file():
                total_bytes += target.stat().st_size
        size_mb = total_bytes / (1024 * 1024)
        return SelfCheckOutcome(
            status="passed", message=f"Whisper small cache ready ({size_mb:.1f} MiB)"
        )

    @staticmethod
    async def _try_read_version(command: list[str]) -> str:
        try:
            result = await asyncio.to_thread(
                subprocess.run,
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=8,
            )
        except (OSError, subprocess.TimeoutExpired):
            return "version unknown"
        text = (result.stdout or result.stderr or "").strip()
        if not text:
            return "version unknown"
        return text.splitlines()[0]

    @staticmethod
    def _topic(session_id: str) -> str:
        return f"self-check:{session_id}"


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
