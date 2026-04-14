from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path
from typing import Literal, TypedDict

from app.config import Settings
from app.errors import AppError
from app.services.ollama_runtime_config_store import OllamaRuntimeConfigStore

RuntimeStatus = Literal["ready", "not_ready", "unsupported"]

_VERSION_LABEL = "Ollama Bundled CUDA Runtime"
_REQUIRED_FILES = ("cublas64_12.dll", "cudart64_12.dll")
_OPTIONAL_PATTERNS = ("cudnn64*.dll",)


class RuntimeInstallSnapshot(TypedDict):
    state: Literal["idle", "installing", "paused", "completed", "failed"]
    message: str
    current_package: str
    downloaded_bytes: int
    total_bytes: int
    percent: float
    speed_bps: float
    resumable: bool
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


class WhisperGpuRuntimeService:
    def __init__(
        self,
        settings: Settings,
        *,
        runtime_config_store: object | None = None,  # noqa: ARG002
        ollama_runtime_config_store: OllamaRuntimeConfigStore | None = None,
    ) -> None:
        self._settings = settings
        self._ollama_runtime_config_store = ollama_runtime_config_store or OllamaRuntimeConfigStore(settings)
        self._dll_directory_handles: list[object] = []

    async def bootstrap_process_environment(self) -> None:
        if not self._is_windows():
            return
        config = self._ollama_runtime_config_store.get_sync()
        runtime_dirs = self._discover_runtime_dirs(Path(config["install_dir"]))
        self._configure_process_environment(runtime_dirs)

    async def get_status(self) -> RuntimeStatusPayload:
        config = self._ollama_runtime_config_store.get_sync()
        install_dir = str(Path(config["install_dir"]).expanduser().resolve())
        if not self._is_windows():
            return self._build_payload(
                install_dir=install_dir,
                runtime_dirs=[],
                discovered_files={},
                missing_files=[*_REQUIRED_FILES, *_OPTIONAL_PATTERNS],
                load_error="",
                status="unsupported",
                message="当前平台不支持自动探测 Whisper GPU 运行时。",
            )

        runtime_dirs = self._discover_runtime_dirs(Path(install_dir))
        self._configure_process_environment(runtime_dirs)
        discovered_files = self._discover_required_files(runtime_dirs)
        missing_files = self._collect_missing_files(discovered_files)
        load_error = ""
        status: RuntimeStatus = "not_ready"
        message = "未在当前 Ollama 安装目录中发现 Whisper 所需的 CUDA 运行库。"

        if not missing_files:
            load_error = self._validate_loadability(discovered_files)
            if not load_error:
                status = "ready"
                message = "Whisper 已检测到 Ollama 自带的 GPU 运行库。"
            else:
                message = f"已找到 Ollama 自带运行库，但加载失败：{load_error}"
        elif runtime_dirs:
            message = f"已发现部分 Ollama GPU 运行库目录，但仍缺少：{', '.join(missing_files)}"

        return self._build_payload(
            install_dir=install_dir,
            runtime_dirs=runtime_dirs,
            discovered_files=discovered_files,
            missing_files=missing_files,
            load_error=load_error,
            status=status,
            message=message,
        )

    async def shutdown(self) -> None:
        self._dll_directory_handles.clear()

    def assert_runtime_ready_for_device(self, device: str, status: RuntimeStatusPayload) -> None:
        normalized_device = str(device or "").strip().lower()
        if normalized_device == "cpu":
            return
        if status["platform_supported"] and status["ready"]:
            return

        hint_parts = [
            "请先确认 Ollama 已安装完整 GPU 运行时，并在设置中心刷新检测后重试。",
        ]
        if status["install_dir"]:
            hint_parts.append(f"Ollama 安装目录：{status['install_dir']}")
        if status["missing_files"]:
            hint_parts.append(f"缺失文件：{', '.join(status['missing_files'])}")
        if status["load_error"]:
            hint_parts.append(f"加载错误：{status['load_error']}")

        raise AppError.conflict(
            "运行前检查失败：Whisper GPU 运行库未就绪。",
            code="TASK_PRECHECK_WHISPER_GPU_RUNTIME_MISSING",
            hint=" ".join(hint_parts),
        )

    def _build_payload(
        self,
        *,
        install_dir: str,
        runtime_dirs: list[Path],
        discovered_files: dict[str, str],
        missing_files: list[str],
        load_error: str,
        status: RuntimeStatus,
        message: str,
    ) -> RuntimeStatusPayload:
        return {
            "install_dir": install_dir,
            "auto_configure_env": True,
            "version_label": _VERSION_LABEL,
            "platform_supported": self._is_windows(),
            "ready": status == "ready",
            "status": status,
            "message": message,
            "bin_dir": str(runtime_dirs[0]) if runtime_dirs else "",
            "missing_files": missing_files,
            "discovered_files": discovered_files,
            "load_error": load_error,
            "path_configured": self._path_contains(runtime_dirs),
            "progress": {
                "state": "idle",
                "message": "",
                "current_package": "",
                "downloaded_bytes": 0,
                "total_bytes": 0,
                "percent": 0.0,
                "speed_bps": 0.0,
                "resumable": False,
                "updated_at": "",
            },
        }

    def _configure_process_environment(self, runtime_dirs: list[Path]) -> None:
        if not runtime_dirs:
            return

        current_path = os.environ.get("PATH", "")
        entries = [entry for entry in current_path.split(os.pathsep) if entry]
        normalized_entries = {self._normalize_path(entry) for entry in entries}
        next_entries = list(entries)

        for runtime_dir in reversed(runtime_dirs):
            normalized_dir = self._normalize_path(runtime_dir)
            if normalized_dir not in normalized_entries:
                next_entries.insert(0, str(runtime_dir))
                normalized_entries.add(normalized_dir)

        os.environ["PATH"] = os.pathsep.join(next_entries)
        if runtime_dirs:
            os.environ["CUDA_PATH"] = str(runtime_dirs[0].parent)

        if hasattr(os, "add_dll_directory"):
            self._dll_directory_handles.clear()
            for runtime_dir in runtime_dirs:
                try:
                    self._dll_directory_handles.append(os.add_dll_directory(str(runtime_dir)))
                except (FileNotFoundError, OSError):
                    continue

    def _discover_runtime_dirs(self, install_dir: Path) -> list[Path]:
        candidates: list[Path] = []
        seen: set[str] = set()

        def append(directory: Path) -> None:
            try:
                resolved = directory.resolve()
            except OSError:
                return
            key = resolved.as_posix().casefold()
            if key in seen or not resolved.exists():
                return
            seen.add(key)
            candidates.append(resolved)

        for root in [install_dir]:
            if not root.exists():
                continue
            for target_name in _REQUIRED_FILES:
                for match in root.rglob(target_name):
                    append(match.parent)
            for pattern in _OPTIONAL_PATTERNS:
                for match in root.rglob(pattern):
                    append(match.parent)

        for entry in os.environ.get("PATH", "").split(os.pathsep):
            if not entry.strip():
                continue
            try:
                root = Path(entry).expanduser().resolve()
            except OSError:
                continue
            if not root.exists():
                continue
            root_key = root.as_posix().casefold()
            recursive = "ollama" in root_key or "cuda" in root_key
            for target_name in _REQUIRED_FILES:
                iterator = root.rglob(target_name) if recursive else root.glob(target_name)
                for match in iterator:
                    append(match.parent)
            for pattern in _OPTIONAL_PATTERNS:
                iterator = root.rglob(pattern) if recursive else root.glob(pattern)
                for match in iterator:
                    append(match.parent)

        preferred_dirs = [
            path
            for path in candidates
            if "ollama" in path.as_posix().casefold()
        ]
        fallback_dirs = [path for path in candidates if path not in preferred_dirs]
        return preferred_dirs + fallback_dirs

    def _discover_required_files(self, runtime_dirs: list[Path]) -> dict[str, str]:
        discovered: dict[str, str] = {}
        for file_name in _REQUIRED_FILES:
            resolved = self._resolve_file(file_name, runtime_dirs)
            if resolved:
                discovered[file_name] = resolved
        for pattern in _OPTIONAL_PATTERNS:
            resolved = self._resolve_glob(pattern, runtime_dirs)
            if resolved:
                discovered[pattern] = resolved
        return discovered

    def _collect_missing_files(self, discovered_files: dict[str, str]) -> list[str]:
        missing = [name for name in _REQUIRED_FILES if name not in discovered_files]
        if _OPTIONAL_PATTERNS[0] not in discovered_files:
            missing.append(_OPTIONAL_PATTERNS[0])
        return missing

    @staticmethod
    def _resolve_file(file_name: str, search_dirs: list[Path]) -> str:
        lowered = file_name.casefold()
        for directory in search_dirs:
            for path in directory.glob("*"):
                if path.name.casefold() == lowered:
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
    def _path_contains(runtime_dirs: list[Path]) -> bool:
        if not runtime_dirs:
            return False
        normalized_targets = {WhisperGpuRuntimeService._normalize_path(item) for item in runtime_dirs}
        path_entries = os.environ.get("PATH", "").split(os.pathsep)
        for entry in path_entries:
            if WhisperGpuRuntimeService._normalize_path(entry) in normalized_targets:
                return True
        return False

    @staticmethod
    def _normalize_path(value: str | Path) -> str:
        try:
            return Path(value).expanduser().resolve().as_posix().casefold()
        except OSError:
            return str(value).strip().replace("\\", "/").casefold()

    @staticmethod
    def _is_windows() -> bool:
        return sys.platform.startswith("win")
