from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict

import orjson

from app.config import Settings
from app.services.huggingface_model_downloader import HuggingFaceModelDownloader
from app.services.ollama_client import OllamaClient, OllamaLocalModel
from app.services.managed_model_registry import get_managed_model_spec, managed_model_target_dir, supports_managed_download


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
    rerank_top_n: int
    frame_interval_seconds: int
    enabled: bool
    size_bytes: int
    default_path: str
    is_installed: bool
    supports_managed_download: bool
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
        "rerank_top_n": 8,
        "frame_interval_seconds": 10,
        "enabled": True,
        "size_bytes": 0,
        "default_path": "",
        "is_installed": False,
        "supports_managed_download": True,
        "last_check_at": "",
    },
    {
        "id": "llm-default",
        "component": "llm",
        "name": "Ollama Qwen2.5 3B",
        "provider": "ollama",
        "model_id": "qwen2.5:3b",
        "path": "",
        "status": "not_ready",
        "quantization": "Q4_K_M",
        "load_profile": "balanced",
        "max_batch_size": 1,
        "rerank_top_n": 8,
        "frame_interval_seconds": 10,
        "enabled": True,
        "size_bytes": 0,
        "default_path": "",
        "is_installed": False,
        "supports_managed_download": True,
        "last_check_at": "",
    },
    {
        "id": "embedding-default",
        "component": "embedding",
        "name": "Ollama BGE-M3",
        "provider": "ollama",
        "model_id": "bge-m3",
        "path": "",
        "status": "not_ready",
        "quantization": "",
        "load_profile": "balanced",
        "max_batch_size": 16,
        "rerank_top_n": 8,
        "frame_interval_seconds": 10,
        "enabled": True,
        "size_bytes": 0,
        "default_path": "",
        "is_installed": False,
        "supports_managed_download": True,
        "last_check_at": "",
    },
    {
        "id": "vlm-default",
        "component": "vlm",
        "name": "Ollama Moondream",
        "provider": "ollama",
        "model_id": "moondream",
        "path": "",
        "status": "not_ready",
        "quantization": "Q4_K_M",
        "load_profile": "memory_first",
        "max_batch_size": 1,
        "rerank_top_n": 8,
        "frame_interval_seconds": 10,
        "enabled": True,
        "size_bytes": 0,
        "default_path": "",
        "is_installed": False,
        "supports_managed_download": True,
        "last_check_at": "",
    },
    {
        "id": "rerank-default",
        "component": "rerank",
        "name": "Ollama Qwen3 Reranker",
        "provider": "ollama",
        "model_id": "sam860/qwen3-reranker:0.6b-q8_0",
        "path": "",
        "status": "not_ready",
        "quantization": "Q8_0",
        "load_profile": "balanced",
        "max_batch_size": 8,
        "rerank_top_n": 8,
        "frame_interval_seconds": 10,
        "enabled": True,
        "size_bytes": 0,
        "default_path": "",
        "is_installed": False,
        "supports_managed_download": True,
        "last_check_at": "",
    },
]


