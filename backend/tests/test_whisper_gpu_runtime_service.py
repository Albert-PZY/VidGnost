from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest

from app.config import Settings
from app.errors import AppError
from app.services.ollama_runtime_config_store import OllamaRuntimeConfigStore
from app.services.whisper_gpu_runtime_service import WhisperGpuRuntimeService


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


def _materialize_ollama_cuda_runtime(install_dir: Path) -> None:
    cuda_dir = install_dir / "lib" / "ollama" / "cuda_v12"
    mlx_dir = install_dir / "lib" / "ollama" / "mlx_cuda_v13"
    cuda_dir.mkdir(parents=True, exist_ok=True)
    mlx_dir.mkdir(parents=True, exist_ok=True)
    for file_name in ("cublas64_12.dll", "cudart64_12.dll"):
        (cuda_dir / file_name).write_text("dll", encoding="utf-8")
    (mlx_dir / "cudnn64_9.dll").write_text("dll", encoding="utf-8")


def test_whisper_gpu_runtime_service_detects_ollama_runtime(monkeypatch, tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    runtime_store = OllamaRuntimeConfigStore(settings)
    install_dir = tmp_path / "Ollama"
    _materialize_ollama_cuda_runtime(install_dir)
    asyncio.run(runtime_store.save({"install_dir": str(install_dir)}))

    monkeypatch.setattr(WhisperGpuRuntimeService, "_is_windows", staticmethod(lambda: True))
    monkeypatch.setattr(WhisperGpuRuntimeService, "_validate_loadability", staticmethod(lambda _: ""))
    monkeypatch.setenv("PATH", "")
    os.environ.pop("CUDA_PATH", None)

    service = WhisperGpuRuntimeService(
        settings=settings,
        ollama_runtime_config_store=runtime_store,
    )

    status = asyncio.run(service.get_status())

    assert status["ready"] is True
    assert status["status"] == "ready"
    assert status["bin_dir"]
    assert status["path_configured"] is True
    assert status["discovered_files"]["cublas64_12.dll"].endswith("cublas64_12.dll")
    assert status["discovered_files"]["cudart64_12.dll"].endswith("cudart64_12.dll")
    assert status["discovered_files"]["cudnn64*.dll"].endswith("cudnn64_9.dll")


def test_whisper_gpu_runtime_service_reports_missing_runtime(monkeypatch, tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    runtime_store = OllamaRuntimeConfigStore(settings)
    install_dir = tmp_path / "Ollama"
    install_dir.mkdir(parents=True, exist_ok=True)
    asyncio.run(runtime_store.save({"install_dir": str(install_dir)}))

    monkeypatch.setattr(WhisperGpuRuntimeService, "_is_windows", staticmethod(lambda: True))
    monkeypatch.setenv("PATH", "")

    service = WhisperGpuRuntimeService(
        settings=settings,
        ollama_runtime_config_store=runtime_store,
    )

    status = asyncio.run(service.get_status())

    assert status["ready"] is False
    assert status["status"] == "not_ready"
    assert "cublas64_12.dll" in status["missing_files"]
    assert "cudart64_12.dll" in status["missing_files"]


def test_whisper_gpu_runtime_service_rejects_gpu_device_when_runtime_missing(
    monkeypatch,
    tmp_path: Path,
) -> None:
    settings = _build_settings(tmp_path)
    runtime_store = OllamaRuntimeConfigStore(settings)
    asyncio.run(runtime_store.save({"install_dir": str(tmp_path / "Ollama")}))

    monkeypatch.setattr(WhisperGpuRuntimeService, "_is_windows", staticmethod(lambda: True))
    monkeypatch.setenv("PATH", "")

    service = WhisperGpuRuntimeService(
        settings=settings,
        ollama_runtime_config_store=runtime_store,
    )
    status = asyncio.run(service.get_status())

    with pytest.raises(AppError) as exc_info:
        service.assert_runtime_ready_for_device("auto", status)

    assert exc_info.value.code == "TASK_PRECHECK_WHISPER_GPU_RUNTIME_MISSING"
