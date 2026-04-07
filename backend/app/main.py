from __future__ import annotations

import asyncio
import io
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.error_handlers import install_error_handlers
from app.api.routes_config import router as config_router
from app.api.routes_health import router as health_router
from app.api.routes_self_check import router as self_check_router
from app.api.routes_tasks import router as tasks_router
from app.config import get_settings
from app.services.events import EventBus
from app.services.llm_config_store import LLMConfigStore
from app.services.model_runtime_manager import ModelRuntimeManager
from app.services.prompt_template_store import PromptTemplateStore
from app.services.resource_guard import ResourceGuard
from app.services.runtime_config_store import RuntimeConfigStore
from app.services.self_check import SelfCheckService
from app.services.startup_cleanup import cleanup_temp_dir_once
from app.services.task_runner import TaskRunner
from app.services.task_store import TaskStore

logger = logging.getLogger(__name__)


def _enable_windows_utf8_stdio() -> None:
    if sys.platform != "win32":
        return
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "buffer"):
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


_enable_windows_utf8_stdio()

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    task_store = TaskStore(settings.storage_dir)
    cleanup_report = await asyncio.to_thread(cleanup_temp_dir_once, settings.temp_dir)
    if cleanup_report.removed_count > 0:
        logger.info(
            "Startup temp cleanup removed %s/%s entries from %s",
            cleanup_report.removed_count,
            cleanup_report.scanned_count,
            settings.temp_dir,
        )
    if cleanup_report.failed_entries:
        logger.warning(
            "Startup temp cleanup failed for %s entries: %s",
            len(cleanup_report.failed_entries),
            "; ".join(cleanup_report.failed_entries),
        )
    event_bus = EventBus(event_log_dir=str(Path(settings.storage_dir) / "event-logs"))
    llm_config_store = LLMConfigStore(settings)
    await llm_config_store.get()
    prompt_template_store = PromptTemplateStore(settings=settings)
    await prompt_template_store.get_bundle()
    runtime_config_store = RuntimeConfigStore(settings)
    resource_guard = ResourceGuard(settings=settings)
    model_runtime_manager = ModelRuntimeManager(
        max_cached_models_by_component={
            "asr": settings.max_cached_whisper_models,
            "llm": settings.max_cached_llm_models,
        }
    )
    startup_warning = resource_guard.startup_warning()
    if startup_warning:
        logger.warning(startup_warning)
    self_check_service = SelfCheckService(settings=settings, event_bus=event_bus)
    runner = TaskRunner(
        settings=settings,
        event_bus=event_bus,
        llm_config_store=llm_config_store,
        prompt_template_store=prompt_template_store,
        runtime_config_store=runtime_config_store,
        resource_guard=resource_guard,
        model_runtime_manager=model_runtime_manager,
        task_store=task_store,
    )

    app.state.settings = settings
    app.state.task_store = task_store
    app.state.event_bus = event_bus
    app.state.llm_config_store = llm_config_store
    app.state.prompt_template_store = prompt_template_store
    app.state.runtime_config_store = runtime_config_store
    app.state.resource_guard = resource_guard
    app.state.model_runtime_manager = model_runtime_manager
    app.state.self_check_service = self_check_service
    app.state.task_runner = runner
    yield
    await runner.shutdown()
    await event_bus.close()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

install_error_handlers(app)

app.include_router(health_router, prefix=settings.api_prefix)
app.include_router(tasks_router, prefix=settings.api_prefix)
app.include_router(config_router, prefix=settings.api_prefix)
app.include_router(self_check_router, prefix=settings.api_prefix)
