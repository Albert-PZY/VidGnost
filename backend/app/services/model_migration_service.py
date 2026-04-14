from __future__ import annotations

import shutil
from pathlib import Path

from app.config import Settings
from app.services.model_catalog_store import ModelCatalogStore
from app.services.ollama_runtime_config_store import OllamaRuntimeConfigStore


class ModelMigrationService:
    def __init__(
        self,
        settings: Settings,
        *,
        model_catalog_store: ModelCatalogStore,
        ollama_runtime_config_store: OllamaRuntimeConfigStore,
    ) -> None:
        self._settings = settings
        self._model_catalog_store = model_catalog_store
        self._ollama_runtime_config_store = ollama_runtime_config_store

    async def migrate_ollama_models(self, target_dir: str) -> dict[str, object]:
        current = await self._ollama_runtime_config_store.get()
        source_dir = Path(current["models_dir"]).expanduser().resolve()
        resolved_target = Path(target_dir).expanduser().resolve()
        warnings: list[str] = []

        if source_dir == resolved_target:
            await self._ollama_runtime_config_store.save({"models_dir": str(resolved_target)})
            return {
                "source_dir": str(source_dir),
                "target_dir": str(resolved_target),
                "moved": False,
                "message": "Ollama 模型目录已经指向目标位置。",
                "warnings": warnings,
            }

        self._assert_safe_move(source_dir, resolved_target)
        if not source_dir.exists():
            await self._ollama_runtime_config_store.save({"models_dir": str(resolved_target)})
            warnings.append("原始 Ollama 模型目录不存在，仅更新了配置路径。")
            return {
                "source_dir": str(source_dir),
                "target_dir": str(resolved_target),
                "moved": False,
                "message": "未检测到现有 Ollama 模型目录，已保存新的目标目录。",
                "warnings": warnings,
            }

        resolved_target.parent.mkdir(parents=True, exist_ok=True)
        if resolved_target.exists() and any(resolved_target.iterdir()):
            raise ValueError(f"目标 Ollama 模型目录非空：{resolved_target}")

        if resolved_target.exists():
            for child in source_dir.iterdir():
                shutil.move(str(child), str(resolved_target / child.name))
            shutil.rmtree(source_dir, ignore_errors=True)
        else:
            shutil.move(str(source_dir), str(resolved_target))

        await self._ollama_runtime_config_store.save({"models_dir": str(resolved_target)})
        return {
            "source_dir": str(source_dir),
            "target_dir": str(resolved_target),
            "moved": True,
            "message": "Ollama 模型目录已迁移并更新配置。",
            "warnings": warnings,
        }

    async def migrate_local_models(self, target_root: str) -> dict[str, object]:
        resolved_root = Path(target_root).expanduser().resolve()
        resolved_root.mkdir(parents=True, exist_ok=True)
        moved: list[str] = []
        skipped: list[str] = []
        warnings: list[str] = []

        models = await self._model_catalog_store.list_models()
        for model in models:
            provider = str(model.get("provider", "")).strip().lower()
            if provider != "local":
                continue
            source = str(model.get("path", "")).strip() or str(model.get("default_path", "")).strip()
            if not source:
                skipped.append(f"{model['id']}: 未配置本地路径")
                continue
            source_path = Path(source).expanduser().resolve()
            if not source_path.exists():
                skipped.append(f"{model['id']}: 源路径不存在")
                continue
            if self._is_relative_to(source_path, resolved_root):
                skipped.append(f"{model['id']}: 已位于目标根目录内")
                continue

            target_path = resolved_root / str(model.get("component", "model")).strip() / _safe_name(model["id"])
            if source_path.is_file():
                target_path = target_path.with_suffix(source_path.suffix)
            self._assert_safe_move(source_path, target_path)
            if target_path.exists():
                skipped.append(f"{model['id']}: 目标路径已存在")
                continue

            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source_path), str(target_path))
            await self._model_catalog_store.update_model(model["id"], {"path": str(target_path)})
            moved.append(model["id"])

        if not moved and not skipped:
            warnings.append("没有可迁移的本地模型。")
        return {
            "target_root": str(resolved_root),
            "moved": moved,
            "skipped": skipped,
            "warnings": warnings,
        }

    @staticmethod
    def _assert_safe_move(source: Path, target: Path) -> None:
        resolved_source = source.expanduser().resolve()
        resolved_target = target.expanduser().resolve()
        if resolved_source == resolved_target:
            return
        if ModelMigrationService._is_relative_to(resolved_target, resolved_source):
            raise ValueError(f"目标路径不能位于源路径内部：{resolved_target}")
        if ModelMigrationService._is_relative_to(resolved_source, resolved_target):
            raise ValueError(f"源路径不能位于目标路径内部：{resolved_source}")

    @staticmethod
    def _is_relative_to(path: Path, parent: Path) -> bool:
        try:
            path.relative_to(parent)
            return True
        except ValueError:
            return False


def _safe_name(value: str) -> str:
    normalized = "".join(char if char.isalnum() or char in {"-", "_", "."} else "-" for char in str(value).strip())
    return normalized.strip("-") or "model"
