from __future__ import annotations

import asyncio
import ctypes
import json
import math
import os
import shutil
import sys
import time
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Literal, TypedDict

import httpx

from app.config import Settings
from app.errors import AppError
from app.services.runtime_config_store import (
    RuntimeConfigStore,
    WhisperRuntimeLibrariesConfig,
    _default_runtime_libraries_install_dir,
)

InstallState = Literal["idle", "installing", "paused", "completed", "failed"]
RuntimeStatus = Literal["ready", "not_ready", "installing", "paused", "failed", "unsupported"]

_CUDA_REDIST_VERSION = "12.9.1"
_CUDNN_REDIST_VERSION = "9.20.0"
_BUNDLE_VERSION_LABEL = f"CUDA {_CUDA_REDIST_VERSION} + cuDNN {_CUDNN_REDIST_VERSION}"
_REQUIRED_DLLS = ("cublas64_12.dll", "cudart64_12.dll")
_NVJITLINK_GLOB = "nvJitLink*.dll"
_CUDNN_GLOB = "cudnn64*.dll"
_INSTALLER_SCRIPT_RELATIVE_PATH = Path("..") / ".." / ".." / "scripts" / "install-whisper-gpu-runtime.ps1"
_CUDA_MANIFEST_URL = f"https://developer.download.nvidia.com/compute/cuda/redist/redistrib_{_CUDA_REDIST_VERSION}.json"
_CUDNN_MANIFEST_URL = (
    f"https://developer.download.nvidia.com/compute/cudnn/redist/redistrib_{_CUDNN_REDIST_VERSION}.json"
)
_CUDA_BASE_URL = "https://developer.download.nvidia.com/compute/cuda/redist"
_CUDNN_BASE_URL = "https://developer.download.nvidia.com/compute/cudnn/redist"
_CUDA_COMPONENTS = (
    "cuda_cudart",
    "cuda_nvrtc",
    "libcublas",
    "libcufft",
    "libcurand",
    "libcusolver",
    "libcusparse",
    "libnvjitlink",
    "libnpp",
)
_DOWNLOAD_DIR_NAME = ".downloads"
_ARCHIVE_DIR_NAME = "archives"
_STATE_FILE_NAME = ".vidgnost-whisper-gpu-runtime.install-state.json"
_RUNTIME_MANIFEST_FILE_NAME = ".vidgnost-whisper-gpu-runtime.json"
_DOWNLOAD_CHUNK_SIZE = 1024 * 512
_PACKAGE_DOWNLOAD_CONCURRENCY = 3
_MAX_CONNECTIONS = 96
_MAX_KEEPALIVE_CONNECTIONS = 48
_RANGE_SEGMENT_THRESHOLD_BYTES = 24 * 1024 * 1024
_RANGE_SEGMENT_TARGET_BYTES = 16 * 1024 * 1024
_RANGE_SEGMENT_MAX_COUNT = 8


class RuntimeInstallSnapshot(TypedDict):
    state: InstallState
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


@dataclass(slots=True)
class _RuntimePackageSpec:
    id: str
    name: str
    relative_path: str
    size: int
    url: str
    archive_name: str


@dataclass(slots=True)
class _ProgressTracker:
    total_bytes: int
    downloaded_bytes: int
    starting_downloaded_bytes: int
    started_at: float = field(default_factory=time.perf_counter)
    last_emit_at: float = 0.0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


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
    speed_bps: float = 0.0,
    resumable: bool = False,
) -> RuntimeInstallSnapshot:
    normalized_total = max(0, int(total_bytes))
    normalized_downloaded = max(0, int(downloaded_bytes))
    normalized_percent = float(percent)
    if normalized_total > 0:
        normalized_percent = min(100.0, max(0.0, (normalized_downloaded / normalized_total) * 100.0))
    return {
        "state": state,
        "message": message,
        "current_package": current_package,
        "downloaded_bytes": normalized_downloaded,
        "total_bytes": normalized_total,
        "percent": max(0.0, min(100.0, normalized_percent)),
        "speed_bps": max(0.0, float(speed_bps)),
        "resumable": bool(resumable),
        "updated_at": _utc_now_iso(),
    }


