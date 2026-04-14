from __future__ import annotations

from pathlib import Path

from app.config import Settings
from app.services.resource_guard import ResourceGuard


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


def test_guard_whisper_config_reduces_memory_pressure(tmp_path: Path, monkeypatch) -> None:
    guard = ResourceGuard(settings=_build_settings(tmp_path))
    monkeypatch.setattr(
        ResourceGuard,
        "_available_system_memory_bytes",
        staticmethod(lambda: 2_500_000_000),
    )

    result = guard.guard_whisper_config(
        {
            "model_default": "small",
            "language": "zh",
            "device": "auto",
            "compute_type": "float32",
            "model_load_profile": "balanced",
            "beam_size": 4,
            "vad_filter": True,
            "chunk_seconds": 300,
            "target_sample_rate": 16000,
            "target_channels": 1,
        }
    )

    assert result["rollback_applied"] is True
    assert result["config"]["model_load_profile"] == "memory_first"
    assert result["config"]["beam_size"] == 1
    assert result["config"]["chunk_seconds"] == 120
    assert len(result["warnings"]) >= 3


def test_guard_whisper_config_keeps_balanced_profile_when_memory_is_sufficient(
    tmp_path: Path,
    monkeypatch,
) -> None:
    guard = ResourceGuard(settings=_build_settings(tmp_path))
    monkeypatch.setattr(
        ResourceGuard,
        "_available_system_memory_bytes",
        staticmethod(lambda: 8_000_000_000),
    )

    original = {
        "model_default": "small",
        "language": "zh",
        "device": "auto",
        "compute_type": "int8",
        "model_load_profile": "balanced",
        "beam_size": 4,
        "vad_filter": True,
        "chunk_seconds": 180,
        "target_sample_rate": 16000,
        "target_channels": 1,
    }
    result = guard.guard_whisper_config(original)

    assert result["rollback_applied"] is False
    assert result["config"] == original
    assert result["warnings"] == []
