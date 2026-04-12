from __future__ import annotations

import asyncio
import ctypes
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, TypedDict

from app.config import Settings
from app.errors import AppError
from app.services.runtime_config_store import (
    RuntimeConfigStore,
    WhisperRuntimeLibrariesConfig,
    _default_runtime_libraries_install_dir,
)

InstallState = Literal["idle", "installing", "completed", "failed"]
RuntimeStatus = Literal["ready", "not_ready", "installing", "failed", "unsupported"]

_CUDA_REDIST_VERSION = "12.9.1"
_CUDNN_REDIST_VERSION = "9.20.0"
_BUNDLE_VERSION_LABEL = f"CUDA {_CUDA_REDIST_VERSION} + cuDNN {_CUDNN_REDIST_VERSION}"
_PROGRESS_PREFIX = "VIDGNOST_GPU_RUNTIME_PROGRESS:"
_REQUIRED_DLLS = ("cublas64_12.dll", "cudart64_12.dll", "nvJitLink_12.dll")
_CUDNN_GLOB = "cudnn64*.dll"
_REPO_ROOT = Path(__file__).resolve().parents[3]


class RuntimeInstallSnapshot(TypedDict):
    state: InstallState
    message: str
    current_package: str
    downloaded_bytes: int
    total_bytes: int
    percent: float
    updated_at: str


class RuntimeStatusPayload(TypedDict):
    install_dir: str
    auto_configure_env: bool
    version_label: str
    platform_supported: bool
    ready: bool
    status: RuntimeStatus
    message: str
    bin_dir: str
    missing_files: list[str]
    discovered_files: dict[str, str]
    load_error: str
    path_configured: bool
    progress: RuntimeInstallSnapshot


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_snapshot(
    *,
    state: InstallState = "idle",
    message: str = "",
    current_package: str = "",
    downloaded_bytes: int = 0,
    total_bytes: int = 0,
    percent: float = 0.0,
) -> RuntimeInstallSnapshot:
    return {
        "state": state,
        "message": message,
        "current_package": current_package,
        "downloaded_bytes": max(0, int(downloaded_bytes)),
        "total_bytes": max(0, int(total_bytes)),
        "percent": max(0.0, min(100.0, float(percent))),
        "updated_at": _utc_now_iso(),
    }


