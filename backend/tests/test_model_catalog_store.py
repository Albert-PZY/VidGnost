from __future__ import annotations

import asyncio
from pathlib import Path

from app.config import Settings
from app.services.model_catalog_store import ModelCatalogStore
from app.services.ollama_runtime_config_store import OllamaRuntimeConfigStore
from app.services.ollama_client import OllamaClient


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


def _materialize_whisper_cache(model_dir: Path) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    for file_name in ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt"):
        (model_dir / file_name).write_text("ready", encoding="utf-8")
    (model_dir / ".ready.json").write_text('{"status":"ready"}', encoding="utf-8")


def _materialize_ollama_manifest(models_dir: Path, model_name: str, tag_file: str) -> None:
    manifest_dir = OllamaClient.resolve_model_storage_path(model_name, models_dir=models_dir)
    manifest_dir.mkdir(parents=True, exist_ok=True)
    (manifest_dir / tag_file).write_text("ready", encoding="utf-8")


def test_catalog_reports_whisper_default_path_when_not_ready(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    store = ModelCatalogStore(settings)

    models = asyncio.run(store.list_models())
    whisper = next(item for item in models if item["id"] == "whisper-default")

    assert whisper["default_path"] == str(Path(settings.storage_dir) / "model-hub" / "faster-whisper-small")
    assert whisper["path"] == ""
    assert whisper["is_installed"] is False
    assert whisper["supports_managed_download"] is True
    assert whisper["status"] == "not_ready"


def test_catalog_uses_default_whisper_install_directory_when_ready(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    default_dir = Path(settings.storage_dir) / "model-hub" / "faster-whisper-small"
    _materialize_whisper_cache(default_dir)
    store = ModelCatalogStore(settings)

    models = asyncio.run(store.list_models())
    whisper = next(item for item in models if item["id"] == "whisper-default")

    assert whisper["default_path"] == str(default_dir)
    assert whisper["path"] == str(default_dir)
    assert whisper["is_installed"] is True
    assert whisper["status"] == "ready"
    assert whisper["size_bytes"] > 0


def test_catalog_marks_all_local_models_as_managed_download_targets(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    store = ModelCatalogStore(settings)

    models = asyncio.run(store.list_models())
    managed_ids = {item["id"] for item in models if item["supports_managed_download"]}

    assert {"whisper-default", "embedding-default", "vlm-default", "rerank-default"}.issubset(managed_ids)


def test_catalog_detects_ollama_models_from_disk_when_service_list_is_empty(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    models_dir = tmp_path / "G" / "Ollama_Model"
    runtime_store = OllamaRuntimeConfigStore(settings)
    asyncio.run(runtime_store.save({"models_dir": str(models_dir)}))
    _materialize_ollama_manifest(models_dir, "bge-m3", "latest")
    _materialize_ollama_manifest(models_dir, "qwen2.5:3b", "3b")

    class EmptyOllamaClient:
        async def list_local_models(self) -> dict[str, object]:
            return {}

    store = ModelCatalogStore(
        settings,
        ollama_client=EmptyOllamaClient(),  # type: ignore[arg-type]
        ollama_runtime_config_store=runtime_store,
    )

    models = asyncio.run(store.list_models())
    embedding = next(item for item in models if item["id"] == "embedding-default")
    llm = next(item for item in models if item["id"] == "llm-default")

    assert embedding["is_installed"] is True
    assert embedding["path"] == str(OllamaClient.resolve_model_storage_path("bge-m3", models_dir=models_dir))
    assert llm["is_installed"] is True
    assert llm["path"] == str(OllamaClient.resolve_model_storage_path("qwen2.5:3b", models_dir=models_dir))
