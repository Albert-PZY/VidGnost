from __future__ import annotations

from dataclasses import dataclass
import shutil
from pathlib import Path

from app.config import Settings
from app.models import TaskRecord
from app.services.model_catalog_store import ModelCatalogStore
from app.services.ollama_runtime_config_store import OllamaRuntimeConfigStore
from app.services.ollama_service_manager import OllamaServiceManager
from app.services.task_store import TaskStore

_TERMINAL_TASK_STATUSES = {"completed", "failed", "cancelled"}


@dataclass(slots=True)
class _LocalModelMigrationPlanItem:
    model_id: str
    source_path: Path
    target_path: Path


@dataclass(slots=True)
class _OllamaModelMigrationPlan:
    source_dir: Path
    target_dir: Path
    model_ids: list[str]


class ModelMigrationService:
    def __init__(
        self,
        settings: Settings,
        *,
        model_catalog_store: ModelCatalogStore,
        ollama_runtime_config_store: OllamaRuntimeConfigStore,
        ollama_service_manager: OllamaServiceManager | None = None,
        task_store: TaskStore | None = None,
    ) -> None:
        self._settings = settings
        self._model_catalog_store = model_catalog_store
        self._ollama_runtime_config_store = ollama_runtime_config_store
        self._ollama_service_manager = ollama_service_manager
        self._task_store = task_store

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

    async def migrate_local_models(
        self,
        target_root: str,
        *,
        confirm_running_tasks: bool = False,
    ) -> dict[str, object]:
        resolved_root = Path(target_root).expanduser().resolve()
        plan_items, ollama_plan, skipped = await self._plan_local_model_migration(resolved_root)
        planned_model_ids = [item.model_id for item in plan_items] + list(ollama_plan.model_ids)
        running_tasks = self._list_running_tasks()
        if planned_model_ids and running_tasks and not confirm_running_tasks:
            return {
                "target_root": str(resolved_root),
                "message": f"检测到 {len(running_tasks)} 个进行中的任务，确认后才会继续迁移全部本地模型。",
                "requires_confirmation": True,
                "planned_model_ids": planned_model_ids,
                "running_tasks": [self._serialize_task(item) for item in running_tasks],
                "moved": [],
                "skipped": skipped,
                "ollama_restarted": False,
                "warnings": [],
            }

        moved: list[str] = []
        warnings: list[str] = []
        if plan_items:
            resolved_root.mkdir(parents=True, exist_ok=True)
        for item in plan_items:
            item.target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(item.source_path), str(item.target_path))
            await self._model_catalog_store.update_model(item.model_id, {"path": str(item.target_path)})
            moved.append(item.model_id)

        if ollama_plan.model_ids:
            ollama_payload = await self._migrate_ollama_models_into_root(ollama_plan)
            if ollama_payload["warnings"]:
                warnings.extend(ollama_payload["warnings"])
            moved.extend(ollama_plan.model_ids)

        await self._model_catalog_store.sync_managed_local_model_paths()

        ollama_restarted = False
        ollama_warning = None
        if moved:
            ollama_restarted, ollama_warning = await self._restart_ollama_after_migration()
        if ollama_warning:
            warnings.append(ollama_warning)

        if not plan_items and not skipped:
            warnings.append("没有可迁移的本地模型。")
        if not moved and skipped:
            message = "没有可执行迁移的本地模型。"
        else:
            message = f"已迁移 {len(moved)} 个本地模型，并回写新的绝对路径配置。"
        return {
            "target_root": str(resolved_root),
            "message": message,
            "requires_confirmation": False,
            "planned_model_ids": planned_model_ids,
            "running_tasks": [self._serialize_task(item) for item in running_tasks],
            "moved": moved,
            "skipped": skipped,
            "ollama_restarted": ollama_restarted,
            "warnings": warnings,
        }

    async def _plan_local_model_migration(
        self,
        resolved_root: Path,
    ) -> tuple[list[_LocalModelMigrationPlanItem], _OllamaModelMigrationPlan, list[str]]:
        plan_items: list[_LocalModelMigrationPlanItem] = []
        skipped: list[str] = []
        models = await self._model_catalog_store.list_models()
        ollama_source_dir = Path((await self._ollama_runtime_config_store.get())["models_dir"]).expanduser().resolve()
        ollama_model_ids = [
            str(model.get("id", "")).strip()
            for model in models
            if str(model.get("provider", "")).strip().lower() == "ollama"
            and bool(model.get("is_installed", False))
        ]

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

            plan_items.append(
                _LocalModelMigrationPlanItem(
                    model_id=str(model["id"]),
                    source_path=source_path,
                    target_path=target_path,
                )
            )
        ollama_plan = _OllamaModelMigrationPlan(
            source_dir=ollama_source_dir,
            target_dir=resolved_root,
            model_ids=[],
        )
        if ollama_model_ids and not _same_path(ollama_source_dir, resolved_root):
            ollama_plan.model_ids = ollama_model_ids
        return plan_items, ollama_plan, skipped

    async def _migrate_ollama_models_into_root(self, plan: _OllamaModelMigrationPlan) -> dict[str, object]:
        source_dir = plan.source_dir
        resolved_target = plan.target_dir
        warnings: list[str] = []

        if _same_path(source_dir, resolved_target):
            await self._ollama_runtime_config_store.save({"models_dir": str(resolved_target)})
            return {
                "source_dir": str(source_dir),
                "target_dir": str(resolved_target),
                "moved": False,
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
                "warnings": warnings,
            }

        resolved_target.mkdir(parents=True, exist_ok=True)
        collisions = [resolved_target / child.name for child in source_dir.iterdir() if (resolved_target / child.name).exists()]
        if collisions:
            raise ValueError(f"目标目录已存在 Ollama 模型文件或目录：{collisions[0]}")

        for child in source_dir.iterdir():
            shutil.move(str(child), str(resolved_target / child.name))
        shutil.rmtree(source_dir, ignore_errors=True)
        await self._ollama_runtime_config_store.save({"models_dir": str(resolved_target)})
        return {
            "source_dir": str(source_dir),
            "target_dir": str(resolved_target),
            "moved": True,
            "warnings": warnings,
        }

    def _list_running_tasks(self) -> list[TaskRecord]:
        if self._task_store is None:
            return []
        items = [
            task
            for task in self._task_store.list_all()
            if str(task.status or "").strip().lower() not in _TERMINAL_TASK_STATUSES
        ]
        items.sort(key=lambda task: task.updated_at, reverse=True)
        return items

    async def _restart_ollama_after_migration(self) -> tuple[bool, str | None]:
        if self._ollama_service_manager is None:
            return (False, None)

        try:
            status = await self._ollama_service_manager.get_status()
        except Exception as exc:  # noqa: BLE001
            return (False, f"迁移完成后未能检查 Ollama 服务状态：{exc}")

        if not status["can_self_restart"]:
            return (
                False,
                "本地模型迁移已完成，但当前 Ollama 不是本机可自启实例，未自动重启服务。",
            )

        try:
            await self._ollama_service_manager.restart_service()
        except Exception as exc:  # noqa: BLE001
            return (False, f"本地模型迁移已完成，但自动重启 Ollama 服务失败：{exc}")
        return (True, None)

    @staticmethod
    def _serialize_task(task: TaskRecord) -> dict[str, object]:
        return {
            "id": task.id,
            "title": task.title,
            "status": str(task.status or "").strip(),
            "workflow": str(task.workflow or "").strip(),
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


def _same_path(left: Path, right: Path) -> bool:
    try:
        return left.expanduser().resolve() == right.expanduser().resolve()
    except OSError:
        return str(left).strip() == str(right).strip()