class WhisperGpuRuntimeService:
    def __init__(
        self,
        settings: Settings,
        runtime_config_store: RuntimeConfigStore,
    ) -> None:
        self._settings = settings
        self._runtime_config_store = runtime_config_store
        self._lock = asyncio.Lock()
        self._snapshot: RuntimeInstallSnapshot = _build_snapshot()
        self._task: asyncio.Task[None] | None = None
        self._installer_script = _REPO_ROOT / "scripts" / "install-whisper-gpu-runtime.ps1"

    async def bootstrap_process_environment(self) -> None:
        config = await self._runtime_config_store.get_whisper_runtime_libraries()
        self._configure_process_environment(config["install_dir"])

    async def get_status(self) -> RuntimeStatusPayload:
        config = await self._runtime_config_store.get_whisper_runtime_libraries()
        self._configure_process_environment(config["install_dir"])
        async with self._lock:
            snapshot = dict(self._snapshot)
        return self._probe_status(config=config, snapshot=snapshot)

    async def save_config(
        self,
        *,
        install_dir: str,
        auto_configure_env: bool,
    ) -> RuntimeStatusPayload:
        config = await self._runtime_config_store.save_whisper_runtime_libraries(
            {
                "install_dir": install_dir,
                "auto_configure_env": auto_configure_env,
            }
        )
        self._configure_process_environment(config["install_dir"])
        async with self._lock:
            snapshot = dict(self._snapshot)
        return self._probe_status(config=config, snapshot=snapshot)

    async def start_install(
        self,
        *,
        install_dir: str | None = None,
        auto_configure_env: bool | None = None,
    ) -> RuntimeStatusPayload:
        current = await self._runtime_config_store.get_whisper_runtime_libraries()
        next_install_dir = (install_dir or current["install_dir"]).strip() or current["install_dir"]
        next_auto_configure_env = current["auto_configure_env"] if auto_configure_env is None else auto_configure_env
        config = await self._runtime_config_store.save_whisper_runtime_libraries(
            {
                "install_dir": next_install_dir,
                "auto_configure_env": next_auto_configure_env,
            }
        )

        if not self._is_windows():
            raise AppError.bad_request(
                "当前平台不支持自动安装 Whisper GPU 运行库。",
                code="WHISPER_GPU_RUNTIME_UNSUPPORTED",
                hint="当前自动安装脚本仅支持 Windows 桌面环境。",
            )

        if not self._installer_script.exists():
            raise AppError.conflict(
                "Whisper GPU 运行库安装脚本不存在。",
                code="WHISPER_GPU_RUNTIME_INSTALLER_MISSING",
                hint=f"请检查脚本文件是否存在：{self._installer_script}",
            )

        async with self._lock:
            if self._task is not None and not self._task.done():
                snapshot = dict(self._snapshot)
                return self._probe_status(config=config, snapshot=snapshot)

            self._snapshot = _build_snapshot(
                state="installing",
                message="准备下载并安装 Whisper GPU 运行库。",
            )
            self._task = asyncio.create_task(self._run_install(config))
            snapshot = dict(self._snapshot)
        return self._probe_status(config=config, snapshot=snapshot)

    async def shutdown(self) -> None:
        async with self._lock:
            task = self._task
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    def assert_runtime_ready_for_device(self, device: str, status: RuntimeStatusPayload) -> None:
        normalized_device = device.strip().lower()
        if normalized_device == "cpu":
            return
        if status["platform_supported"] and status["ready"]:
            return

        hint_parts = [
            "请先在设置中心的语音转写模型区域安装完整 Whisper GPU 运行库，或切换回 CPU 模式。",
        ]
        if status["install_dir"]:
            hint_parts.append(f"当前安装目录：{status['install_dir']}")
        if status["missing_files"]:
            hint_parts.append(f"缺失文件：{', '.join(status['missing_files'])}")
        if status["load_error"]:
            hint_parts.append(f"加载错误：{status['load_error']}")

        raise AppError.conflict(
            "运行前检查失败：Whisper GPU 运行库未就绪。",
            code="TASK_PRECHECK_WHISPER_GPU_RUNTIME_MISSING",
            hint=" ".join(hint_parts),
        )

    async def _run_install(self, config: WhisperRuntimeLibrariesConfig) -> None:
        install_dir = config["install_dir"].strip() or _default_runtime_libraries_install_dir(self._settings)
        args = [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(self._installer_script),
            "-InstallDir",
            install_dir,
            "-AutoConfigureEnv",
            "$true" if config["auto_configure_env"] else "$false",
        ]

        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(_REPO_ROOT),
        )
        stdout_task = asyncio.create_task(self._consume_stdout(process))
        stderr_task = asyncio.create_task(process.stderr.read()) if process.stderr is not None else None

        try:
            return_code = await process.wait()
            await stdout_task
            stderr_output = b""
            if stderr_task is not None:
                stderr_output = await stderr_task

            if return_code != 0:
                error_message = stderr_output.decode("utf-8", errors="ignore").strip() or "安装脚本执行失败。"
                await self._set_snapshot(
                    _build_snapshot(
                        state="failed",
                        message=error_message,
                        percent=self._snapshot["percent"],
                    )
                )
                return

            self._configure_process_environment(install_dir)
            status = await self.get_status()
            if status["ready"]:
                await self._set_snapshot(
                    _build_snapshot(
                        state="completed",
                        message="Whisper GPU 运行库已安装并完成环境配置。",
                        current_package=self._snapshot["current_package"],
                        downloaded_bytes=self._snapshot["downloaded_bytes"],
                        total_bytes=self._snapshot["total_bytes"],
                        percent=100.0,
                    )
                )
                return

            await self._set_snapshot(
                _build_snapshot(
                    state="failed",
                    message=status["load_error"] or status["message"] or "安装完成，但运行库仍未通过校验。",
                    current_package=self._snapshot["current_package"],
                    downloaded_bytes=self._snapshot["downloaded_bytes"],
                    total_bytes=self._snapshot["total_bytes"],
                    percent=max(95.0, self._snapshot["percent"]),
                )
            )
        except asyncio.CancelledError:
            process.kill()
            raise
        finally:
            async with self._lock:
                if self._task is asyncio.current_task():
                    self._task = None

    async def _consume_stdout(self, process: asyncio.subprocess.Process) -> None:
        if process.stdout is None:
            return
        while True:
            raw_line = await process.stdout.readline()
            if not raw_line:
                break
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line.startswith(_PROGRESS_PREFIX):
                continue
            payload_text = line.removeprefix(_PROGRESS_PREFIX).strip()
            try:
                payload = json.loads(payload_text)
            except json.JSONDecodeError:
                continue

            await self._set_snapshot(
                _build_snapshot(
                    state="installing",
                    message=str(payload.get("message", "")).strip(),
                    current_package=str(payload.get("current_package", "")).strip(),
                    downloaded_bytes=int(payload.get("downloaded_bytes", 0) or 0),
                    total_bytes=int(payload.get("total_bytes", 0) or 0),
                    percent=float(payload.get("percent", 0.0) or 0.0),
                )
            )

    async def _set_snapshot(self, snapshot: RuntimeInstallSnapshot) -> None:
        async with self._lock:
            self._snapshot = snapshot

    def _probe_status(
        self,
        *,
        config: WhisperRuntimeLibrariesConfig,
        snapshot: RuntimeInstallSnapshot,
    ) -> RuntimeStatusPayload:
        install_dir = config["install_dir"].strip() or _default_runtime_libraries_install_dir(self._settings)
        bin_dir = str((Path(install_dir) / "bin").resolve())
        if not self._is_windows():
            return {
                "install_dir": install_dir,
                "auto_configure_env": config["auto_configure_env"],
                "version_label": _BUNDLE_VERSION_LABEL,
                "platform_supported": False,
                "ready": False,
                "status": "unsupported",
                "message": "当前平台不支持自动安装 Whisper GPU 运行库。",
                "bin_dir": bin_dir,
                "missing_files": list(_REQUIRED_DLLS) + [_CUDNN_GLOB],
                "discovered_files": {},
                "load_error": "",
                "path_configured": False,
                "progress": snapshot,
            }

        discovered_files: dict[str, str] = {}
        missing_files: list[str] = []
        search_dirs = self._candidate_search_dirs(install_dir)
        for dll_name in _REQUIRED_DLLS:
            resolved = self._resolve_file(dll_name, search_dirs)
            if resolved:
                discovered_files[dll_name] = resolved
            else:
                missing_files.append(dll_name)

        cudnn_path = self._resolve_glob(_CUDNN_GLOB, search_dirs)
        if cudnn_path:
            discovered_files[_CUDNN_GLOB] = cudnn_path
        else:
            missing_files.append(_CUDNN_GLOB)

        load_error = ""
        ready = not missing_files
        if ready:
            load_error = self._validate_loadability(discovered_files)
            ready = not load_error

        path_configured = self._path_contains(bin_dir)
        status: RuntimeStatus
        if snapshot["state"] == "installing":
            status = "installing"
        elif snapshot["state"] == "failed":
            status = "failed"
        elif ready:
            status = "ready"
        else:
            status = "not_ready"

        message = self._build_message(status=status, ready=ready, missing_files=missing_files, load_error=load_error)
        return {
            "install_dir": install_dir,
            "auto_configure_env": config["auto_configure_env"],
            "version_label": _BUNDLE_VERSION_LABEL,
            "platform_supported": True,
            "ready": ready,
            "status": status,
            "message": message,
            "bin_dir": bin_dir,
            "missing_files": missing_files,
            "discovered_files": discovered_files,
            "load_error": load_error,
            "path_configured": path_configured,
            "progress": snapshot,
        }

    def _configure_process_environment(self, install_dir: str) -> None:
        if not install_dir:
            return
        install_path = Path(install_dir)
        bin_path = install_path / "bin"
        if not bin_path.exists():
            return

        current_path = os.environ.get("PATH", "")
        entries = [entry for entry in current_path.split(os.pathsep) if entry]
        normalized_entries = {Path(entry).resolve().as_posix().lower() for entry in entries if Path(entry).exists()}
        normalized_bin = bin_path.resolve().as_posix().lower()
        if normalized_bin not in normalized_entries:
            os.environ["PATH"] = f"{bin_path}{os.pathsep}{current_path}" if current_path else str(bin_path)
        os.environ["CUDA_PATH"] = str(install_path.resolve())
        os.environ["VIDGNOST_WHISPER_GPU_RUNTIME_ROOT"] = str(install_path.resolve())

    @staticmethod
    def _candidate_search_dirs(install_dir: str) -> list[Path]:
        candidates: list[Path] = []
        seen: set[str] = set()

        def append(path: Path) -> None:
            try:
                resolved = path.resolve()
            except OSError:
                return
            key = resolved.as_posix().lower()
            if key in seen or not resolved.exists():
                return
            seen.add(key)
            candidates.append(resolved)

        if install_dir:
            append(Path(install_dir) / "bin")
        for raw_entry in os.environ.get("PATH", "").split(os.pathsep):
            if not raw_entry.strip():
                continue
            append(Path(raw_entry.strip()))
        return candidates

    @staticmethod
    def _resolve_file(file_name: str, search_dirs: list[Path]) -> str:
        lowered = file_name.lower()
        for directory in search_dirs:
            candidate = directory / file_name
            if candidate.exists():
                return str(candidate.resolve())
            for path in directory.glob("*"):
                if path.name.lower() == lowered:
                    return str(path.resolve())
        return ""

    @staticmethod
    def _resolve_glob(pattern: str, search_dirs: list[Path]) -> str:
        for directory in search_dirs:
            for candidate in directory.glob(pattern):
                if candidate.is_file():
                    return str(candidate.resolve())
        return ""

    @staticmethod
    def _validate_loadability(discovered_files: dict[str, str]) -> str:
        if not sys.platform.startswith("win"):
            return ""
        try:
            ctypes.WinDLL(discovered_files["cublas64_12.dll"])
        except OSError as exc:
            return str(exc)
        cudnn_target = discovered_files.get("cudnn64*.dll", "")
        if cudnn_target:
            try:
                ctypes.WinDLL(cudnn_target)
            except OSError as exc:
                return str(exc)
        return ""

    @staticmethod
    def _build_message(
        *,
        status: RuntimeStatus,
        ready: bool,
        missing_files: list[str],
        load_error: str,
    ) -> str:
        if status == "installing":
            return "正在安装 Whisper GPU 运行库。"
        if ready:
            return "Whisper GPU 运行库已就绪。"
        if load_error:
            return f"运行库文件已找到，但加载失败：{load_error}"
        if missing_files:
            return f"缺少运行库文件：{', '.join(missing_files)}"
        return "Whisper GPU 运行库未就绪。"

    @staticmethod
    def _path_contains(bin_dir: str) -> bool:
        normalized = Path(bin_dir).resolve().as_posix().lower()
        for entry in os.environ.get("PATH", "").split(os.pathsep):
            try:
                if Path(entry).resolve().as_posix().lower() == normalized:
                    return True
            except OSError:
                continue
        return False

    @staticmethod
    def _is_windows() -> bool:
        return sys.platform.startswith("win")
