from __future__ import annotations

import asyncio
from pathlib import Path
from typing import TypedDict

import orjson

from app.config import Settings

SUPPORTED_LLM_MODES = {"api"}
SUPPORTED_LOAD_PROFILES = {"balanced", "memory_first"}
DEFAULT_LOCAL_LLM_MODEL_ID = "qwen2.5:3b"
_LEGACY_MASK_PLACEHOLDERS = {"__SECRET_MASKED__", "********"}


class LLMConfig(TypedDict):
    mode: str
    load_profile: str
    local_model_id: str
    api_key: str
    api_key_configured: bool
    base_url: str
    model: str
    correction_mode: str
    correction_batch_size: int
    correction_overlap: int


class LLMConfigStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._path = Path(settings.llm_config_path)
        self._legacy_path = self._path.with_name("llm_model.json")
        self._lock = asyncio.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate_legacy_config_if_needed()

    async def get(self, *, mask_secrets: bool = False) -> LLMConfig:  # noqa: ARG002
        async with self._lock:
            return self._read_sync()

    async def save(self, payload: LLMConfig) -> LLMConfig:
        async with self._lock:
            current = self._read_sync()
            resolved_api_key = _resolve_secret_update(payload.get("api_key"), current["api_key"])
            resolved_base_url = str(payload.get("base_url", "")).strip() or self._settings.llm_base_url
            sanitized_file_payload: dict[str, object] = {
                "mode": _normalize_llm_mode(payload.get("mode")),
                "load_profile": _normalize_load_profile(payload.get("load_profile")),
                "local_model_id": _normalize_local_model_id(payload.get("local_model_id")),
                "api_key": _normalize_api_key(resolved_api_key, resolved_base_url, self._settings.llm_api_key),
                "base_url": resolved_base_url,
                "model": str(payload.get("model", "")).strip() or self._settings.llm_model,
                "correction_mode": _normalize_correction_mode(payload.get("correction_mode")),
                "correction_batch_size": _normalize_correction_batch_size(payload.get("correction_batch_size")),
                "correction_overlap": _normalize_correction_overlap(payload.get("correction_overlap")),
            }
            self._path.write_bytes(orjson.dumps(sanitized_file_payload, option=orjson.OPT_INDENT_2))
            return self._build_config(data=sanitized_file_payload)

    def _read_sync(self) -> LLMConfig:
        file_payload: dict[str, object]
        if self._path.exists():
            try:
                loaded = orjson.loads(self._path.read_bytes())
            except orjson.JSONDecodeError:
                loaded = {}
            file_payload = loaded if isinstance(loaded, dict) else {}
        else:
            file_payload = {}

        api_key = str(file_payload.get("api_key", "")).strip()
        legacy_api_key = self._read_legacy_secret("llm.api_key")
        if not api_key and legacy_api_key:
            file_payload["api_key"] = legacy_api_key
            self._path.write_bytes(orjson.dumps(file_payload, option=orjson.OPT_INDENT_2))

        return self._build_config(data=file_payload)

    def _build_config(self, *, data: dict[str, object]) -> LLMConfig:
        base_url = str(data.get("base_url", "")).strip() or self._settings.llm_base_url
        safe_api_key = _normalize_api_key(str(data.get("api_key", "")).strip(), base_url, self._settings.llm_api_key)
        return {
            "mode": _normalize_llm_mode(data.get("mode", "api")),
            "load_profile": _normalize_load_profile(data.get("load_profile", "balanced")),
            "local_model_id": _normalize_local_model_id(data.get("local_model_id", self._settings.llm_local_model_id)),
            "api_key": safe_api_key,
            "api_key_configured": bool(safe_api_key),
            "base_url": base_url,
            "model": str(data.get("model", "")).strip() or self._settings.llm_model,
            "correction_mode": _normalize_correction_mode(data.get("correction_mode", self._settings.llm_correction_mode)),
            "correction_batch_size": _normalize_correction_batch_size(
                data.get("correction_batch_size", self._settings.llm_correction_batch_size)
            ),
            "correction_overlap": _normalize_correction_overlap(
                data.get("correction_overlap", self._settings.llm_correction_overlap)
            ),
        }

    def _migrate_legacy_config_if_needed(self) -> None:
        if self._path.exists():
            return
        if not self._legacy_path.exists():
            return
        try:
            self._path.write_bytes(self._legacy_path.read_bytes())
        except OSError:
            return

    def _read_legacy_secret(self, key: str) -> str:
        try:
            from app.services.secret_store import SecretStore
        except Exception:  # noqa: BLE001
            return ""
        try:
            return SecretStore(self._settings).get(key, "").strip()
        except Exception:  # noqa: BLE001
            return ""


def _resolve_secret_update(raw: object, current_secret: str) -> str:
    candidate = str(raw or "").strip()
    if candidate in _LEGACY_MASK_PLACEHOLDERS:
        return current_secret.strip()
    return candidate


def _normalize_correction_mode(raw: object) -> str:
    candidate = str(raw).strip().lower()
    if candidate in {"off", "strict", "rewrite"}:
        return candidate
    return "strict"


def _normalize_correction_batch_size(raw: object) -> int:
    try:
        numeric = int(raw)
    except (TypeError, ValueError):
        numeric = 24
    return max(6, min(80, numeric))


def _normalize_correction_overlap(raw: object) -> int:
    try:
        numeric = int(raw)
    except (TypeError, ValueError):
        numeric = 3
    return max(0, min(20, numeric))


def _normalize_llm_mode(raw: object) -> str:
    _ = raw
    return "api"


def _normalize_local_model_id(raw: object) -> str:
    candidate = str(raw).strip()
    if candidate:
        return candidate
    return DEFAULT_LOCAL_LLM_MODEL_ID


def _normalize_load_profile(raw: object) -> str:
    candidate = str(raw).strip().lower()
    if candidate in SUPPORTED_LOAD_PROFILES:
        return candidate
    return "balanced"


def _normalize_api_key(raw: object, base_url: str, default_api_key: str) -> str:
    candidate = str(raw or "").strip()
    if candidate:
        return candidate
    normalized_base_url = str(base_url).strip().lower()
    if normalized_base_url.startswith("http://127.0.0.1:11434") or normalized_base_url.startswith("http://localhost:11434"):
        return str(default_api_key or "ollama").strip() or "ollama"
    return ""
