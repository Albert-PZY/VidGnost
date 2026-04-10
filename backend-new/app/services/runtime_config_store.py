from __future__ import annotations

import asyncio
import tomllib
from pathlib import Path
from typing import TypedDict

from app.config import Settings

SUPPORTED_MODEL_SIZES = {"small", "medium"}
SUPPORTED_LOAD_PROFILES = {"balanced", "memory_first"}
SUPPORTED_COMPUTE_TYPES = {"int8", "float32"}


class WhisperRuntimeConfig(TypedDict):
    model_default: str
    language: str
    device: str
    compute_type: str
    model_load_profile: str
    beam_size: int
    vad_filter: bool
    chunk_seconds: int
    target_sample_rate: int
    target_channels: int


DEFAULT_WHISPER_RUNTIME_CONFIG: WhisperRuntimeConfig = {
    "model_default": "small",
    "language": "zh",
    "device": "cpu",
    "compute_type": "int8",
    "model_load_profile": "balanced",
    "beam_size": 5,
    "vad_filter": True,
    "chunk_seconds": 180,
    "target_sample_rate": 16000,
    "target_channels": 1,
}


class RuntimeConfigStore:
    def __init__(self, settings: Settings) -> None:
        self._path = Path(settings.runtime_config_path)
        self._lock = asyncio.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_file()

    async def get_whisper(self, *, mask_secrets: bool = False) -> WhisperRuntimeConfig:  # noqa: ARG002
        async with self._lock:
            return self._read_whisper_sync()

    async def save_whisper(self, payload: WhisperRuntimeConfig) -> WhisperRuntimeConfig:
        async with self._lock:
            current = self._read_whisper_sync()
            merged: WhisperRuntimeConfig = {
                "model_default": _normalize_model_size(payload.get("model_default", current["model_default"])),
                "language": str(payload.get("language", current["language"])).strip() or current["language"],
                "device": _normalize_device(payload.get("device", current["device"])),
                "compute_type": _normalize_compute_type(payload.get("compute_type", current["compute_type"])),
                "model_load_profile": _normalize_load_profile(
                    payload.get("model_load_profile", current["model_load_profile"])
                ),
                "beam_size": _to_int(payload.get("beam_size"), current["beam_size"], minimum=1, maximum=12),
                "vad_filter": bool(payload.get("vad_filter", current["vad_filter"])),
                "chunk_seconds": _to_int(payload.get("chunk_seconds"), current["chunk_seconds"], minimum=30, maximum=1200),
                "target_sample_rate": _to_int(
                    payload.get("target_sample_rate"),
                    current["target_sample_rate"],
                    minimum=8000,
                    maximum=48000,
                ),
                "target_channels": _to_int(
                    payload.get("target_channels"),
                    current["target_channels"],
                    minimum=1,
                    maximum=2,
                ),
            }
            self._path.write_text(_build_toml(merged), encoding="utf-8")
            return merged

    def _ensure_file(self) -> None:
        if self._path.exists():
            return
        self._path.write_text(_build_toml(DEFAULT_WHISPER_RUNTIME_CONFIG), encoding="utf-8")

    def _read_whisper_sync(self) -> WhisperRuntimeConfig:
        if not self._path.exists():
            return DEFAULT_WHISPER_RUNTIME_CONFIG.copy()
        try:
            raw = tomllib.loads(self._path.read_text(encoding="utf-8"))
            whisper = raw.get("whisper", {})
            if not isinstance(whisper, dict):
                whisper = {}
            return {
                "model_default": _normalize_model_size(
                    whisper.get("model_default", DEFAULT_WHISPER_RUNTIME_CONFIG["model_default"])
                ),
                "language": str(whisper.get("language", DEFAULT_WHISPER_RUNTIME_CONFIG["language"])).strip()
                or DEFAULT_WHISPER_RUNTIME_CONFIG["language"],
                "device": _normalize_device(whisper.get("device", DEFAULT_WHISPER_RUNTIME_CONFIG["device"])),
                "compute_type": _normalize_compute_type(
                    whisper.get("compute_type", DEFAULT_WHISPER_RUNTIME_CONFIG["compute_type"])
                ),
                "model_load_profile": _normalize_load_profile(
                    whisper.get("model_load_profile", DEFAULT_WHISPER_RUNTIME_CONFIG["model_load_profile"])
                ),
                "beam_size": _to_int(whisper.get("beam_size"), DEFAULT_WHISPER_RUNTIME_CONFIG["beam_size"], minimum=1, maximum=12),
                "vad_filter": bool(whisper.get("vad_filter", DEFAULT_WHISPER_RUNTIME_CONFIG["vad_filter"])),
                "chunk_seconds": _to_int(
                    whisper.get("chunk_seconds"),
                    DEFAULT_WHISPER_RUNTIME_CONFIG["chunk_seconds"],
                    minimum=30,
                    maximum=1200,
                ),
                "target_sample_rate": _to_int(
                    whisper.get("target_sample_rate"),
                    DEFAULT_WHISPER_RUNTIME_CONFIG["target_sample_rate"],
                    minimum=8000,
                    maximum=48000,
                ),
                "target_channels": _to_int(
                    whisper.get("target_channels"),
                    DEFAULT_WHISPER_RUNTIME_CONFIG["target_channels"],
                    minimum=1,
                    maximum=2,
                ),
            }
        except tomllib.TOMLDecodeError:
            return DEFAULT_WHISPER_RUNTIME_CONFIG.copy()


def _build_toml(config: WhisperRuntimeConfig) -> str:
    return (
        "# VidGnost runtime config\n"
        "# This file is updated by the frontend config panel.\n\n"
        "[whisper]\n"
        f'model_default = "{_toml_escape(config["model_default"])}"\n'
        f'language = "{_toml_escape(config["language"])}"\n'
        f'device = "{_toml_escape(config["device"])}"\n'
        f'compute_type = "{_toml_escape(config["compute_type"])}"\n'
        f'model_load_profile = "{_toml_escape(config["model_load_profile"])}"\n'
        f"beam_size = {config['beam_size']}\n"
        f"vad_filter = {_to_toml_bool(config['vad_filter'])}\n"
        f"chunk_seconds = {config['chunk_seconds']}\n"
        f"target_sample_rate = {config['target_sample_rate']}\n"
        f"target_channels = {config['target_channels']}\n"
    )


def _to_toml_bool(value: bool) -> str:
    return "true" if value else "false"


def _toml_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _normalize_model_size(value: object) -> str:
    candidate = str(value).strip().lower()
    if candidate in SUPPORTED_MODEL_SIZES:
        return candidate
    return DEFAULT_WHISPER_RUNTIME_CONFIG["model_default"]


def _normalize_device(value: object) -> str:
    _ = value
    return "cpu"


def _normalize_compute_type(value: object) -> str:
    candidate = str(value).strip().lower()
    if candidate in SUPPORTED_COMPUTE_TYPES:
        return candidate
    return DEFAULT_WHISPER_RUNTIME_CONFIG["compute_type"]


def _normalize_load_profile(value: object) -> str:
    candidate = str(value).strip().lower()
    if candidate in SUPPORTED_LOAD_PROFILES:
        return candidate
    return DEFAULT_WHISPER_RUNTIME_CONFIG["model_load_profile"]


def _to_int(value: object, fallback: int, minimum: int, maximum: int) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = fallback
    return max(minimum, min(maximum, numeric))
