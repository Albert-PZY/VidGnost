from __future__ import annotations

import asyncio
import os
import subprocess
import time
from pathlib import Path
from typing import Literal, TypedDict
from urllib.parse import urlparse

import httpx
import psutil

from app.config import Settings
from app.services.ollama_client import OllamaClient
from app.services.ollama_runtime_config_store import OllamaRuntimeConfigStore
from app.services.windows_env_manager import WindowsEnvManager

_LOCAL_OLLAMA_HOSTS = {"127.0.0.1", "localhost", "0.0.0.0", "::1"}


class OllamaServiceStatus(TypedDict):
    reachable: bool
    process_detected: bool
    process_id: int | None
    executable_path: str
    configured_models_dir: str
    effective_models_dir: str
    models_dir_source: Literal["env", "default", "unknown"]
    using_configured_models_dir: bool
    restart_required: bool
    can_self_restart: bool
    message: str


class OllamaModelInspection(TypedDict):
    recognized_by_service: bool
    files_present_in_configured_dir: bool
    configured_storage_path: str
    message: str
    service: OllamaServiceStatus


class OllamaServiceManager:
    def __init__(
        self,
        settings: Settings,
        *,
        runtime_config_store: OllamaRuntimeConfigStore | None = None,
        ollama_client: OllamaClient | None = None,
    ) -> None:
        self._settings = settings
        self._runtime_config_store = runtime_config_store or OllamaRuntimeConfigStore(settings)
        self._ollama_client = ollama_client or OllamaClient(settings, runtime_config_store=self._runtime_config_store)
        self._tags_timeout = httpx.Timeout(connect=0.5, read=2.0, write=2.0, pool=2.0)
        self._windows_env_manager = WindowsEnvManager()

    async def get_status(self) -> OllamaServiceStatus:
        config = self._runtime_config_store.get_sync()
        configured_models_dir = _resolve_path(config["models_dir"])
        configured_executable = _resolve_path(config["executable_path"])
        parsed_base_url = _parse_base_url(config["base_url"])
        is_local_service = parsed_base_url.hostname in _LOCAL_OLLAMA_HOSTS
        reachable = await self._is_reachable(config["base_url"])

        process: psutil.Process | None = None
        effective_models_dir = ""
        models_dir_source: Literal["env", "default", "unknown"] = "unknown"
        if is_local_service:
            process = self._find_local_process(
                configured_executable,
                port=parsed_base_url.port or 11434,
            )
            if process is not None:
                effective_models_dir, models_dir_source = self._resolve_effective_models_dir(process)

        detected_executable = self._resolve_process_executable(process) or configured_executable
        process_detected = process is not None
        using_configured_models_dir = bool(
            effective_models_dir and _same_path(effective_models_dir, configured_models_dir)
        )
        can_self_restart = is_local_service and Path(configured_executable).is_file()

        restart_required = False
        if is_local_service:
            if process_detected and effective_models_dir:
                restart_required = not using_configured_models_dir
            elif process_detected and not reachable:
                restart_required = True
            elif not reachable and can_self_restart:
                restart_required = True

        return {
            "reachable": reachable,
            "process_detected": process_detected,
            "process_id": process.pid if process is not None else None,
            "executable_path": detected_executable,
            "configured_models_dir": configured_models_dir,
            "effective_models_dir": effective_models_dir,
            "models_dir_source": models_dir_source,
            "using_configured_models_dir": using_configured_models_dir,
            "restart_required": restart_required,
            "can_self_restart": can_self_restart,
            "message": self._build_status_message(
                is_local_service=is_local_service,
                reachable=reachable,
                process_detected=process_detected,
                using_configured_models_dir=using_configured_models_dir,
                effective_models_dir=effective_models_dir,
                configured_models_dir=configured_models_dir,
                can_self_restart=can_self_restart,
            ),
        }

    async def inspect_model(self, model_name: str) -> OllamaModelInspection:
        status = await self.get_status()
        configured_storage_path = str(
            OllamaClient.resolve_model_storage_path(
                model_name,
                models_dir=status["configured_models_dir"],
            )
        )
        files_present_in_configured_dir = Path(configured_storage_path).exists()
        recognized_by_service = False
        if status["reachable"]:
            recognized_by_service = model_name in await self._ollama_client.list_local_models()

        if recognized_by_service:
            message = "当前 Ollama 已识别该模型，无需重新安装。"
        elif files_present_in_configured_dir:
            message = (
                "模型文件已存在于配置目录，但当前 Ollama 服务尚未从该目录加载模型，"
                "请先启动或重启 Ollama 服务后刷新检测。"
            )
        else:
            message = "当前尚未在 Ollama 服务中识别到该模型，可以继续安装。"

        return {
            "recognized_by_service": recognized_by_service,
            "files_present_in_configured_dir": files_present_in_configured_dir,
            "configured_storage_path": configured_storage_path,
            "message": message,
            "service": status,
        }

    async def synchronize_runtime_environment(self) -> list[str]:
        config = self._runtime_config_store.get_sync()
        messages: list[str] = []

        install_dir = _resolve_path(config["install_dir"])
        if install_dir:
            path_result = await asyncio.to_thread(
                self._windows_env_manager.prepend_path_entry,
                install_dir,
            )
            messages.append(path_result.message)

        models_dir = _resolve_path(config["models_dir"])
        if models_dir:
            Path(models_dir).mkdir(parents=True, exist_ok=True)
            models_result = await asyncio.to_thread(
                self._windows_env_manager.set_env_var,
                "OLLAMA_MODELS",
                models_dir,
            )
            messages.append(models_result.message)

        return messages

    async def restart_service(self) -> OllamaServiceStatus:
        config = self._runtime_config_store.get_sync()
        parsed = _parse_base_url(config["base_url"])
        if parsed.hostname not in _LOCAL_OLLAMA_HOSTS:
            raise ValueError("当前 Ollama 服务地址不是本机地址，无法自动重启远程服务。")

        executable_path = Path(config["executable_path"]).expanduser().resolve()
        if not executable_path.is_file():
            raise ValueError(f"未找到 Ollama 可执行文件：{executable_path}")

        await self.synchronize_runtime_environment()
        await asyncio.to_thread(self._restart_process_sync, executable_path, config["models_dir"], config["base_url"])

        for _ in range(30):
            status = await self.get_status()
            if status["reachable"]:
                return status
            await asyncio.sleep(0.5)
        raise RuntimeError("Ollama 服务已启动，但在等待接口就绪时超时。")

    def _restart_process_sync(self, executable_path: Path, models_dir: str, base_url: str) -> None:
        port = _parse_base_url(base_url).port or 11434
        self._stop_existing_processes(executable_path, port=port)
        env = os.environ.copy()
        env["OLLAMA_MODELS"] = _resolve_path(models_dir)
        env["OLLAMA_HOST"] = _format_ollama_host(base_url)

        creationflags = 0
        if os.name == "nt":
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

        subprocess.Popen(  # noqa: S603
            [str(executable_path), "serve"],
            cwd=str(executable_path.parent),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )

    def _stop_existing_processes(self, configured_executable: Path, *, port: int) -> None:
        processes_by_pid: dict[int, psutil.Process] = {}
        for process in self._collect_local_processes(str(configured_executable)):
            processes_by_pid[process.pid] = process
        for process in self._collect_processes_using_port(port):
            processes_by_pid[process.pid] = process

        processes = list(processes_by_pid.values())
        for process in processes:
            try:
                process.terminate()
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                continue

        gone, alive = psutil.wait_procs(processes, timeout=5)
        _ = gone
        for process in alive:
            try:
                process.kill()
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                continue
        if alive:
            psutil.wait_procs(alive, timeout=3)
        self._wait_for_port_release(port)

    async def _is_reachable(self, base_url: str) -> bool:
        normalized = str(base_url or "").strip().rstrip("/")
        if not normalized:
            return False
        try:
            async with httpx.AsyncClient(timeout=self._tags_timeout) as client:
                response = await client.get(f"{normalized}/api/tags")
                response.raise_for_status()
        except Exception:  # noqa: BLE001
            return False
        return True

    def _find_local_process(self, configured_executable: str, *, port: int) -> psutil.Process | None:
        processes = self._collect_processes_using_port(port)
        if not processes:
            processes = self._collect_local_processes(configured_executable, include_app=False)
        if not processes:
            return None
        processes.sort(
            key=lambda process: (
                0 if _same_path(self._resolve_process_executable(process), configured_executable) else 1,
                0 if self._has_serve_cmdline(process) else 1,
                process.pid,
            )
        )
        return processes[0]

    def _collect_local_processes(self, configured_executable: str, *, include_app: bool = True) -> list[psutil.Process]:
        matches: list[psutil.Process] = []
        for process in psutil.process_iter(["pid", "name", "exe", "cmdline"]):
            try:
                name = str(process.info.get("name") or "").strip().lower()
                executable = str(process.info.get("exe") or "").strip()
                cmdline = [str(part).strip().lower() for part in process.info.get("cmdline") or []]
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                continue

            is_ollama_name = name in {"ollama", "ollama.exe"}
            is_ollama_app_name = include_app and name in {"ollama app", "ollama app.exe"}
            is_ollama_executable = Path(executable).name.lower() in {"ollama", "ollama.exe"}
            explicitly_configured = bool(executable and _same_path(executable, configured_executable))
            has_serve_cmdline = any(part == "serve" for part in cmdline)
            if explicitly_configured or is_ollama_name or is_ollama_app_name or is_ollama_executable or has_serve_cmdline:
                matches.append(process)
        return matches

    def _collect_processes_using_port(self, port: int) -> list[psutil.Process]:
        matches: dict[int, psutil.Process] = {}
        try:
            connections = psutil.net_connections(kind="inet")
        except psutil.AccessDenied:
            return []

        for connection in connections:
            local_address = getattr(connection, "laddr", None)
            if not local_address or getattr(local_address, "port", None) != port:
                continue
            pid = connection.pid
            if pid is None or pid <= 0:
                continue
            try:
                matches[pid] = psutil.Process(pid)
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                continue
        return list(matches.values())

    def _wait_for_port_release(self, port: int) -> None:
        for _ in range(40):
            if not self._collect_processes_using_port(port):
                return
            time.sleep(0.25)
        lingering = self._collect_processes_using_port(port)
        for process in lingering:
            try:
                process.kill()
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                continue
        if lingering:
            psutil.wait_procs(lingering, timeout=3)
        if not self._collect_processes_using_port(port):
            return
        if lingering:
            pids = ", ".join(str(process.pid) for process in lingering)
            raise RuntimeError(f"{port} 端口仍被占用，未能完成 Ollama 服务重启前清理。占用 PID: {pids}")

    def _resolve_effective_models_dir(
        self,
        process: psutil.Process,
    ) -> tuple[str, Literal["env", "default", "unknown"]]:
        try:
            env = process.environ()
        except (psutil.AccessDenied, psutil.NoSuchProcess, OSError):
            return ("", "unknown")

        configured = str(env.get("OLLAMA_MODELS", "")).strip()
        if configured:
            return (_resolve_path(configured), "env")
        return (_resolve_path(Path.home() / ".ollama" / "models"), "default")

    def _resolve_process_executable(self, process: psutil.Process | None) -> str:
        if process is None:
            return ""
        try:
            executable = process.exe()
        except (psutil.AccessDenied, psutil.NoSuchProcess, OSError):
            executable = ""
        return _resolve_path(executable) if executable else ""

    @staticmethod
    def _has_serve_cmdline(process: psutil.Process) -> bool:
        try:
            cmdline = [str(part).strip().lower() for part in process.cmdline()]
        except (psutil.AccessDenied, psutil.NoSuchProcess, OSError):
            return False
        return any(part == "serve" for part in cmdline)

    def _build_status_message(
        self,
        *,
        is_local_service: bool,
        reachable: bool,
        process_detected: bool,
        using_configured_models_dir: bool,
        effective_models_dir: str,
        configured_models_dir: str,
        can_self_restart: bool,
    ) -> str:
        if not is_local_service:
            return "当前 Ollama 服务地址不是本机地址，无法自动检测或重启远程进程。"
        if reachable and process_detected and using_configured_models_dir:
            return "当前 Ollama 服务正在使用已配置的模型目录。"
        if process_detected and effective_models_dir and not using_configured_models_dir:
            return (
                f"当前 Ollama 进程仍在使用 {effective_models_dir}，尚未切换到配置目录 {configured_models_dir}。"
            )
        if process_detected and not reachable:
            return "检测到本地 Ollama 进程，但接口暂不可达。建议先重启服务。"
        if not process_detected and reachable:
            return "Ollama 接口可达，但未检测到本地进程信息，可能由外部方式托管。"
        if not reachable and can_self_restart:
            return "当前未连接到 Ollama 服务，可通过下方按钮启动或重启本地服务。"
        if not reachable:
            return "当前未连接到 Ollama 服务，请检查服务地址与可执行文件路径。"
        return "当前 Ollama 服务状态已刷新。"


def _parse_base_url(base_url: str):
    normalized = str(base_url or "").strip()
    if not normalized:
        return urlparse("http://127.0.0.1:11434")
    return urlparse(normalized if "://" in normalized else f"http://{normalized}")


def _format_ollama_host(base_url: str) -> str:
    parsed = _parse_base_url(base_url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 11434
    return f"{host}:{port}"


def _resolve_path(value: str | Path) -> str:
    return str(Path(value).expanduser().resolve())


def _same_path(left: str | Path, right: str | Path) -> bool:
    if not left or not right:
        return False
    try:
        return Path(left).expanduser().resolve() == Path(right).expanduser().resolve()
    except OSError:
        return str(left).strip() == str(right).strip()
