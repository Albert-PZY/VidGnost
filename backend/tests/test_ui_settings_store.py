from __future__ import annotations

import asyncio
from pathlib import Path

from app.config import Settings
from app.services.ui_settings_store import DEFAULT_UI_SETTINGS, UISettingsStore


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


def test_ui_settings_store_persists_theme_hue(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    store = UISettingsStore(settings)

    payload = dict(DEFAULT_UI_SETTINGS)
    payload["theme_hue"] = 170

    saved = asyncio.run(store.update(payload))
    current = asyncio.run(store.get())

    assert saved["theme_hue"] == 170
    assert current["theme_hue"] == 170


def test_ui_settings_store_normalizes_invalid_theme_hue(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    store = UISettingsStore(settings)

    saved = asyncio.run(store.update({"theme_hue": 999}))

    assert saved["theme_hue"] == 360


def test_ui_settings_store_persists_background_image_and_opacity(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    store = UISettingsStore(settings)

    saved = asyncio.run(
        store.update(
            {
                "background_image": "data:image/png;base64,ZmFrZQ==",
                "background_image_opacity": 64,
            }
        )
    )

    current = asyncio.run(store.get())

    assert saved["background_image"] == "data:image/png;base64,ZmFrZQ=="
    assert saved["background_image_opacity"] == 64
    assert current["background_image"] == "data:image/png;base64,ZmFrZQ=="
    assert current["background_image_opacity"] == 64
