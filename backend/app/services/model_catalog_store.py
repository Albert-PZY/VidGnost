from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict

import orjson

from app.config import Settings
from app.services.huggingface_model_downloader import HuggingFaceModelDownloader
from app.services.managed_model_registry import get_managed_model_spec, managed_model_target_dir
from app.services.ollama_client import OllamaClient, OllamaLocalModel
from app.services.ollama_runtime_config_store import OllamaRuntimeConfigStore

_REMOTE_PROVIDER = "openai_compatible"
_SUPPORTED_COMPONENTS = {"whisper", "llm", "embedding", "vlm", "rerank", "mllm"}
_SUPPORTED_PROVIDERS = {"local", "ollama", _REMOTE_PROVIDER}
_SUPPORTED_API_PROTOCOLS = {"openai_compatible", "aliyun_bailian"}
_ALIYUN_COMPAT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_IMAGE_MAX_BYTES = 512 * 1024
_DEFAULT_IMAGE_MAX_EDGE = 1280
_DEFAULT_API_TIMEOUT_SECONDS = 120


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
    api_base_url: str
    api_key: str
    api_key_configured: bool
    api_model: str
    api_protocol: str
    api_timeout_seconds: int
    api_image_max_bytes: int
    api_image_max_edge: int


DEFAULT_MODELS: list[ModelEntry] = [
    {
        "id": "whisper-default",
        "component": "whisper",
        "name": "FasterWhisper Small",
        "provider": "local",
        "model_id": "faster-whisper/small",
        "path": "",
        "status": "not_ready",
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
        "api_base_url": "",
        "api_key": "",
        "api_key_configured": False,
        "api_model": "",
        "api_protocol": "openai_compatible",
        "api_timeout_seconds": _DEFAULT_API_TIMEOUT_SECONDS,
        "api_image_max_bytes": _DEFAULT_IMAGE_MAX_BYTES,
        "api_image_max_edge": _DEFAULT_IMAGE_MAX_EDGE,
    },
    {
        "id": "llm-default",
        "component": "llm",
        "name": "默认 LLM",
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
        "api_base_url": _ALIYUN_COMPAT_BASE_URL,
        "api_key": "",
        "api_key_configured": False,
        "api_model": "qwen3.5-plus",
        "api_protocol": "openai_compatible",
        "api_timeout_seconds": _DEFAULT_API_TIMEOUT_SECONDS,
        "api_image_max_bytes": _DEFAULT_IMAGE_MAX_BYTES,
        "api_image_max_edge": _DEFAULT_IMAGE_MAX_EDGE,
    },
    {
        "id": "embedding-default",
        "component": "embedding",
        "name": "默认嵌入模型",
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
        "api_base_url": _ALIYUN_COMPAT_BASE_URL,
        "api_key": "",
        "api_key_configured": False,
        "api_model": "qwen3-vl-embedding",
        "api_protocol": "aliyun_bailian",
        "api_timeout_seconds": _DEFAULT_API_TIMEOUT_SECONDS,
        "api_image_max_bytes": _DEFAULT_IMAGE_MAX_BYTES,
        "api_image_max_edge": _DEFAULT_IMAGE_MAX_EDGE,
    },
    {
        "id": "vlm-default",
        "component": "vlm",
        "name": "默认 VLM",
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
        "api_base_url": _ALIYUN_COMPAT_BASE_URL,
        "api_key": "",
        "api_key_configured": False,
        "api_model": "qwen-image-2.0",
        "api_protocol": "openai_compatible",
        "api_timeout_seconds": _DEFAULT_API_TIMEOUT_SECONDS,
        "api_image_max_bytes": _DEFAULT_IMAGE_MAX_BYTES,
        "api_image_max_edge": _DEFAULT_IMAGE_MAX_EDGE,
    },
    {
        "id": "rerank-default",
        "component": "rerank",
        "name": "默认重排序模型",
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
        "api_base_url": _ALIYUN_COMPAT_BASE_URL,
        "api_key": "",
        "api_key_configured": False,
        "api_model": "qwen3-vl-rerank",
        "api_protocol": "aliyun_bailian",
        "api_timeout_seconds": _DEFAULT_API_TIMEOUT_SECONDS,
        "api_image_max_bytes": _DEFAULT_IMAGE_MAX_BYTES,
        "api_image_max_edge": _DEFAULT_IMAGE_MAX_EDGE,
    },
    {
        "id": "mllm-default",
        "component": "mllm",
        "name": "OpenAI Compatible MLLM",
        "provider": _REMOTE_PROVIDER,
        "model_id": "qwen3.5-omni-flash",
        "path": "",
        "status": "not_ready",
        "quantization": "",
        "load_profile": "balanced",
        "max_batch_size": 1,
        "rerank_top_n": 8,
        "frame_interval_seconds": 10,
        "enabled": False,
        "size_bytes": 0,
        "default_path": "",
        "is_installed": False,
        "supports_managed_download": False,
        "last_check_at": "",
        "api_base_url": _ALIYUN_COMPAT_BASE_URL,
        "api_key": "",
        "api_key_configured": False,
        "api_model": "qwen3.5-omni-flash",
        "api_protocol": "openai_compatible",
        "api_timeout_seconds": _DEFAULT_API_TIMEOUT_SECONDS,
        "api_image_max_bytes": _DEFAULT_IMAGE_MAX_BYTES,
        "api_image_max_edge": _DEFAULT_IMAGE_MAX_EDGE,
    },
]


