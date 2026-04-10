from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict

import orjson

from app.config import Settings


class ModelEntry(TypedDict):
    id: str
    component: str
    name: str
    provider: str
    model_id: str
    path: str
    status: str
    quantization: str
    load_profile: str
    max_batch_size: int
    enabled: bool
    size_bytes: int
    last_check_at: str


DEFAULT_MODELS: list[ModelEntry] = [
    {
        "id": "whisper-default",
        "component": "whisper",
        "name": "FasterWhisper Small",
        "provider": "local",
        "model_id": "faster-whisper/small",
        "path": "",
        "status": "ready",
        "quantization": "int8",
        "load_profile": "balanced",
        "max_batch_size": 1,
        "enabled": True,
        "size_bytes": 0,
        "last_check_at": "",
    },
    {
        "id": "llm-default",
        "component": "llm",
        "name": "OpenAI Compatible LLM",
        "provider": "openai_compatible",
        "model_id": "gpt-4.1-mini",
        "path": "",
        "status": "ready",
        "quantization": "",
        "load_profile": "balanced",
        "max_batch_size": 1,
        "enabled": True,
        "size_bytes": 0,
        "last_check_at": "",
    },
    {
        "id": "embedding-default",
        "component": "embedding",
        "name": "Paraphrase Multilingual MiniLM",
        "provider": "local",
        "model_id": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        "path": "",
        "status": "ready",
        "quantization": "",
        "load_profile": "balanced",
        "max_batch_size": 16,
        "enabled": True,
        "size_bytes": 0,
        "last_check_at": "",
    },
    {
        "id": "vlm-default",
        "component": "vlm",
        "name": "Moondream2 4bit",
        "provider": "local",
        "model_id": "vikhyatk/moondream2",
        "path": "",
        "status": "loading",
        "quantization": "4bit",
        "load_profile": "memory_first",
        "max_batch_size": 1,
        "enabled": True,
        "size_bytes": 0,
        "last_check_at": "",
    },
    {
        "id": "rerank-default",
        "component": "rerank",
        "name": "BGE Reranker v2 m3",
        "provider": "local",
        "model_id": "BAAI/bge-reranker-v2-m3",
        "path": "",
        "status": "ready",
        "quantization": "",
        "load_profile": "balanced",
        "max_batch_size": 8,
        "enabled": True,
        "size_bytes": 0,
        "last_check_at": "",
    },
]


class ModelCatalogStore:
    def __init__(self, settings: Settings) -> None:
        self._path = Path(settings.storage_dir) / "models" / "catalog.json"
        self._lock = asyncio.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_file()

    async def list_models(self) -> list[ModelEntry]:
        async with self._lock:
            return self._read_sync()

    async def update_model(self, model_id: str, updates: dict[str, Any]) -> list[ModelEntry]:
        async with self._lock:
            models = self._read_sync()
            target = next((item for item in models if item["id"] == model_id), None)
            if target is None:
                raise ValueError("Model not found")
            allowed_keys = {"path", "status", "load_profile", "quantization", "max_batch_size", "enabled"}
            for key, value in updates.items():
                if key not in allowed_keys or value is None:
                    continue
                if key == "max_batch_size":
                    target[key] = max(1, min(64, int(value)))
                elif key == "enabled":
                    target[key] = bool(value)
                else:
                    target[key] = str(value).strip()
            target["last_check_at"] = datetime.now(timezone.utc).isoformat()
            self._write_sync(models)
            return models

    async def reload_models(self, model_id: str | None = None) -> list[ModelEntry]:
        async with self._lock:
            models = self._read_sync()
            now = datetime.now(timezone.utc).isoformat()
            for item in models:
                if model_id and item["id"] != model_id:
                    continue
                item["status"] = "ready" if item.get("enabled", True) else "error"
                item["last_check_at"] = now
            self._write_sync(models)
            return models

    def _ensure_file(self) -> None:
        if self._path.exists():
            return
        self._write_sync([dict(item) for item in DEFAULT_MODELS])

    def _read_sync(self) -> list[ModelEntry]:
        if not self._path.exists():
            return [dict(item) for item in DEFAULT_MODELS]
        try:
            payload = orjson.loads(self._path.read_bytes())
        except orjson.JSONDecodeError:
            payload = []
        if not isinstance(payload, list):
            payload = []
        normalized: list[ModelEntry] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id", "")).strip()
            component = str(item.get("component", "")).strip()
            if not model_id or component not in {"whisper", "llm", "embedding", "vlm", "rerank"}:
                continue
            normalized.append(
                {
                    "id": model_id,
                    "component": component,
                    "name": str(item.get("name", model_id)),
                    "provider": str(item.get("provider", "local")),
                    "model_id": str(item.get("model_id", "")),
                    "path": str(item.get("path", "")),
                    "status": str(item.get("status", "ready")),
                    "quantization": str(item.get("quantization", "")),
                    "load_profile": str(item.get("load_profile", "balanced")),
                    "max_batch_size": max(1, min(64, int(item.get("max_batch_size", 1) or 1))),
                    "enabled": bool(item.get("enabled", True)),
                    "size_bytes": max(0, int(item.get("size_bytes", 0) or 0)),
                    "last_check_at": str(item.get("last_check_at", "")),
                }
            )
        if not normalized:
            normalized = [dict(item) for item in DEFAULT_MODELS]
            self._write_sync(normalized)
        return normalized

    def _write_sync(self, models: list[ModelEntry]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self._path.with_suffix(".json.tmp")
        tmp_path.write_bytes(orjson.dumps(models, option=orjson.OPT_INDENT_2))
        tmp_path.replace(self._path)
