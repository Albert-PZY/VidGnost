from __future__ import annotations

import asyncio
from pathlib import Path
from typing import TypedDict

import orjson

from app.config import Settings


class UISettings(TypedDict):
    language: str
    font_size: int
    auto_save: bool
    theme_hue: int


DEFAULT_UI_SETTINGS: UISettings = {
    "language": "zh",
    "font_size": 14,
    "auto_save": True,
    "theme_hue": 220,
}


class UISettingsStore:
    def __init__(self, settings: Settings) -> None:
        self._path = Path(settings.storage_dir) / "config" / "ui_settings.json"
        self._lock = asyncio.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_file()

    async def get(self) -> UISettings:
        async with self._lock:
            return self._read_sync()

    async def update(self, updates: dict[str, object]) -> UISettings:
        async with self._lock:
            current = self._read_sync()
            language = str(updates.get("language", current["language"])).strip().lower()
            if language not in {"zh", "en"}:
                language = current["language"]
            font_size_raw = updates.get("font_size", current["font_size"])
            try:
                font_size = int(font_size_raw)
            except (TypeError, ValueError):
                font_size = current["font_size"]
            font_size = max(12, min(20, font_size))
            auto_save = bool(updates.get("auto_save", current["auto_save"]))
            theme_hue_raw = updates.get("theme_hue", current["theme_hue"])
            try:
                theme_hue = int(theme_hue_raw)
            except (TypeError, ValueError):
                theme_hue = current["theme_hue"]
            theme_hue = max(0, min(360, theme_hue))
            next_value: UISettings = {
                "language": language,
                "font_size": font_size,
                "auto_save": auto_save,
                "theme_hue": theme_hue,
            }
            self._write_sync(next_value)
            return next_value

    def _ensure_file(self) -> None:
        if self._path.exists():
            return
        self._write_sync(dict(DEFAULT_UI_SETTINGS))

    def _read_sync(self) -> UISettings:
        if not self._path.exists():
            return dict(DEFAULT_UI_SETTINGS)
        try:
            payload = orjson.loads(self._path.read_bytes())
        except orjson.JSONDecodeError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        language = str(payload.get("language", DEFAULT_UI_SETTINGS["language"])).strip().lower()
        if language not in {"zh", "en"}:
            language = DEFAULT_UI_SETTINGS["language"]
        try:
            font_size = int(payload.get("font_size", DEFAULT_UI_SETTINGS["font_size"]))
        except (TypeError, ValueError):
            font_size = DEFAULT_UI_SETTINGS["font_size"]
        font_size = max(12, min(20, font_size))
        auto_save = bool(payload.get("auto_save", DEFAULT_UI_SETTINGS["auto_save"]))
        try:
            theme_hue = int(payload.get("theme_hue", DEFAULT_UI_SETTINGS["theme_hue"]))
        except (TypeError, ValueError):
            theme_hue = DEFAULT_UI_SETTINGS["theme_hue"]
        theme_hue = max(0, min(360, theme_hue))
        return {
            "language": language,
            "font_size": font_size,
            "auto_save": auto_save,
            "theme_hue": theme_hue,
        }

    def _write_sync(self, value: UISettings) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self._path.with_suffix(".json.tmp")
        tmp_path.write_bytes(orjson.dumps(value, option=orjson.OPT_INDENT_2))
        tmp_path.replace(self._path)
