from __future__ import annotations

import asyncio
from pathlib import Path

from app.config import Settings
from app.models import TaskRecord
from app.services.model_catalog_store import ModelCatalogStore
from app.services.model_migration_service import ModelMigrationService
from app.services.ollama_client import OllamaClient
from app.services.ollama_runtime_config_store import OllamaRuntimeConfigStore
from app.services.task_store import TaskStore


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


class DummyOllamaClient:
    async def list_local_models(self) -> dict[str, object]:
        return {}


class StubOllamaServiceManager:
    def __init__(self) -> None:
        self.restart_calls = 0

    async def get_status(self) -> dict[str, object]:
        return {
            "reachable": True,
            "process_detected": True,
            "process_id": 1,
            "executable_path": "C:\\Ollama\\ollama.exe",
            "configured_models_dir": "G:\\Ollama_Model",
            "effective_models_dir": "F:\\legacy-models",
            "models_dir_source": "env",
            "using_configured_models_dir": False,
            "restart_required": True,
            "can_self_restart": True,
            "message": "ready",
        }

    async def restart_service(self) -> dict[str, object]:
        self.restart_calls += 1
        status = await self.get_status()
        status["using_configured_models_dir"] = True
        status["restart_required"] = False
        return status


def test_migrate_local_models_requires_confirmation_when_tasks_running(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    whisper_dir = tmp_path / "source-models" / "whisper"
    _materialize_whisper_cache(whisper_dir)
    task_store = TaskStore(settings.storage_dir)
    task_store.create(
        TaskRecord(
            id="task-running",
            source_type="local_path",
            source_input="demo.mp4",
            workflow="notes",
            status="running",
        )
    )
    store = ModelCatalogStore(settings, ollama_client=DummyOllamaClient())  # type: ignore[arg-type]
    asyncio.run(store.update_model("whisper-default", {"path": str(whisper_dir)}))
    service = ModelMigrationService(
        settings=settings,
        model_catalog_store=store,
        ollama_runtime_config_store=OllamaRuntimeConfigStore(settings),
        ollama_service_manager=StubOllamaServiceManager(),  # type: ignore[arg-type]
        task_store=task_store,
    )

    payload = asyncio.run(
        service.migrate_local_models(str(tmp_path / "target-models"), confirm_running_tasks=False)
    )

    assert payload["requires_confirmation"] is True
    assert payload["moved"] == []
    assert payload["planned_model_ids"] == ["whisper-default"]
    assert payload["running_tasks"][0]["id"] == "task-running"
    assert whisper_dir.exists()


def test_migrate_local_models_updates_catalog_and_restarts_ollama(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    whisper_dir = tmp_path / "legacy" / "whisper-default"
    llm_dir = tmp_path / "legacy" / "local-llm"
    _materialize_whisper_cache(whisper_dir)
    llm_dir.mkdir(parents=True, exist_ok=True)
    (llm_dir / "model.gguf").write_text("llm", encoding="utf-8")

    ollama_manager = StubOllamaServiceManager()
    store = ModelCatalogStore(settings, ollama_client=DummyOllamaClient())  # type: ignore[arg-type]
    asyncio.run(store.update_model("whisper-default", {"path": str(whisper_dir)}))
    asyncio.run(
        store.update_model(
            "llm-default",
            {
                "provider": "local",
                "path": str(llm_dir),
            },
        )
    )
    service = ModelMigrationService(
        settings=settings,
        model_catalog_store=store,
        ollama_runtime_config_store=OllamaRuntimeConfigStore(settings),
        ollama_service_manager=ollama_manager,  # type: ignore[arg-type]
        task_store=TaskStore(settings.storage_dir),
    )
    target_root = tmp_path / "G" / "ModelHub"

    payload = asyncio.run(service.migrate_local_models(str(target_root), confirm_running_tasks=True))
    models = asyncio.run(store.list_models())
    whisper_model = next(item for item in models if item["id"] == "whisper-default")
    llm_model = next(item for item in models if item["id"] == "llm-default")

    assert payload["requires_confirmation"] is False
    assert payload["ollama_restarted"] is True
    assert set(payload["moved"]) == {"whisper-default", "llm-default"}
    assert ollama_manager.restart_calls == 1
    assert whisper_model["path"] == str(target_root / "whisper" / "whisper-default")
    assert llm_model["path"] == str(target_root / "llm" / "llm-default")
    assert Path(whisper_model["path"]).exists()
    assert Path(llm_model["path"]).exists()
    assert not whisper_dir.exists()
    assert not llm_dir.exists()


def test_migrate_local_models_moves_ollama_storage_root_and_updates_runtime_config(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    source_root = tmp_path / "legacy" / "ollama-models"
    target_root = tmp_path / "G" / "Ollama_Model"
    _materialize_ollama_manifest(source_root, "bge-m3", "latest")
    _materialize_ollama_manifest(source_root, "qwen2.5:3b", "3b")

    ollama_runtime_store = OllamaRuntimeConfigStore(settings)
    asyncio.run(ollama_runtime_store.save({"models_dir": str(source_root)}))

    ollama_manager = StubOllamaServiceManager()
    store = ModelCatalogStore(
        settings,
        ollama_client=DummyOllamaClient(),  # type: ignore[arg-type]
        ollama_runtime_config_store=ollama_runtime_store,
    )
    service = ModelMigrationService(
        settings=settings,
        model_catalog_store=store,
        ollama_runtime_config_store=ollama_runtime_store,
        ollama_service_manager=ollama_manager,  # type: ignore[arg-type]
        task_store=TaskStore(settings.storage_dir),
    )

    payload = asyncio.run(service.migrate_local_models(str(target_root), confirm_running_tasks=True))
    current_runtime = asyncio.run(ollama_runtime_store.get())

    assert payload["requires_confirmation"] is False
    assert payload["ollama_restarted"] is True
    assert set(payload["moved"]) == {"embedding-default", "llm-default"}
    assert current_runtime["models_dir"] == str(target_root)
    assert (target_root / "manifests" / "registry.ollama.ai" / "library" / "bge-m3" / "latest").exists()
    assert (target_root / "manifests" / "registry.ollama.ai" / "library" / "qwen2.5" / "3b").exists()
    assert not source_root.exists()