class _PauseRequested(Exception):
    pass


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
        self._active_install_dir = ""
        self._pause_requested = False
        self._service_file = Path(__file__).resolve()
        self._installer_script = (self._service_file.parent / _INSTALLER_SCRIPT_RELATIVE_PATH).resolve()

    async def bootstrap_process_environment(self) -> None:
        config = await self._runtime_config_store.get_whisper_runtime_libraries()
        self._configure_process_environment(config["install_dir"])

    async def get_status(self) -> RuntimeStatusPayload:
        config = await self._runtime_config_store.get_whisper_runtime_libraries()
        self._configure_process_environment(config["install_dir"])
        snapshot = await self._load_snapshot_for_install_dir(config["install_dir"])
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
        if config["auto_configure_env"] and self._is_windows() and (Path(config["install_dir"]) / "bin").exists():
            await asyncio.to_thread(self._configure_user_environment, config["install_dir"])
        snapshot = await self._load_snapshot_for_install_dir(config["install_dir"])
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
                "当前平台不支持自动安装转写 CUDA 运行库。",
                code="WHISPER_GPU_RUNTIME_UNSUPPORTED",
                hint="当前自动安装流程仅支持 Windows 桌面环境。",
            )

        async with self._lock:
            if self._task is not None and not self._task.done():
                return self._probe_status(config=config, snapshot=dict(self._snapshot))

            install_path = config["install_dir"].strip() or _default_runtime_libraries_install_dir(self._settings)
            resumable = self._has_resume_artifacts(install_path)
            self._active_install_dir = install_path
            self._pause_requested = False
            self._snapshot = _build_snapshot(
                state="installing",
                message="检测到未完成下载，正在继续安装。" if resumable else "准备下载并安装转写 CUDA 运行库。",
                resumable=resumable,
            )
            self._persist_snapshot(install_path, self._snapshot)
            self._task = asyncio.create_task(self._run_install(config))
            snapshot = dict(self._snapshot)
        return self._probe_status(config=config, snapshot=snapshot)

    async def pause_install(self) -> RuntimeStatusPayload:
        config = await self._runtime_config_store.get_whisper_runtime_libraries()
        async with self._lock:
            task = self._task
            if task is None or task.done():
                snapshot = dict(self._snapshot)
                return self._probe_status(config=config, snapshot=snapshot)
            self._pause_requested = True

        try:
            await task
        except asyncio.CancelledError:
            pass
        snapshot = await self._load_snapshot_for_install_dir(config["install_dir"])
        return self._probe_status(config=config, snapshot=snapshot)

    async def resume_install(self) -> RuntimeStatusPayload:
        return await self.start_install()

    async def shutdown(self) -> None:
        async with self._lock:
            task = self._task
            self._pause_requested = True
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
            "请先在设置中心的语音转写模型区域安装完整转写 CUDA 运行库，或切换回 CPU 模式。",
        ]
        if status["install_dir"]:
            hint_parts.append(f"当前安装目录：{status['install_dir']}")
        if status["missing_files"]:
            hint_parts.append(f"缺失文件：{', '.join(status['missing_files'])}")
        if status["load_error"]:
            hint_parts.append(f"加载错误：{status['load_error']}")
        if status["progress"]["state"] == "paused":
            hint_parts.append("当前下载已暂停，可在设置中心继续安装。")

        raise AppError.conflict(
            "运行前检查失败：转写 CUDA 运行库未就绪。",
            code="TASK_PRECHECK_WHISPER_GPU_RUNTIME_MISSING",
            hint=" ".join(hint_parts),
        )

    async def _run_install(self, config: WhisperRuntimeLibrariesConfig) -> None:
        install_dir = config["install_dir"].strip() or _default_runtime_libraries_install_dir(self._settings)
        packages: list[_RuntimePackageSpec] = []
        try:
            limits = httpx.Limits(
                max_connections=_MAX_CONNECTIONS,
                max_keepalive_connections=_MAX_KEEPALIVE_CONNECTIONS,
                keepalive_expiry=30.0,
            )
            timeout = httpx.Timeout(connect=20.0, read=120.0, write=120.0, pool=60.0)
            async with httpx.AsyncClient(http2=True, follow_redirects=True, limits=limits, timeout=timeout) as client:
                await self._set_snapshot(
                    _build_snapshot(
                        state="installing",
                        message="正在拉取 NVIDIA 官方运行库清单...",
                        resumable=self._has_resume_artifacts(install_dir),
                    ),
                    install_dir=install_dir,
                )
                packages = await self._resolve_package_specs(client)
                total_bytes = sum(max(0, package.size) for package in packages)
                initial_bytes = sum(self._downloaded_archive_bytes(install_dir, package) for package in packages)
                tracker = _ProgressTracker(
                    total_bytes=total_bytes,
                    downloaded_bytes=initial_bytes,
                    starting_downloaded_bytes=initial_bytes,
                )

                await self._emit_install_progress(
                    install_dir=install_dir,
                    tracker=tracker,
                    current_package="",
                    message="检测到未完成下载，正在继续拉取运行库组件..."
                    if initial_bytes > 0
                    else "正在下载转写 CUDA 运行库组件...",
                    force=True,
                )
                await self._download_archives(client=client, install_dir=install_dir, packages=packages, tracker=tracker)

            await self._set_snapshot(
                _build_snapshot(
                    state="installing",
                    message="运行库压缩包已准备完成，正在整理文件...",
                    downloaded_bytes=tracker.total_bytes,
                    total_bytes=tracker.total_bytes,
                    percent=100.0,
                    resumable=True,
                ),
                install_dir=install_dir,
            )

            await self._install_archives(install_dir=install_dir, packages=packages)
            self._write_runtime_manifest(install_dir, packages)
            self._configure_process_environment(install_dir)
            if config["auto_configure_env"]:
                await asyncio.to_thread(self._configure_user_environment, install_dir)

            final_snapshot = _build_snapshot(
                state="completed",
                message="转写 CUDA 运行库已安装并完成环境配置。",
                downloaded_bytes=tracker.total_bytes,
                total_bytes=tracker.total_bytes,
                percent=100.0,
                resumable=False,
            )
            status = self._probe_status(config=config, snapshot=final_snapshot)
            if status["ready"]:
                self._cleanup_download_artifacts(install_dir)
                await self._set_snapshot(final_snapshot, install_dir=install_dir)
                return

            await self._set_snapshot(
                _build_snapshot(
                    state="failed",
                    message=status["load_error"] or status["message"] or "安装完成，但运行库仍未通过校验。",
                    downloaded_bytes=tracker.total_bytes,
                    total_bytes=tracker.total_bytes,
                    percent=100.0,
                    resumable=self._has_resume_artifacts(install_dir),
                ),
                install_dir=install_dir,
            )
        except _PauseRequested:
            current = await self._snapshot_copy()
            await self._set_snapshot(
                _build_snapshot(
                    state="paused",
                    message="下载已暂停，可随时继续。",
                    current_package=current["current_package"],
                    downloaded_bytes=current["downloaded_bytes"],
                    total_bytes=current["total_bytes"],
                    percent=current["percent"],
                    speed_bps=0.0,
                    resumable=self._has_resume_artifacts(install_dir),
                ),
                install_dir=install_dir,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            current = await self._snapshot_copy()
            await self._set_snapshot(
                _build_snapshot(
                    state="failed",
                    message=f"转写 CUDA 运行库安装失败：{exc}",
                    current_package=current["current_package"],
                    downloaded_bytes=current["downloaded_bytes"],
                    total_bytes=current["total_bytes"],
                    percent=current["percent"],
                    speed_bps=0.0,
                    resumable=self._has_resume_artifacts(install_dir),
                ),
                install_dir=install_dir,
            )
        finally:
            async with self._lock:
                if self._task is asyncio.current_task():
                    self._task = None
                self._pause_requested = False

    async def _resolve_package_specs(self, client: httpx.AsyncClient) -> list[_RuntimePackageSpec]:
        cuda_manifest_response = await client.get(_CUDA_MANIFEST_URL)
        cuda_manifest_response.raise_for_status()
        cudnn_manifest_response = await client.get(_CUDNN_MANIFEST_URL)
        cudnn_manifest_response.raise_for_status()

        cuda_manifest = cuda_manifest_response.json()
        cudnn_manifest = cudnn_manifest_response.json()
        packages: list[_RuntimePackageSpec] = []
        for component in _CUDA_COMPONENTS:
            node = ((cuda_manifest.get(component) or {}).get("windows-x86_64") or {})
            relative_path = str(node.get("relative_path", "")).strip()
            if not relative_path:
                raise RuntimeError(f"CUDA redist manifest does not contain component: {component}")
            archive_name = PurePosixPath(relative_path).name
            packages.append(
                _RuntimePackageSpec(
                    id=component,
                    name=component,
                    relative_path=relative_path,
                    size=max(0, int(node.get("size", 0) or 0)),
                    url=f"{_CUDA_BASE_URL}/{relative_path}",
                    archive_name=archive_name,
                )
            )

        cudnn_node = ((((cudnn_manifest.get("cudnn") or {}).get("windows-x86_64") or {}).get("cuda12")) or {})
        cudnn_relative_path = str(cudnn_node.get("relative_path", "")).strip()
        if not cudnn_relative_path:
            raise RuntimeError("cuDNN redist manifest does not contain windows-x86_64.cuda12 package.")
        packages.append(
            _RuntimePackageSpec(
                id="cudnn",
                name="cudnn",
                relative_path=cudnn_relative_path,
                size=max(0, int(cudnn_node.get("size", 0) or 0)),
                url=f"{_CUDNN_BASE_URL}/{cudnn_relative_path}",
                archive_name=PurePosixPath(cudnn_relative_path).name,
            )
        )
        return packages

    async def _download_archives(
        self,
        *,
        client: httpx.AsyncClient,
        install_dir: str,
        packages: list[_RuntimePackageSpec],
        tracker: _ProgressTracker,
    ) -> None:
        self._ensure_download_dirs(install_dir)
        semaphore = asyncio.Semaphore(_PACKAGE_DOWNLOAD_CONCURRENCY)
        tasks = [
            asyncio.create_task(
                self._download_single_package(
                    client=client,
                    install_dir=install_dir,
                    package=package,
                    semaphore=semaphore,
                    tracker=tracker,
                )
            )
            for package in packages
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            await asyncio.gather(*tasks, return_exceptions=True)

        if self._pause_requested:
            raise _PauseRequested()

        for package in packages:
            archive_path = self._archive_path(install_dir, package)
            if not archive_path.exists() or archive_path.stat().st_size != package.size:
                raise RuntimeError(f"运行库压缩包下载不完整：{package.name}")

    async def _download_single_package(
        self,
        *,
        client: httpx.AsyncClient,
        install_dir: str,
        package: _RuntimePackageSpec,
        semaphore: asyncio.Semaphore,
        tracker: _ProgressTracker,
    ) -> None:
        async with semaphore:
            if self._pause_requested:
                return

            archive_path = self._archive_path(install_dir, package)
            if archive_path.exists() and archive_path.stat().st_size == package.size:
                return

            supports_range = package.size >= _RANGE_SEGMENT_THRESHOLD_BYTES and await self._supports_range_download(
                client,
                package.url,
            )
            if supports_range:
                await self._download_file_by_ranges(
                    client=client,
                    package=package,
                    install_dir=install_dir,
                    tracker=tracker,
                )
            else:
                await self._download_file_streaming(
                    client=client,
                    package=package,
                    install_dir=install_dir,
                    tracker=tracker,
                )

    async def _download_file_streaming(
        self,
        *,
        client: httpx.AsyncClient,
        package: _RuntimePackageSpec,
        install_dir: str,
        tracker: _ProgressTracker,
    ) -> None:
        archive_path = self._archive_path(install_dir, package)
        temp_path = self._partial_download_path(archive_path)
        if archive_path.exists() and archive_path.stat().st_size == package.size:
            return
        if archive_path.exists() and archive_path.stat().st_size != package.size:
            archive_path.unlink(missing_ok=True)

        async def stream_from(offset: int) -> int:
            headers: dict[str, str] = {}
            mode = "wb"
            if offset > 0:
                headers["Range"] = f"bytes={offset}-"
                mode = "ab"
            async with client.stream("GET", package.url, headers=headers) as response:
                if offset > 0 and response.status_code != 206:
                    return 0
                response.raise_for_status()
                with temp_path.open(mode) as output:
                    async for chunk in response.aiter_bytes(_DOWNLOAD_CHUNK_SIZE):
                        if not chunk:
                            continue
                        output.write(chunk)
                        await self._emit_install_progress(
                            install_dir=install_dir,
                            tracker=tracker,
                            current_package=package.name,
                            message=f"正在下载 {package.name} ...",
                            delta=len(chunk),
                        )
                        if self._pause_requested:
                            return 1
            return 2

        temp_path.parent.mkdir(parents=True, exist_ok=True)
        offset = min(package.size, temp_path.stat().st_size) if temp_path.exists() else 0
        if offset >= package.size and package.size > 0:
            temp_path.replace(archive_path)
            return

        result = await stream_from(offset)
        if result == 0:
            temp_path.unlink(missing_ok=True)
            result = await stream_from(0)

        if self._pause_requested or result == 1:
            return

        if temp_path.stat().st_size != package.size:
            raise RuntimeError(f"{package.name} 下载大小异常：{temp_path.stat().st_size} != {package.size}")
        temp_path.replace(archive_path)

    async def _download_file_by_ranges(
        self,
        *,
        client: httpx.AsyncClient,
        package: _RuntimePackageSpec,
        install_dir: str,
        tracker: _ProgressTracker,
    ) -> None:
        archive_path = self._archive_path(install_dir, package)
        if archive_path.exists() and archive_path.stat().st_size == package.size:
            return
        if archive_path.exists() and archive_path.stat().st_size != package.size:
            archive_path.unlink(missing_ok=True)

        part_dir = self._parts_dir(archive_path)
        part_dir.mkdir(parents=True, exist_ok=True)
        ranges = self._build_range_parts(package.size, part_dir)

        async def download_range(start: int, end: int, part_path: Path) -> None:
            expected_bytes = max(0, end - start + 1)
            existing_bytes = min(expected_bytes, part_path.stat().st_size) if part_path.exists() else 0
            if existing_bytes >= expected_bytes:
                return
            headers = {"Range": f"bytes={start + existing_bytes}-{end}"}
            async with client.stream("GET", package.url, headers=headers) as response:
                if response.status_code != 206:
                    raise RuntimeError(f"Range 请求失败：{package.name} 返回 {response.status_code}")
                with part_path.open("ab" if existing_bytes > 0 else "wb") as output:
                    async for chunk in response.aiter_bytes(_DOWNLOAD_CHUNK_SIZE):
                        if not chunk:
                            continue
                        output.write(chunk)
                        await self._emit_install_progress(
                            install_dir=install_dir,
                            tracker=tracker,
                            current_package=package.name,
                            message=f"正在下载 {package.name} ...",
                            delta=len(chunk),
                        )
                        if self._pause_requested:
                            return

        tasks = [asyncio.create_task(download_range(start, end, part_path)) for start, end, part_path in ranges]
        try:
            await asyncio.gather(*tasks)
        finally:
            await asyncio.gather(*tasks, return_exceptions=True)

        if self._pause_requested:
            return

        for start, end, part_path in ranges:
            expected_bytes = max(0, end - start + 1)
            actual_bytes = part_path.stat().st_size if part_path.exists() else 0
            if actual_bytes != expected_bytes:
                raise RuntimeError(f"{package.name} 分片下载不完整：{part_path.name}")

        temp_path = self._partial_download_path(archive_path)
        temp_path.unlink(missing_ok=True)
        with temp_path.open("wb") as output:
            for _, _, part_path in ranges:
                with part_path.open("rb") as source:
                    shutil.copyfileobj(source, output, length=_DOWNLOAD_CHUNK_SIZE)
        if temp_path.stat().st_size != package.size:
            raise RuntimeError(f"{package.name} 合并后大小异常：{temp_path.stat().st_size} != {package.size}")
        temp_path.replace(archive_path)

    async def _install_archives(self, *, install_dir: str, packages: list[_RuntimePackageSpec]) -> None:
        target_root = Path(install_dir)
        (target_root / "bin").mkdir(parents=True, exist_ok=True)
        (target_root / "lib").mkdir(parents=True, exist_ok=True)
        (target_root / "include").mkdir(parents=True, exist_ok=True)

        for package in packages:
            if self._pause_requested:
                raise _PauseRequested()
            current = await self._snapshot_copy()
            await self._set_snapshot(
                _build_snapshot(
                    state="installing",
                    message=f"正在整理 {package.name} 运行库文件...",
                    current_package=package.name,
                    downloaded_bytes=current["downloaded_bytes"],
                    total_bytes=current["total_bytes"],
                    percent=current["percent"],
                    resumable=True,
                ),
                install_dir=install_dir,
            )
            completed = await asyncio.to_thread(
                self._extract_archive_to_install_dir,
                self._archive_path(install_dir, package),
                target_root,
            )
            if not completed or self._pause_requested:
                raise _PauseRequested()

    def _extract_archive_to_install_dir(self, archive_path: Path, target_root: Path) -> bool:
        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.infolist():
                if member.is_dir():
                    continue
                destination = self._destination_for_archive_member(target_root, member.filename)
                if destination is None:
                    continue
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member, "r") as source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output, length=_DOWNLOAD_CHUNK_SIZE)
                if self._pause_requested:
                    return False
        return True

    async def _emit_install_progress(
        self,
        *,
        install_dir: str,
        tracker: _ProgressTracker,
        current_package: str,
        message: str,
        delta: int = 0,
        force: bool = False,
    ) -> None:
        async with tracker.lock:
            tracker.downloaded_bytes = min(
                tracker.total_bytes,
                max(0, tracker.downloaded_bytes + max(0, int(delta))),
            )
            now = time.perf_counter()
            should_emit = force or now - tracker.last_emit_at >= 0.2 or tracker.downloaded_bytes >= tracker.total_bytes
            if not should_emit:
                return
            elapsed = max(0.001, now - tracker.started_at)
            session_downloaded_bytes = max(0, tracker.downloaded_bytes - tracker.starting_downloaded_bytes)
            speed_bps = session_downloaded_bytes / elapsed
            tracker.last_emit_at = now
            snapshot = _build_snapshot(
                state="installing",
                message=message,
                current_package=current_package,
                downloaded_bytes=tracker.downloaded_bytes,
                total_bytes=tracker.total_bytes,
                speed_bps=speed_bps,
                resumable=tracker.downloaded_bytes < tracker.total_bytes or self._has_resume_artifacts(install_dir),
            )
        await self._set_snapshot(snapshot, install_dir=install_dir)

    async def _snapshot_copy(self) -> RuntimeInstallSnapshot:
        async with self._lock:
            return dict(self._snapshot)

    async def _set_snapshot(self, snapshot: RuntimeInstallSnapshot, *, install_dir: str | None = None) -> None:
        target_dir = install_dir or self._active_install_dir
        async with self._lock:
            self._snapshot = snapshot
            if target_dir:
                self._active_install_dir = target_dir
        if target_dir:
            self._persist_snapshot(target_dir, snapshot)

    async def _load_snapshot_for_install_dir(self, install_dir: str) -> RuntimeInstallSnapshot:
        async with self._lock:
            if self._task is not None and not self._task.done():
                return dict(self._snapshot)
        snapshot = self._load_persisted_snapshot(install_dir)
        async with self._lock:
            if self._task is None or self._task.done():
                self._active_install_dir = install_dir
                self._snapshot = snapshot
            return dict(self._snapshot)

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
                "message": "当前平台不支持自动安装转写 CUDA 运行库。",
                "bin_dir": bin_dir,
                "missing_files": list(_REQUIRED_DLLS) + [_NVJITLINK_GLOB, _CUDNN_GLOB],
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

        nvjitlink_path = self._resolve_glob(_NVJITLINK_GLOB, search_dirs)
        if nvjitlink_path:
            discovered_files[_NVJITLINK_GLOB] = nvjitlink_path
        else:
            missing_files.append(_NVJITLINK_GLOB)

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

        if ready and snapshot["state"] != "installing":
            snapshot = _build_snapshot(
                state="completed",
                message="转写 CUDA 运行库已安装并完成环境配置。",
                current_package=snapshot["current_package"],
                downloaded_bytes=max(snapshot["downloaded_bytes"], snapshot["total_bytes"]),
                total_bytes=max(snapshot["total_bytes"], snapshot["downloaded_bytes"]),
                percent=100.0,
                resumable=False,
            )

        path_configured = self._path_contains(self._runtime_bin_dirs(install_dir))
        if ready:
            status: RuntimeStatus = "ready"
        elif snapshot["state"] == "installing":
            status = "installing"
        elif snapshot["state"] == "paused":
            status = "paused"
        elif snapshot["state"] == "failed":
            status = "failed"
        else:
            status = "not_ready"

        message = self._build_message(status=status, ready=ready, missing_files=missing_files, load_error=load_error, snapshot=snapshot)
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
        bin_paths = self._runtime_bin_dirs(install_dir)
        if not bin_paths:
            return

        current_path = os.environ.get("PATH", "")
        entries = [entry for entry in current_path.split(os.pathsep) if entry]
        normalized_entries = {Path(entry).resolve().as_posix().lower() for entry in entries if Path(entry).exists()}
        next_path = current_path
        for bin_path in reversed(bin_paths):
            normalized_bin = bin_path.resolve().as_posix().lower()
            if normalized_bin in normalized_entries:
                continue
            next_path = f"{bin_path}{os.pathsep}{next_path}" if next_path else str(bin_path)
            normalized_entries.add(normalized_bin)
        if next_path != current_path:
            os.environ["PATH"] = next_path
        os.environ["CUDA_PATH"] = str(install_path.resolve())
        os.environ["VIDGNOST_WHISPER_GPU_RUNTIME_ROOT"] = str(install_path.resolve())

    def _configure_user_environment(self, install_dir: str) -> None:
        if not self._is_windows():
            return
        install_path = Path(install_dir).resolve()
        bin_paths = self._runtime_bin_dirs(install_dir)
        if not bin_paths:
            return

        import winreg

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            "Environment",
            0,
            winreg.KEY_READ | winreg.KEY_SET_VALUE,
        ) as registry_key:
            existing_path = self._read_registry_value(registry_key, "Path")
            winreg.SetValueEx(registry_key, "CUDA_PATH", 0, winreg.REG_EXPAND_SZ, str(install_path))
            winreg.SetValueEx(
                registry_key,
                "VIDGNOST_WHISPER_GPU_RUNTIME_ROOT",
                0,
                winreg.REG_EXPAND_SZ,
                str(install_path),
            )
            winreg.SetValueEx(
                registry_key,
                "Path",
                0,
                winreg.REG_EXPAND_SZ,
                self._prepend_path_entries(existing_path, [str(path) for path in bin_paths]),
            )
        self._broadcast_environment_change()

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
            for bin_path in WhisperGpuRuntimeService._runtime_bin_dirs(install_dir):
                append(bin_path)
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
        snapshot: RuntimeInstallSnapshot,
    ) -> str:
        if ready:
            return "转写 CUDA 运行库已就绪。"
        if status == "installing":
            return snapshot["message"] or "正在安装转写 CUDA 运行库。"
        if status == "paused":
            return snapshot["message"] or "转写 CUDA 运行库下载已暂停。"
        if load_error:
            return f"运行库文件已找到，但加载失败：{load_error}"
        if missing_files:
            return f"缺少运行库文件：{', '.join(missing_files)}"
        return "转写 CUDA 运行库未就绪。"

    @staticmethod
    def _path_contains(bin_dirs: list[Path]) -> bool:
        if not bin_dirs:
            return False
        normalized_targets = {path.resolve().as_posix().lower() for path in bin_dirs}
        for entry in os.environ.get("PATH", "").split(os.pathsep):
            try:
                if Path(entry).resolve().as_posix().lower() in normalized_targets:
                    return True
            except OSError:
                continue
        return False

    @staticmethod
    def _runtime_bin_dirs(install_dir: str) -> list[Path]:
        if not install_dir:
            return []
        install_path = Path(install_dir)
        candidates = [install_path / "bin", install_path / "bin" / "x64"]
        return [path.resolve() for path in candidates if path.exists()]

    @staticmethod
    def _is_windows() -> bool:
        return sys.platform.startswith("win")

    def _download_root(self, install_dir: str) -> Path:
        return Path(install_dir) / _DOWNLOAD_DIR_NAME

    def _archive_root(self, install_dir: str) -> Path:
        return self._download_root(install_dir) / _ARCHIVE_DIR_NAME

    def _archive_path(self, install_dir: str, package: _RuntimePackageSpec) -> Path:
        return self._archive_root(install_dir) / package.archive_name

    @staticmethod
    def _partial_download_path(archive_path: Path) -> Path:
        return archive_path.with_suffix(archive_path.suffix + ".downloading")

    @staticmethod
    def _parts_dir(archive_path: Path) -> Path:
        return archive_path.parent / f".{archive_path.name}.parts"

    def _state_file_path(self, install_dir: str) -> Path:
        return self._download_root(install_dir) / _STATE_FILE_NAME

    def _runtime_manifest_path(self, install_dir: str) -> Path:
        return Path(install_dir) / _RUNTIME_MANIFEST_FILE_NAME

    def _ensure_download_dirs(self, install_dir: str) -> None:
        self._archive_root(install_dir).mkdir(parents=True, exist_ok=True)

    def _persist_snapshot(self, install_dir: str, snapshot: RuntimeInstallSnapshot) -> None:
        state_path = self._state_file_path(install_dir)
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")

    def _load_persisted_snapshot(self, install_dir: str) -> RuntimeInstallSnapshot:
        state_path = self._state_file_path(install_dir)
        if not state_path.exists():
            resumable = self._has_resume_artifacts(install_dir)
            if resumable:
                return _build_snapshot(
                    state="paused",
                    message="检测到未完成下载，可继续安装。",
                    resumable=True,
                )
            return _build_snapshot()

        try:
            payload = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            resumable = self._has_resume_artifacts(install_dir)
            return _build_snapshot(
                state="paused" if resumable else "idle",
                message="检测到未完成下载，可继续安装。" if resumable else "",
                resumable=resumable,
            )

        state = str(payload.get("state", "idle")).strip().lower()
        resumable = bool(payload.get("resumable", False)) or self._has_resume_artifacts(install_dir)
        if state == "installing":
            state = "paused"
            resumable = True
            message = "检测到上次未完成安装，可继续下载。"
        else:
            message = str(payload.get("message", "")).strip()
        return _build_snapshot(
            state=state if state in {"idle", "installing", "paused", "completed", "failed"} else "idle",  # type: ignore[arg-type]
            message=message,
            current_package=str(payload.get("current_package", "")).strip(),
            downloaded_bytes=int(payload.get("downloaded_bytes", 0) or 0),
            total_bytes=int(payload.get("total_bytes", 0) or 0),
            percent=float(payload.get("percent", 0.0) or 0.0),
            speed_bps=float(payload.get("speed_bps", 0.0) or 0.0),
            resumable=resumable,
        )

    def _has_resume_artifacts(self, install_dir: str) -> bool:
        download_root = self._download_root(install_dir)
        if not download_root.exists():
            return False
        archive_root = self._archive_root(install_dir)
        for path in download_root.rglob("*"):
            if not path.exists():
                continue
            if path.is_dir() and path.name.endswith(".parts"):
                return True
            if path.is_file():
                if path.name.endswith(".downloading"):
                    return True
                if path.parent == archive_root:
                    return True
        return False

    def _downloaded_archive_bytes(self, install_dir: str, package: _RuntimePackageSpec) -> int:
        archive_path = self._archive_path(install_dir, package)
        if archive_path.exists():
            archive_size = archive_path.stat().st_size
            if archive_size == package.size:
                return package.size
            archive_path.unlink(missing_ok=True)

        part_dir = self._parts_dir(archive_path)
        if part_dir.exists():
            downloaded = 0
            for start, end, part_path in self._build_range_parts(package.size, part_dir):
                expected_bytes = max(0, end - start + 1)
                if part_path.exists():
                    downloaded += min(expected_bytes, part_path.stat().st_size)
            if downloaded > 0:
                return min(package.size, downloaded)

        temp_path = self._partial_download_path(archive_path)
        if temp_path.exists():
            return min(package.size, temp_path.stat().st_size)
        return 0

    @staticmethod
    def _build_range_parts(total_bytes: int, part_dir: Path) -> list[tuple[int, int, Path]]:
        segment_count = max(4, min(_RANGE_SEGMENT_MAX_COUNT, math.ceil(total_bytes / _RANGE_SEGMENT_TARGET_BYTES)))
        segment_size = max(1, math.ceil(total_bytes / max(1, segment_count)))
        parts: list[tuple[int, int, Path]] = []
        for index in range(segment_count):
            start = index * segment_size
            if start >= total_bytes:
                break
            end = min(total_bytes - 1, start + segment_size - 1)
            parts.append((start, end, part_dir / f"part-{index:02d}.bin"))
        return parts

    @staticmethod
    async def _supports_range_download(client: httpx.AsyncClient, url: str) -> bool:
        try:
            head = await client.head(url)
            if head.status_code < 400 and "bytes" in str(head.headers.get("accept-ranges", "")).lower():
                return True
        except Exception:  # noqa: BLE001
            pass
        try:
            response = await client.get(url, headers={"Range": "bytes=0-0"})
            return response.status_code == 206
        except Exception:  # noqa: BLE001
            return False

    @staticmethod
    def _destination_for_archive_member(target_root: Path, member_name: str) -> Path | None:
        normalized = PurePosixPath(member_name)
        if normalized.is_absolute() or ".." in normalized.parts:
            return None
        for bucket in ("bin", "lib", "include"):
            if bucket not in normalized.parts:
                continue
            bucket_index = normalized.parts.index(bucket)
            tail_parts = normalized.parts[bucket_index + 1 :]
            if not tail_parts:
                return None
            return target_root / bucket / Path(*tail_parts)
        return None

    def _write_runtime_manifest(self, install_dir: str, packages: list[_RuntimePackageSpec]) -> None:
        manifest = {
            "type": "vidgnost-whisper-gpu-runtime",
            "cuda_redist_version": _CUDA_REDIST_VERSION,
            "cudnn_redist_version": _CUDNN_REDIST_VERSION,
            "generated_at": _utc_now_iso(),
            "install_dir": str(Path(install_dir).resolve()),
            "packages": [
                {
                    "id": package.id,
                    "relative_path": package.relative_path,
                    "size": package.size,
                    "url": package.url,
                }
                for package in packages
            ],
        }
        self._runtime_manifest_path(install_dir).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _cleanup_download_artifacts(self, install_dir: str) -> None:
        download_root = self._download_root(install_dir)
        if download_root.exists():
            shutil.rmtree(download_root, ignore_errors=True)

    @staticmethod
    def _prepend_path_entry(current_value: str, entry: str) -> str:
        parts = [item.strip() for item in current_value.split(";") if item.strip()]
        normalized = {item.lower() for item in parts}
        if entry.lower() not in normalized:
            parts = [entry] + parts
        return ";".join(parts)

    @classmethod
    def _prepend_path_entries(cls, current_value: str, entries: list[str]) -> str:
        next_value = current_value
        for entry in reversed([item for item in entries if item]):
            next_value = cls._prepend_path_entry(next_value, entry)
        return next_value

    @staticmethod
    def _read_registry_value(registry_key: object, value_name: str) -> str:
        import winreg

        try:
            value, _ = winreg.QueryValueEx(registry_key, value_name)
        except FileNotFoundError:
            return ""
        return str(value or "")

    @staticmethod
    def _broadcast_environment_change() -> None:
        if not sys.platform.startswith("win"):
            return
        hwnd_broadcast = 0xFFFF
        wm_settingchange = 0x001A
        smto_abortifhung = 0x0002
        result = ctypes.c_ulong()
        ctypes.windll.user32.SendMessageTimeoutW(
            hwnd_broadcast,
            wm_settingchange,
            0,
            "Environment",
            smto_abortifhung,
            5000,
            ctypes.byref(result),
        )
