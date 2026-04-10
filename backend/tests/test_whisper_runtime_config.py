from __future__ import annotations

import asyncio
from pathlib import Path

from app.config import Settings
from app.services.runtime_config_store import DEFAULT_WHISPER_RUNTIME_CONFIG, RuntimeConfigStore, _normalize_device
from app.services.transcription import WhisperService


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


def test_runtime_config_store_persists_auto_device(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    store = RuntimeConfigStore(settings)

    payload = dict(DEFAULT_WHISPER_RUNTIME_CONFIG)
    payload["device"] = "auto"
    saved = asyncio.run(store.save_whisper(payload))
    current = asyncio.run(store.get_whisper(mask_secrets=False))

    assert saved["device"] == "auto"
    assert current["device"] == "auto"
    assert 'device = "auto"' in Path(settings.runtime_config_path).read_text(encoding="utf-8")


def test_device_normalizers_accept_supported_values() -> None:
    assert _normalize_device("auto") == "auto"
    assert _normalize_device("cuda") == "cuda"
    assert _normalize_device("cpu") == "cpu"

    assert WhisperService._normalize_device("auto") == "auto"
    assert WhisperService._normalize_device("cuda") == "cuda"
    assert WhisperService._normalize_device("cpu") == "cpu"