class ModelCatalogStore:
    def __init__(
        self,
        settings: Settings,
        *,
        ollama_client: OllamaClient | None = None,
        ollama_runtime_config_store: OllamaRuntimeConfigStore | None = None,
    ) -> None:
        self._settings = settings
        self._path = Path(settings.storage_dir) / "models" / "catalog.json"
        self._hf_downloader = HuggingFaceModelDownloader(settings)
        self._ollama_runtime_config_store = ollama_runtime_config_store or OllamaRuntimeConfigStore(settings)
        self._ollama_client = ollama_client or OllamaClient(
            settings,
            runtime_config_store=self._ollama_runtime_config_store,
        )
        self._lock = asyncio.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_file()

    async def list_models(self) -> list[ModelEntry]:
        async with self._lock:
            ollama_models = await self._ollama_client.list_local_models()
            return self._hydrate_models(self._read_sync(), ollama_models=ollama_models)

    async def get_model(self, model_id: str) -> ModelEntry | None:
        models = await self.list_models()
        return next((item for item in models if str(item.get("id", "")).strip() == model_id), None)

    async def update_model(self, model_id: str, updates: dict[str, Any]) -> list[ModelEntry]:
        async with self._lock:
            models = self._read_sync()
            target = next((item for item in models if item["id"] == model_id), None)
            if target is None:
                raise ValueError("Model not found")
            allowed_keys = {
                "name",
                "provider",
                "model_id",
                "path",
                "status",
                "load_profile",
                "quantization",
                "max_batch_size",
                "rerank_top_n",
                "frame_interval_seconds",
                "enabled",
                "api_base_url",
                "api_key",
                "api_model",
                "api_protocol",
                "api_timeout_seconds",
                "api_image_max_bytes",
                "api_image_max_edge",
            }
            for key, value in updates.items():
                if key not in allowed_keys or value is None:
                    continue
                if key == "provider":
                    target[key] = _normalize_provider(
                        value,
                        component=str(target.get("component", "")).strip(),
                        default=str(target.get("provider", "local")).strip() or "local",
                    )
                elif key == "path":
                    target[key] = _normalize_optional_path(value, storage_dir=self._settings.storage_dir)
                elif key == "model_id":
                    target[key] = str(value).strip()
                elif key in {"name", "status", "load_profile", "quantization", "api_base_url", "api_key", "api_model", "api_protocol"}:
                    target[key] = str(value).strip()
                elif key == "max_batch_size":
                    target[key] = max(1, min(64, int(value)))
                elif key == "rerank_top_n":
                    target[key] = max(1, min(20, int(value)))
                elif key == "frame_interval_seconds":
                    target[key] = max(1, min(600, int(value)))
                elif key == "api_timeout_seconds":
                    target[key] = max(10, min(600, int(value)))
                elif key == "api_image_max_bytes":
                    target[key] = max(32 * 1024, min(8 * 1024 * 1024, int(value)))
                elif key == "api_image_max_edge":
                    target[key] = max(256, min(4096, int(value)))
                elif key == "enabled":
                    target[key] = bool(value)
            target["last_check_at"] = datetime.now(timezone.utc).isoformat()
            normalized = self._normalize_models(models)
            self._write_sync(normalized)
            ollama_models = await self._ollama_client.list_local_models()
            return self._hydrate_models(normalized, ollama_models=ollama_models)

    async def reload_models(self, model_id: str | None = None) -> list[ModelEntry]:
        async with self._lock:
            models = self._read_sync()
            now = datetime.now(timezone.utc).isoformat()
            for item in models:
                if model_id and item["id"] != model_id:
                    continue
                item["last_check_at"] = now
            normalized = self._normalize_models(models)
            self._write_sync(normalized)
            ollama_models = await self._ollama_client.list_local_models()
            return self._hydrate_models(normalized, ollama_models=ollama_models)

    async def sync_managed_local_model_paths(self) -> list[ModelEntry]:
        async with self._lock:
            models = self._read_sync()
            changed = False
            for item in models:
                model_id = str(item.get("id", "")).strip()
                provider = str(item.get("provider", "")).strip()
                spec = get_managed_model_spec(model_id)
                if provider != "local" or spec is None or spec.backend != "whisper":
                    continue
                resolved_path = self._resolve_ready_managed_local_path(item, spec=spec)
                normalized_path = str(resolved_path) if resolved_path is not None else ""
                if str(item.get("path", "")).strip() == normalized_path:
                    continue
                item["path"] = normalized_path
                item["last_check_at"] = datetime.now(timezone.utc).isoformat()
                changed = True

            normalized = self._normalize_models(models) if changed else models
            if changed:
                self._write_sync(normalized)
            ollama_models = await self._ollama_client.list_local_models()
            return self._hydrate_models(normalized, ollama_models=ollama_models)

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
        if not self._path.exists():
            defaults = [dict(item) for item in DEFAULT_MODELS]
            self._write_sync(defaults)
            return defaults
        try:
            payload = orjson.loads(self._path.read_bytes())
        except orjson.JSONDecodeError:
            payload = []
        raw_items = payload if isinstance(payload, list) else []
        normalized = self._normalize_models(raw_items)
        if raw_items != normalized:
            self._write_sync(normalized)
        return normalized

    def _normalize_models(self, payload: list[object]) -> list[ModelEntry]:
        payload_by_id: dict[str, dict[str, object]] = {}
        for item in payload:
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id", "")).strip()
            if model_id:
                payload_by_id[model_id] = item
        normalized: list[ModelEntry] = []
        for default_item in DEFAULT_MODELS:
            raw_item = payload_by_id.get(default_item["id"], {})
            normalized.append(self._normalize_single_model(default_item, raw_item))
        return normalized

    def _normalize_single_model(
        self,
        default_item: ModelEntry,
        raw_item: dict[str, object],
    ) -> ModelEntry:
        model_id = default_item["id"]
        component = default_item["component"]
        provider = _normalize_provider(raw_item.get("provider", default_item["provider"]), component=component, default=default_item["provider"])
        persisted_model_id = str(raw_item.get("model_id", "")).strip()
        if not persisted_model_id or persisted_model_id == _legacy_model_id_for(model_id):
            persisted_model_id = default_item["model_id"]
        normalized = {
            "id": model_id,
            "component": component,
            "name": str(raw_item.get("name", default_item["name"])).strip() or default_item["name"],
            "provider": provider,
            "model_id": persisted_model_id,
            "path": _normalize_optional_path(raw_item.get("path", default_item["path"]), storage_dir=self._settings.storage_dir),
            "status": str(raw_item.get("status", default_item["status"])).strip() or default_item["status"],
            "quantization": str(raw_item.get("quantization", default_item["quantization"])).strip(),
            "load_profile": _normalize_load_profile(raw_item.get("load_profile", default_item["load_profile"])),
            "max_batch_size": _clamp_int(raw_item.get("max_batch_size", default_item["max_batch_size"]), minimum=1, maximum=64, fallback=default_item["max_batch_size"]),
            "rerank_top_n": _clamp_int(raw_item.get("rerank_top_n", default_item["rerank_top_n"]), minimum=1, maximum=20, fallback=default_item["rerank_top_n"]),
            "frame_interval_seconds": _clamp_int(raw_item.get("frame_interval_seconds", default_item["frame_interval_seconds"]), minimum=1, maximum=600, fallback=default_item["frame_interval_seconds"]),
            "enabled": bool(raw_item.get("enabled", default_item["enabled"])),
            "size_bytes": max(0, int(raw_item.get("size_bytes", 0) or 0)),
            "default_path": "",
            "is_installed": bool(raw_item.get("is_installed", False)),
            "supports_managed_download": bool(raw_item.get("supports_managed_download", default_item["supports_managed_download"])),
            "last_check_at": str(raw_item.get("last_check_at", default_item["last_check_at"])).strip(),
            "api_base_url": str(raw_item.get("api_base_url", default_item["api_base_url"])).strip(),
            "api_key": str(raw_item.get("api_key", default_item["api_key"])).strip(),
            "api_key_configured": bool(str(raw_item.get("api_key", default_item["api_key"])).strip()),
            "api_model": str(raw_item.get("api_model", default_item["api_model"])).strip() or default_item["api_model"],
            "api_protocol": _normalize_api_protocol(raw_item.get("api_protocol", default_item["api_protocol"])),
            "api_timeout_seconds": _clamp_int(raw_item.get("api_timeout_seconds", default_item["api_timeout_seconds"]), minimum=10, maximum=600, fallback=default_item["api_timeout_seconds"]),
            "api_image_max_bytes": _clamp_int(raw_item.get("api_image_max_bytes", default_item["api_image_max_bytes"]), minimum=32 * 1024, maximum=8 * 1024 * 1024, fallback=default_item["api_image_max_bytes"]),
            "api_image_max_edge": _clamp_int(raw_item.get("api_image_max_edge", default_item["api_image_max_edge"]), minimum=256, maximum=4096, fallback=default_item["api_image_max_edge"]),
        }
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
        provider = str(item.get("provider", "")).strip()
        raw_path = str(item.get("path", "")).strip()
        default_path = self._resolve_default_path(item)
        spec = get_managed_model_spec(str(item.get("id", "")))

        if provider == _REMOTE_PROVIDER:
            self._hydrate_remote_model(hydrated, item)
            return hydrated

        if spec is not None and spec.backend == "ollama" and provider == "ollama":
            self._hydrate_ollama_model(hydrated, item, default_path, ollama_models=ollama_models)
            return hydrated

        if spec is not None and spec.backend == "whisper" and provider == "local":
            self._hydrate_managed_local_model(hydrated, item, default_path)
            return hydrated

        resolved_path = self._resolve_local_model_path(raw_path or default_path) if raw_path or default_path else None
        is_installed = bool(resolved_path and resolved_path.exists())
        hydrated["path"] = str(resolved_path) if resolved_path is not None else raw_path
        hydrated["default_path"] = default_path
        hydrated["is_installed"] = is_installed
        hydrated["supports_managed_download"] = False
        hydrated["size_bytes"] = self._measure_path_size(resolved_path) if is_installed and resolved_path is not None else 0
        hydrated["status"] = "ready" if is_installed else "not_ready"
        return hydrated

    def _resolve_default_path(self, item: ModelEntry) -> str:
        provider = str(item.get("provider", "")).strip()
        spec = get_managed_model_spec(str(item.get("id", "")))
        if spec is not None and spec.backend == "whisper" and provider == "local":
            return str(managed_model_target_dir(self._settings.storage_dir, spec))
        if spec is not None and spec.backend == "ollama" and provider == "ollama":
            models_dir = self._ollama_runtime_config_store.get_sync()["models_dir"]
            return str(
                OllamaClient.resolve_model_storage_path(
                    str(item.get("model_id", "")).strip() or spec.remote_id,
                    models_dir=models_dir,
                )
            )
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
        resolved_path = self._resolve_ready_managed_local_path(item, spec=spec) if spec is not None else None
        is_installed = resolved_path is not None
        configured_path = str(item.get("path", "")).strip()
        hydrated["path"] = str(resolved_path) if is_installed and resolved_path is not None else configured_path
        hydrated["default_path"] = default_path
        hydrated["is_installed"] = is_installed
        hydrated["supports_managed_download"] = True
        hydrated["size_bytes"] = self._measure_path_size(resolved_path) if is_installed and resolved_path is not None else 0
        hydrated["status"] = "ready" if is_installed else "not_ready"

    def _resolve_ready_managed_local_path(self, item: ModelEntry, *, spec) -> Path | None:
        candidate_paths: list[str] = []
        configured_path = str(item.get("path", "")).strip()
        if configured_path:
            candidate_paths.append(configured_path)
        candidate_paths.append(str(managed_model_target_dir(self._settings.storage_dir, spec)))

        for raw_candidate in candidate_paths:
            resolved_path = self._resolve_local_model_path(raw_candidate)
            if resolved_path is None:
                continue
            if self._hf_downloader.is_repo_ready(resolved_path, required_files=spec.required_files):
                return resolved_path
        return None

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
        disk_path = self._resolve_local_model_path(default_path) if default_path else None
        files_present_on_disk = self._path_has_files(disk_path)
        resolved_path = (
            str(getattr(local_model, "path", "")).strip()
            if local_model is not None
            else ""
        ) or (str(disk_path) if files_present_on_disk and disk_path is not None else default_path)
        is_installed = local_model is not None or files_present_on_disk
        hydrated["path"] = resolved_path
        hydrated["default_path"] = default_path
        hydrated["is_installed"] = is_installed
        hydrated["supports_managed_download"] = True
        hydrated["size_bytes"] = max(0, int(getattr(local_model, "size_bytes", 0) or 0)) if local_model is not None else 0
        hydrated["status"] = "ready" if is_installed else "not_ready"

    def _hydrate_remote_model(self, hydrated: ModelEntry, item: ModelEntry) -> None:
        api_base_url = str(item.get("api_base_url", "")).strip()
        api_key = str(item.get("api_key", "")).strip()
        api_model = str(item.get("api_model", "")).strip() or str(item.get("model_id", "")).strip()
        hydrated["path"] = ""
        hydrated["default_path"] = ""
        hydrated["is_installed"] = bool(api_base_url and api_model and api_key)
        hydrated["supports_managed_download"] = False
        hydrated["size_bytes"] = 0
        hydrated["api_key_configured"] = bool(api_key)
        hydrated["status"] = "ready" if hydrated["is_installed"] else "not_ready"

    def _measure_path_size(self, target: Path | None) -> int:
        if target is None:
            return 0
        if target.is_file():
            return max(0, int(target.stat().st_size))
        if not target.is_dir():
            return 0
        total = 0
        for file_path in target.rglob("*"):
            if file_path.is_file():
                total += max(0, int(file_path.stat().st_size))
        return total

    @staticmethod
    def _path_has_files(target: Path | None) -> bool:
        if target is None or not target.exists():
            return False
        if target.is_file():
            return True
        try:
            next(target.iterdir())
        except StopIteration:
            return False
        return True


