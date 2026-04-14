from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

from app.config import Settings
from app.services.ollama_runtime_config_store import OllamaRuntimeConfigStore
from app.services.ollama_service_manager import OllamaServiceManager


def _build_settings(tmp_path: Path) -> Settings:
    storage_dir = tmp_path / "storage"
    return Settings(
        storage_dir=str(storage_dir),
        temp_dir=str(storage_dir / "tmp"),
        upload_dir=str(storage_dir / "uploads"),
        output_dir=str(storage_dir / "outputs"),
        runtime_config_path=str(storage_dir / "config.toml"),
        llm_config_path=str(storage_dir / "model_config.json"),
    )


def test_collect_processes_using_port_ignores_pid_zero(monkeypatch, tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    manager = OllamaServiceManager(settings)

    monkeypatch.setattr(
        "app.services.ollama_service_manager.psutil.net_connections",
        lambda kind="inet": [
            SimpleNamespace(laddr=SimpleNamespace(port=11434), pid=0),
            SimpleNamespace(laddr=SimpleNamespace(port=11434), pid=1234),
        ],
    )
    monkeypatch.setattr(
        "app.services.ollama_service_manager.psutil.Process",
        lambda pid: SimpleNamespace(pid=pid),
    )

    processes = manager._collect_processes_using_port(11434)

    assert [process.pid for process in processes] == [1234]


def test_synchronize_runtime_environment_updates_path_and_models_dir(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    runtime_store = OllamaRuntimeConfigStore(settings)
    install_dir = tmp_path / "Ollama"
    models_dir = tmp_path / "OllamaModels"
    asyncio.run(
        runtime_store.save(
            {
                "install_dir": str(install_dir),
                "models_dir": str(models_dir),
            }
        )
    )

    class DummyEnvManager:
        def __init__(self) -> None:
            self.calls: list[tuple[str, str]] = []

        def prepend_path_entry(self, entry: str, *, prefer_machine: bool = True):
            self.calls.append(("path", entry))
            return SimpleNamespace(message=f"path:{entry}")

        def set_env_var(self, name: str, value: str, *, prefer_machine: bool = True):
            self.calls.append((name, value))
            return SimpleNamespace(message=f"{name}:{value}")

    env_manager = DummyEnvManager()
    manager = OllamaServiceManager(settings, runtime_config_store=runtime_store)
    manager._windows_env_manager = env_manager  # type: ignore[assignment]

    messages = asyncio.run(manager.synchronize_runtime_environment())

    assert models_dir.exists()
    assert ("path", str(install_dir.resolve())) in env_manager.calls
    assert ("OLLAMA_MODELS", str(models_dir.resolve())) in env_manager.calls
    assert any(message.startswith("path:") for message in messages)
    assert any(message.startswith("OLLAMA_MODELS:") for message in messages)


def test_find_local_process_prefers_port_owner(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    runtime_store = OllamaRuntimeConfigStore(settings)
    manager = OllamaServiceManager(settings, runtime_config_store=runtime_store)
    configured_executable = str((tmp_path / "Ollama" / "ollama.exe").resolve())

    class FakeProcess:
        def __init__(self, pid: int, *, executable: str, cmdline: list[str]) -> None:
            self.pid = pid
            self._executable = executable
            self._cmdline = cmdline

        def exe(self) -> str:
            return self._executable

        def cmdline(self) -> list[str]:
            return list(self._cmdline)

    serve_process = FakeProcess(11434, executable=configured_executable, cmdline=[configured_executable, "serve"])
    runner_process = FakeProcess(2765, executable=configured_executable, cmdline=[configured_executable, "runner"])

    manager._collect_processes_using_port = lambda port: [serve_process]  # type: ignore[method-assign]
    manager._collect_local_processes = lambda executable, include_app=False: [runner_process, serve_process]  # type: ignore[method-assign]

    process = manager._find_local_process(configured_executable, port=11434)

    assert process is serve_process