class ModelCatalogStore:
    def __init__(
        self,
        settings: Settings,
        *,
        ollama_client: OllamaClient | None = None,
    ) -> None:
        self._settings = settings
        self._path = Path(settings.storage_dir) / "models" / "catalog.json"
        self._hf_downloader = HuggingFaceModelDownloader(settings)
        self._ollama_client = ollama_client or OllamaClient(settings)
        self._lock = asyncio.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_file()

    async def list_models(self) -> list[ModelEntry]:
        async with self._lock:
            ollama_models = await self._ollama_client.list_local_models()
            return self._hydrate_models(self._read_sync(), ollama_models=ollama_models)

    async def update_model(self, model_id: str, updates: dict[str, Any]) -> list[ModelEntry]:
        async with self._lock:
            models = self._read_sync()
            target = next((item for item in models if item["id"] == model_id), None)
            if target is None:
                raise ValueError("Model not found")
            allowed_keys = {"path", "status", "load_profile", "quantization", "max_batch_size", "rerank_top_n", "frame_interval_seconds", "enabled"}
            for key, value in updates.items():
                if key not in allowed_keys or value is None:
                    continue
                if key == "max_batch_size":
                    target[key] = max(1, min(64, int(value)))
                elif key == "rerank_top_n":
                    target[key] = max(1, min(20, int(value)))
                elif key == "frame_interval_seconds":
                    target[key] = max(1, min(600, int(value)))
                elif key == "enabled":
                    target[key] = bool(value)
                else:
                    target[key] = str(value).strip()
            target["last_check_at"] = datetime.now(timezone.utc).isoformat()
            self._write_sync(models)
            ollama_models = await self._ollama_client.list_local_models()
            return self._hydrate_models(models, ollama_models=ollama_models)

    async def reload_models(self, model_id: str | None = None) -> list[ModelEntry]:
        async with self._lock:
            models = self._read_sync()
            now = datetime.now(timezone.utc).isoformat()
            for item in models:
                if model_id and item["id"] != model_id:
                    continue
                item["last_check_at"] = now
            self._write_sync(models)
            ollama_models = await self._ollama_client.list_local_models()
            return self._hydrate_models(models, ollama_models=ollama_models)

    def get_rerank_top_n(self) -> int:
        models = self._read_sync()
        rerank_model = next((item for item in models if item["component"] == "rerank"), None)
        if rerank_model is None:
            return 8
        return max(1, min(20, int(rerank_model.get("rerank_top_n", 8) or 8)))

    def _ensure_file(self) -> None:
        if self._path.exists():
            return
        self._write_sync([dict(item) for item in DEFAULT_MODELS])

    def _read_sync(self) -> list[ModelEntry]:
        defaults_by_id = {item["id"]: dict(item) for item in DEFAULT_MODELS}
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
            default_item = defaults_by_id.get(model_id, {})
            provider = str(item.get("provider", default_item.get("provider", "local"))).strip()
            managed_spec = get_managed_model_spec(model_id)
            default_remote_id = str(default_item.get("model_id", "")).strip()
            persisted_remote_id = str(item.get("model_id", "")).strip()
            if managed_spec is not None and managed_spec.backend == "ollama":
                provider = "ollama"
                if not persisted_remote_id or persisted_remote_id == _legacy_model_id_for(model_id):
                    persisted_remote_id = default_remote_id
            normalized.append(
                {
                    "id": model_id,
                    "component": component,
                    "name": str(item.get("name", default_item.get("name", model_id))),
                    "provider": provider,
                    "model_id": persisted_remote_id or default_remote_id,
                    "path": str(item.get("path", "")),
                    "status": str(item.get("status", default_item.get("status", "ready"))),
                    "quantization": str(item.get("quantization", default_item.get("quantization", ""))),
                    "load_profile": str(item.get("load_profile", default_item.get("load_profile", "balanced"))),
                    "max_batch_size": max(1, min(64, int(item.get("max_batch_size", default_item.get("max_batch_size", 1)) or 1))),
                    "rerank_top_n": max(1, min(20, int(item.get("rerank_top_n", default_item.get("rerank_top_n", 8)) or 8))),
                    "frame_interval_seconds": max(1, min(600, int(item.get("frame_interval_seconds", default_item.get("frame_interval_seconds", 10)) or 10))),
                    "enabled": bool(item.get("enabled", True)),
                    "size_bytes": max(0, int(item.get("size_bytes", 0) or 0)),
                    "default_path": str(item.get("default_path", "")),
                    "is_installed": bool(item.get("is_installed", False)),
                    "supports_managed_download": bool(item.get("supports_managed_download", default_item.get("supports_managed_download", False))),
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

    def _hydrate_models(
        self,
        models: list[ModelEntry],
        *,
        ollama_models: dict[str, OllamaLocalModel],
    ) -> list[ModelEntry]:
        return [self._hydrate_single_model(item, ollama_models=ollama_models) for item in models]

    def _hydrate_single_model(
        self,
        item: ModelEntry,
        *,
        ollama_models: dict[str, OllamaLocalModel],
    ) -> ModelEntry:
        hydrated = dict(item)
        component = str(item.get("component", "")).strip()
        provider = str(item.get("provider", "")).strip()
        raw_path = str(item.get("path", "")).strip()
        default_path = self._resolve_default_path(item)

        if component == "whisper":
            self._hydrate_managed_local_model(hydrated, item, default_path)
            return hydrated

        if supports_managed_download(str(item.get("id", ""))):
            spec = get_managed_model_spec(str(item.get("id", "")))
            if spec is not None and spec.backend == "ollama":
                self._hydrate_ollama_model(hydrated, item, default_path, ollama_models=ollama_models)
            else:
                self._hydrate_managed_local_model(hydrated, item, default_path)
            return hydrated

        resolved_path = self._resolve_local_model_path(raw_path) if raw_path else None
        is_installed = bool(resolved_path and resolved_path.exists())
        hydrated["path"] = str(resolved_path) if is_installed and resolved_path is not None else raw_path
        hydrated["default_path"] = default_path
        hydrated["is_installed"] = is_installed
        hydrated["supports_managed_download"] = False
        hydrated["size_bytes"] = self._measure_path_size(resolved_path) if is_installed and resolved_path is not None else 0
        hydrated["status"] = "ready" if is_installed else "not_ready"
        return hydrated

    def _resolve_default_path(self, item: ModelEntry) -> str:
        spec = get_managed_model_spec(str(item.get("id", "")))
        if spec is not None:
            if spec.backend == "ollama":
                return OllamaClient.model_uri(str(item.get("model_id", "")).strip() or spec.remote_id)
            return str(managed_model_target_dir(self._settings.storage_dir, spec))
        raw_path = str(item.get("path", "")).strip()
        if not raw_path:
            return ""
        resolved_path = self._resolve_local_model_path(raw_path)
        return str(resolved_path) if resolved_path is not None else raw_path

    def _resolve_local_model_path(self, raw_path: str) -> Path | None:
        candidate = Path(raw_path).expanduser()
        if not candidate.is_absolute():
            candidate = (Path(self._settings.storage_dir) / candidate).resolve()
        else:
            candidate = candidate.resolve()
        return candidate

    def _hydrate_managed_local_model(self, hydrated: ModelEntry, item: ModelEntry, default_path: str) -> None:
        spec = get_managed_model_spec(str(item.get("id", "")))
        target_dir = Path(default_path) if default_path else None
        is_installed = bool(
            spec is not None
            and target_dir is not None
            and self._hf_downloader.is_repo_ready(target_dir, required_files=spec.required_files)
        )
        hydrated["path"] = str(target_dir) if is_installed and target_dir is not None else ""
        hydrated["default_path"] = default_path
        hydrated["is_installed"] = is_installed
        hydrated["supports_managed_download"] = True
        hydrated["size_bytes"] = self._measure_path_size(target_dir) if is_installed and target_dir is not None else 0
        hydrated["status"] = "ready" if is_installed else "not_ready"

    def _hydrate_ollama_model(
        self,
        hydrated: ModelEntry,
        item: ModelEntry,
        default_path: str,
        *,
        ollama_models: dict[str, OllamaLocalModel],
    ) -> None:
        model_name = str(item.get("model_id", "")).strip()
        local_model = ollama_models.get(model_name)
        hydrated["path"] = OllamaClient.model_uri(model_name) if local_model is not None else ""
        hydrated["default_path"] = default_path
        hydrated["is_installed"] = local_model is not None
        hydrated["supports_managed_download"] = True
        hydrated["size_bytes"] = local_model.size_bytes if local_model is not None else 0
        hydrated["status"] = "ready" if local_model is not None else "not_ready"

    def _measure_path_size(self, target: Path) -> int:
        if target.is_file():
            return max(0, int(target.stat().st_size))
        if not target.is_dir():
            return 0
        total = 0
        for file_path in target.rglob("*"):
            if file_path.is_file():
                total += max(0, int(file_path.stat().st_size))
        return total


def _legacy_model_id_for(model_id: str) -> str:
    legacy = {
        "llm-default": "gpt-4.1-mini",
        "embedding-default": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        "vlm-default": "vikhyatk/moondream2",
        "rerank-default": "BAAI/bge-reranker-v2-m3",
    }
    return legacy.get(model_id, "")
