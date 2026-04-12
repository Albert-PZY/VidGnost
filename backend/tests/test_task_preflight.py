from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.errors import AppError
from app.services.llm_config_store import LLMConfigStore
from app.services.llm_connectivity import OpenAICompatModelValidationResult
from app.services.model_catalog_store import ModelCatalogStore
from app.services.runtime_config_store import RuntimeConfigStore
from app.services.task_preflight import TaskPreflightService
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


def test_task_preflight_rejects_invalid_remote_llm_model(monkeypatch, tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    service = TaskPreflightService(
        settings=settings,
        llm_config_store=LLMConfigStore(settings),
        runtime_config_store=RuntimeConfigStore(settings),
        model_catalog_store=ModelCatalogStore(settings),
        whisper_gpu_runtime_service=WhisperGpuRuntimeService(
            settings=settings,
            runtime_config_store=RuntimeConfigStore(settings),
        ),
    )

    monkeypatch.setattr(
        "app.services.task_preflight.validate_openai_compat_model_config",
        lambda **_: OpenAICompatModelValidationResult(
            ok=False,
            connectivity_ok=True,
            connectivity_reason="HTTP 200",
            model_ok=False,
            model_reason='远端 /models 未返回当前模型 "test-model"',
            model_ids=("qwen-plus", "qwen-turbo"),
        ),
    )

    with pytest.raises(AppError) as exc_info:
        service._assert_llm_connectivity(
            {
                "api_key": "sk-test",
                "base_url": "https://example.com/v1",
                "model": "test-model",
            }
        )

    assert exc_info.value.code == "TASK_PRECHECK_LLM_MODEL_INVALID"
    assert "test-model" in (exc_info.value.hint or "")


@pytest.mark.asyncio
async def test_task_preflight_rejects_missing_gpu_runtime_when_device_is_auto(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    runtime_store = RuntimeConfigStore(settings)
    llm_store = LLMConfigStore(settings)
    await llm_store.save(
        {
            "mode": "api",
            "load_profile": "balanced",
            "local_model_id": "Qwen/Qwen2.5-7B-Instruct",
            "api_key": "sk-test",
            "api_key_configured": True,
            "base_url": "https://example.com/v1",
            "model": "qwen-test",
            "correction_mode": "strict",
            "correction_batch_size": 24,
            "correction_overlap": 3,
        }
    )
    await runtime_store.save_whisper({**await runtime_store.get_whisper(), "device": "auto"})
    service = TaskPreflightService(
        settings=settings,
        llm_config_store=llm_store,
        runtime_config_store=runtime_store,
        model_catalog_store=ModelCatalogStore(settings),
        whisper_gpu_runtime_service=WhisperGpuRuntimeService(
            settings=settings,
            runtime_config_store=runtime_store,
        ),
    )

    with pytest.raises(AppError) as exc_info:
        service.whisper_gpu_runtime_service.assert_runtime_ready_for_device(
            "auto",
            await service.whisper_gpu_runtime_service.get_status(),
        )

    assert exc_info.value.code == "TASK_PRECHECK_WHISPER_GPU_RUNTIME_MISSING"
