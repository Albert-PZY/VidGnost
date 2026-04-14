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
    background_image: str | None
    background_image_opacity: int
    background_image_blur: int
    background_image_scale: float
    background_image_focus_x: float
    background_image_focus_y: float
    background_image_fill_mode: str


DEFAULT_UI_SETTINGS: UISettings = {
    "language": "zh",
    "font_size": 14,
    "auto_save": True,
    "theme_hue": 220,
    "background_image": None,
    "background_image_opacity": 28,
    "background_image_blur": 0,
    "background_image_scale": 1.0,
    "background_image_focus_x": 0.5,
    "background_image_focus_y": 0.5,
    "background_image_fill_mode": "cover",
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
            background_image_raw = updates.get("background_image", current["background_image"])
            background_image = None
            if isinstance(background_image_raw, str):
                normalized_background = background_image_raw.strip()
                background_image = normalized_background or None
            elif background_image_raw is None:
                background_image = None
            else:
                background_image = current["background_image"]
            background_image_opacity_raw = updates.get(
                "background_image_opacity",
                current["background_image_opacity"],
            )
            try:
                background_image_opacity = int(background_image_opacity_raw)
            except (TypeError, ValueError):
                background_image_opacity = current["background_image_opacity"]
            background_image_opacity = max(0, min(100, background_image_opacity))
            background_image_blur_raw = updates.get(
                "background_image_blur",
                current["background_image_blur"],
            )
            try:
                background_image_blur = int(background_image_blur_raw)
            except (TypeError, ValueError):
                background_image_blur = current["background_image_blur"]
            background_image_blur = max(0, min(40, background_image_blur))
            background_image_scale_raw = updates.get(
                "background_image_scale",
                current["background_image_scale"],
            )
            try:
                background_image_scale = float(background_image_scale_raw)
            except (TypeError, ValueError):
                background_image_scale = current["background_image_scale"]
            background_image_scale = max(1.0, min(4.0, background_image_scale))
            background_image_focus_x_raw = updates.get(
                "background_image_focus_x",
                current["background_image_focus_x"],
            )
            try:
                background_image_focus_x = float(background_image_focus_x_raw)
            except (TypeError, ValueError):
                background_image_focus_x = current["background_image_focus_x"]
            background_image_focus_x = max(0.0, min(1.0, background_image_focus_x))
            background_image_focus_y_raw = updates.get(
                "background_image_focus_y",
                current["background_image_focus_y"],
            )
            try:
                background_image_focus_y = float(background_image_focus_y_raw)
            except (TypeError, ValueError):
                background_image_focus_y = current["background_image_focus_y"]
            background_image_focus_y = max(0.0, min(1.0, background_image_focus_y))
            background_image_fill_mode_raw = updates.get(
                "background_image_fill_mode",
                current["background_image_fill_mode"],
            )
            background_image_fill_mode = str(background_image_fill_mode_raw or "").strip().lower()
            if background_image_fill_mode not in {"cover", "contain", "repeat", "center"}:
                background_image_fill_mode = current["background_image_fill_mode"]
            next_value: UISettings = {
                "language": language,
                "font_size": font_size,
                "auto_save": auto_save,
                "theme_hue": theme_hue,
                "background_image": background_image,
                "background_image_opacity": background_image_opacity,
                "background_image_blur": background_image_blur,
                "background_image_scale": background_image_scale,
                "background_image_focus_x": background_image_focus_x,
                "background_image_focus_y": background_image_focus_y,
                "background_image_fill_mode": background_image_fill_mode,
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
        background_image_raw = payload.get("background_image", DEFAULT_UI_SETTINGS["background_image"])
        background_image = None
        if isinstance(background_image_raw, str):
            normalized_background = background_image_raw.strip()
            background_image = normalized_background or None
        elif background_image_raw is None:
            background_image = None
        try:
            background_image_opacity = int(
                payload.get(
                    "background_image_opacity",
                    DEFAULT_UI_SETTINGS["background_image_opacity"],
                )
            )
        except (TypeError, ValueError):
            background_image_opacity = DEFAULT_UI_SETTINGS["background_image_opacity"]
        background_image_opacity = max(0, min(100, background_image_opacity))
        try:
            background_image_blur = int(
                payload.get(
                    "background_image_blur",
                    DEFAULT_UI_SETTINGS["background_image_blur"],
                )
            )
        except (TypeError, ValueError):
            background_image_blur = DEFAULT_UI_SETTINGS["background_image_blur"]
        background_image_blur = max(0, min(40, background_image_blur))
        try:
            background_image_scale = float(
                payload.get(
                    "background_image_scale",
                    DEFAULT_UI_SETTINGS["background_image_scale"],
                )
            )
        except (TypeError, ValueError):
            background_image_scale = DEFAULT_UI_SETTINGS["background_image_scale"]
        background_image_scale = max(1.0, min(4.0, background_image_scale))
        try:
            background_image_focus_x = float(
                payload.get(
                    "background_image_focus_x",
                    DEFAULT_UI_SETTINGS["background_image_focus_x"],
                )
            )
        except (TypeError, ValueError):
            background_image_focus_x = DEFAULT_UI_SETTINGS["background_image_focus_x"]
        background_image_focus_x = max(0.0, min(1.0, background_image_focus_x))
        try:
            background_image_focus_y = float(
                payload.get(
                    "background_image_focus_y",
                    DEFAULT_UI_SETTINGS["background_image_focus_y"],
                )
            )
        except (TypeError, ValueError):
            background_image_focus_y = DEFAULT_UI_SETTINGS["background_image_focus_y"]
        background_image_focus_y = max(0.0, min(1.0, background_image_focus_y))
        background_image_fill_mode = str(
            payload.get(
                "background_image_fill_mode",
                DEFAULT_UI_SETTINGS["background_image_fill_mode"],
            )
        ).strip().lower()
        if background_image_fill_mode not in {"cover", "contain", "repeat", "center"}:
            background_image_fill_mode = DEFAULT_UI_SETTINGS["background_image_fill_mode"]
        return {
            "language": language,
            "font_size": font_size,
            "auto_save": auto_save,
            "theme_hue": theme_hue,
            "background_image": background_image,
            "background_image_opacity": background_image_opacity,
            "background_image_blur": background_image_blur,
            "background_image_scale": background_image_scale,
            "background_image_focus_x": background_image_focus_x,
            "background_image_focus_y": background_image_focus_y,
            "background_image_fill_mode": background_image_fill_mode,
        }

    def _write_sync(self, value: UISettings) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self._path.with_suffix(".json.tmp")
        tmp_path.write_bytes(orjson.dumps(value, option=orjson.OPT_INDENT_2))
        tmp_path.replace(self._path)