def _normalize_provider(raw: object, *, component: str, default: str) -> str:
    candidate = str(raw or "").strip().lower()
    if component == "whisper":
        return "local"
    if component == "mllm":
        return _REMOTE_PROVIDER if candidate not in {"ollama", "local"} else candidate
    if candidate in _SUPPORTED_PROVIDERS:
        return candidate
    return default if default in _SUPPORTED_PROVIDERS else "local"


def _normalize_api_protocol(raw: object) -> str:
    candidate = str(raw or "").strip().lower()
    if candidate in _SUPPORTED_API_PROTOCOLS:
        return candidate
    return "openai_compatible"


def _normalize_load_profile(raw: object) -> str:
    candidate = str(raw or "").strip().lower()
    if candidate in {"balanced", "memory_first"}:
        return candidate
    return "balanced"


def _clamp_int(raw: object, *, minimum: int, maximum: int, fallback: int) -> int:
    try:
        numeric = int(raw)
    except (TypeError, ValueError):
        numeric = fallback
    return max(minimum, min(maximum, numeric))


def _normalize_optional_path(raw: object, *, storage_dir: str) -> str:
    candidate = str(raw or "").strip()
    if not candidate:
        return ""
    path = Path(candidate).expanduser()
    if not path.is_absolute():
        path = (Path(storage_dir) / path).resolve()
    else:
        path = path.resolve()
    return str(path)


def _legacy_model_id_for(model_id: str) -> str:
    legacy = {
        "llm-default": "gpt-4.1-mini",
        "embedding-default": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        "vlm-default": "vikhyatk/moondream2",
        "rerank-default": "BAAI/bge-reranker-v2-m3",
    }
    return legacy.get(model_id, "")
