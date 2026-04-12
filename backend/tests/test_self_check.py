from __future__ import annotations

import asyncio
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app
from app.services.events import EventBus
from app.services.llm_connectivity import OpenAICompatModelValidationResult
from app.services.model_catalog_store import ModelCatalogStore
from app.services.self_check import (
    SelfCheckService,
    SelfCheckSession,
    _prune_terminal_self_check_sessions,
)


def test_self_check_start_and_report() -> None:
    with TestClient(app) as client:
        start_response = client.post("/api/self-check/start")
        assert start_response.status_code == 200
        payload = start_response.json()
        session_id = payload["session_id"]
        assert payload["status"] == "running"

        report = None
        for _ in range(80):
            response = client.get(f"/api/self-check/{session_id}/report")
            assert response.status_code == 200
            report = response.json()
            if report["status"] in {"completed", "failed"}:
                break
            time.sleep(0.1)

        assert report is not None
        assert report["session_id"] == session_id
        assert isinstance(report["steps"], list)
        assert len(report["steps"]) > 0
        assert "progress" in report


def test_self_check_report_not_found() -> None:
    with TestClient(app) as client:
        response = client.get("/api/self-check/not-exist-session/report")
        assert response.status_code == 404


def test_self_check_prune_keeps_running_and_newest_terminal_sessions() -> None:
    sessions = {
        "completed-oldest": SelfCheckSession(
            id="completed-oldest",
            status="completed",
            updated_at="2026-01-01T00:00:00+00:00",
        ),
        "failed-old": SelfCheckSession(
            id="failed-old",
            status="failed",
            updated_at="2026-01-01T00:01:00+00:00",
        ),
        "running-new": SelfCheckSession(
            id="running-new",
            status="running",
            updated_at="2026-01-01T00:02:00+00:00",
        ),
        "completed-newest": SelfCheckSession(
            id="completed-newest",
            status="completed",
            updated_at="2026-01-01T00:03:00+00:00",
        ),
    }

    _prune_terminal_self_check_sessions(sessions, max_sessions=2)

    assert set(sessions.keys()) == {"running-new", "completed-newest"}


def test_self_check_build_steps_is_api_only() -> None:
    service = SelfCheckService(settings=get_settings(), event_bus=EventBus())
    step_ids = [item.id for item in service._build_steps()]  # type: ignore[attr-defined]
    assert "env" in step_ids
    assert "ffmpeg" in step_ids
    assert "gpu-driver" not in step_ids
    assert "model-cache" in step_ids
    assert "llm-local-config" not in step_ids


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


def _materialize_vlm_cache(model_dir: Path) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    for file_name in ("config.json", "tokenizer.json", "model.safetensors"):
        (model_dir / file_name).write_text("ready", encoding="utf-8")
    (model_dir / ".ready.json").write_text(
        (
            "{\n"
            '  "repo_id": "vikhyatk/moondream2",\n'
            '  "revision": "main",\n'
            '  "files": ["config.json", "tokenizer.json", "model.safetensors"]\n'
            "}\n"
        ),
        encoding="utf-8",
    )


def test_self_check_vlm_reports_ready_when_model_cache_exists(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    default_dir = Path(settings.storage_dir) / "model-hub" / "vikhyatk--moondream2"
    _materialize_vlm_cache(default_dir)

    service = SelfCheckService(settings=settings, event_bus=EventBus())
    outcome = asyncio.run(service._check_vlm())  # type: ignore[attr-defined]

    assert outcome.status == "passed"
    assert outcome.message == "VLM 模型已就绪"
    assert outcome.details["当前路径"] == str(default_dir)
    assert outcome.details["加载策略"] == "常驻内存优先"


def test_self_check_vlm_reports_disabled_when_model_is_turned_off(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    store = ModelCatalogStore(settings)
    asyncio.run(store.update_model("vlm-default", {"enabled": False}))

    service = SelfCheckService(settings=settings, event_bus=EventBus())
    outcome = asyncio.run(service._check_vlm())  # type: ignore[attr-defined]

    assert outcome.status == "warning"
    assert outcome.message == "VLM 模型已停用"


def test_self_check_llm_reports_missing_api_key(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    service = SelfCheckService(settings=settings, event_bus=EventBus())

    outcome = asyncio.run(service._check_llm())  # type: ignore[attr-defined]

    assert outcome.status == "warning"
    assert outcome.message == "LLM API Key 未配置"


def test_self_check_llm_reports_connectivity_failure(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = _build_settings(tmp_path)
    service = SelfCheckService(settings=settings, event_bus=EventBus())
    asyncio.run(
        service._llm_config_store.save(  # type: ignore[attr-defined]
            {
                "mode": "api",
                "load_profile": "balanced",
                "local_model_id": "Qwen/Qwen2.5-7B-Instruct",
                "api_key": "sk-test",
                "api_key_configured": True,
                "base_url": "https://example.invalid/v1",
                "model": "qwen-test",
                "correction_mode": "strict",
                "correction_batch_size": 24,
                "correction_overlap": 3,
            }
        )
    )

    monkeypatch.setattr(
        "app.services.self_check.validate_openai_compat_model_config",
        lambda **_: OpenAICompatModelValidationResult(
            ok=False,
            connectivity_ok=False,
            connectivity_reason="NameResolutionError: host not found",
            model_ok=False,
            model_reason="skipped",
        ),
    )

    outcome = asyncio.run(service._check_llm())  # type: ignore[attr-defined]

    assert outcome.status == "failed"
    assert outcome.message == "LLM 在线 API 连通失败"
    assert outcome.details["连通性"] == "NameResolutionError: host not found"


def test_self_check_llm_reports_invalid_model_name(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = _build_settings(tmp_path)
    service = SelfCheckService(settings=settings, event_bus=EventBus())
    asyncio.run(
        service._llm_config_store.save(  # type: ignore[attr-defined]
            {
                "mode": "api",
                "load_profile": "balanced",
                "local_model_id": "Qwen/Qwen2.5-7B-Instruct",
                "api_key": "sk-test",
                "api_key_configured": True,
                "base_url": "https://example.com/v1",
                "model": "test-model",
                "correction_mode": "strict",
                "correction_batch_size": 24,
                "correction_overlap": 3,
            }
        )
    )

    monkeypatch.setattr(
        "app.services.self_check.validate_openai_compat_model_config",
        lambda **_: OpenAICompatModelValidationResult(
            ok=False,
            connectivity_ok=True,
            connectivity_reason="HTTP 200",
            model_ok=False,
            model_reason='远端 /models 未返回当前模型 "test-model"',
            model_ids=("qwen-plus", "qwen-turbo"),
        ),
    )

    outcome = asyncio.run(service._check_llm())  # type: ignore[attr-defined]

    assert outcome.status == "failed"
    assert outcome.message == "LLM 在线 API 模型配置无效"
    assert outcome.details["连通性"] == "HTTP 200"
    assert outcome.details["模型校验"] == '远端 /models 未返回当前模型 "test-model"'
