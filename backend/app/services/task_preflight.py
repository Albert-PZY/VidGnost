from __future__ import annotations

import asyncio
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.config import Settings
from app.errors import AppError
from app.schemas import WorkflowType
from app.services.llm_connectivity import validate_openai_compat_model_config
from app.services.llm_config_store import LLMConfigStore
from app.services.model_catalog_store import ModelCatalogStore
from app.services.ollama_client import OllamaClient
from app.services.runtime_config_store import RuntimeConfigStore
from app.services.vqa_model_runtime import VQAModelRuntime
from app.services.whisper_gpu_runtime_service import WhisperGpuRuntimeService

PreflightStage = Literal["full_task", "stage_d_retry"]

_GIB = 1024 * 1024 * 1024
_MIB = 1024 * 1024
_MIN_PRECHECK_FREE_BYTES = 3 * _GIB


@dataclass(slots=True)
class TaskPreflightService:
    settings: Settings
    llm_config_store: LLMConfigStore
    runtime_config_store: RuntimeConfigStore
    model_catalog_store: ModelCatalogStore
    whisper_gpu_runtime_service: WhisperGpuRuntimeService
    ollama_client: OllamaClient | None = None

    def __post_init__(self) -> None:
        if self.ollama_client is None:
            self.ollama_client = OllamaClient(self.settings)

    async def assert_ready_for_analysis(
        self,
        *,
        workflow: WorkflowType,
        stage: PreflightStage = "full_task",
    ) -> None:
        llm_config, whisper_config, models = await asyncio.gather(
            self.llm_config_store.get(),
            self.runtime_config_store.get_whisper(),
            self.model_catalog_store.list_models(),
        )
        vqa_model_runtime = VQAModelRuntime(
            model_catalog_store=self.model_catalog_store,
            ollama_client=self.ollama_client,
        )

        self._assert_storage_capacity()
        self._assert_llm_runtime(llm_config)
        self._assert_llm_connectivity(llm_config)
        if stage == "full_task":
            self._assert_ffmpeg_available()
            self._assert_whisper_runtime(whisper_config)
            whisper_gpu_status = await self.whisper_gpu_runtime_service.get_status()
            self.whisper_gpu_runtime_service.assert_runtime_ready_for_device(
                str(whisper_config.get("device", "cpu")),
                whisper_gpu_status,
            )
        self._assert_required_models_ready(workflow=workflow, stage=stage, models=models)
        if workflow == "vqa":
            await self._assert_vqa_runtime_ready(vqa_model_runtime)

    def _assert_storage_capacity(self) -> None:
        storage_dir = Path(self.settings.storage_dir)
        storage_dir.mkdir(parents=True, exist_ok=True)
        free_bytes = int(shutil.disk_usage(storage_dir).free)
        if free_bytes >= _MIN_PRECHECK_FREE_BYTES:
            return

        raise AppError.conflict(
            "运行前检查失败：磁盘可用空间不足，当前不适合启动分析任务。",
            code="TASK_PRECHECK_STORAGE_LOW",
            hint=(
                f"请至少保留 {_format_bytes(_MIN_PRECHECK_FREE_BYTES)} 可用空间，"
                f"当前仅剩 {_format_bytes(free_bytes)}。"
            ),
        )

    @staticmethod
    def _assert_ffmpeg_available() -> None:
        if shutil.which("ffmpeg"):
            return
        raise AppError.conflict(
            "运行前检查失败：FFmpeg 不可用。",
            code="TASK_PRECHECK_FFMPEG_UNAVAILABLE",
            hint="请先安装 FFmpeg 并加入 PATH，然后重新提交分析任务。",
        )

    @staticmethod
    def _assert_whisper_runtime(whisper_config: dict[str, object]) -> None:
        model_default = str(whisper_config.get("model_default", "")).strip().lower()
        if model_default in {"small", "medium"}:
            return
        raise AppError.conflict(
            "运行前检查失败：Whisper 运行配置异常。",
            code="TASK_PRECHECK_WHISPER_CONFIG_INVALID",
            hint="请在设置中心检查 Whisper 默认模型配置后重试。",
        )

    def _assert_llm_runtime(self, llm_config: dict[str, object]) -> None:
        llm_api_key = str(llm_config.get("api_key", "")).strip()
        if not llm_api_key:
            raise AppError.conflict(
                "运行前检查失败：LLM API Key 未配置。",
                code="TASK_PRECHECK_LLM_API_KEY_MISSING",
                hint="请先在设置中心补充 LLM API Key，再启动分析任务。",
            )

        llm_base_url = str(llm_config.get("base_url", self.settings.llm_base_url)).strip()
        if llm_base_url:
            return
        raise AppError.conflict(
            "运行前检查失败：LLM Base URL 未配置。",
            code="TASK_PRECHECK_LLM_BASE_URL_MISSING",
            hint="请先在设置中心补充 LLM 服务地址，再启动分析任务。",
        )

    def _assert_llm_connectivity(self, llm_config: dict[str, object]) -> None:
        llm_api_key = str(llm_config.get("api_key", "")).strip()
        llm_base_url = str(llm_config.get("base_url", self.settings.llm_base_url)).strip() or self.settings.llm_base_url
        llm_model = str(llm_config.get("model", self.settings.llm_model)).strip() or self.settings.llm_model
        validation = validate_openai_compat_model_config(
            base_url=llm_base_url,
            api_key=llm_api_key,
            model=llm_model,
            timeout_seconds=6.0,
        )
        if validation.ok:
            return
        if validation.connectivity_ok and not validation.model_ok:
            raise AppError.conflict(
                "运行前检查失败：LLM 模型配置无效。",
                code="TASK_PRECHECK_LLM_MODEL_INVALID",
                hint=(
                    "请检查设置中心中的模型名是否真实存在于远端服务返回的模型列表中。"
                    f" 详细原因：{validation.model_reason}"
                ),
            )
        raise AppError.conflict(
            "运行前检查失败：LLM 服务连通性校验未通过。",
            code="TASK_PRECHECK_LLM_UNREACHABLE",
            hint=f"请检查模型服务地址、网络连接或鉴权配置。详细原因：{validation.connectivity_reason}",
        )

    def _assert_required_models_ready(
        self,
        *,
        workflow: WorkflowType,
        stage: PreflightStage,
        models: list[dict[str, object]],
    ) -> None:
        models_by_id = {str(item.get("id", "")).strip(): item for item in models}
        required_model_ids = list(_required_model_ids(stage))
        if workflow == "vqa" and stage != "stage_d_retry":
            required_model_ids.extend(["embedding-default", "vlm-default", "rerank-default"])
        for model_id in required_model_ids:
            model = models_by_id.get(model_id)
            if model is None:
                raise AppError.conflict(
                    f"运行前检查失败：缺少模型配置 {model_id}。",
                    code="TASK_PRECHECK_MODEL_MISSING",
                    hint="请在设置中心刷新模型状态并检查默认模型配置。",
                )

            model_name = str(model.get("name", model_id)).strip() or model_id
            if not bool(model.get("enabled", True)):
                raise AppError.conflict(
                    f"运行前检查失败：模型“{model_name}”当前已停用。",
                    code="TASK_PRECHECK_MODEL_DISABLED",
                    hint="请在设置中心重新启用所需模型后再启动分析任务。",
                )

            provider = str(model.get("provider", "")).strip().lower()
            if provider == "openai_compatible":
                continue

            status = str(model.get("status", "")).strip().lower()
            is_installed = bool(model.get("is_installed", False))
            if status == "ready" and is_installed:
                continue

            resolved_path = str(model.get("path", "")).strip() or str(model.get("default_path", "")).strip()
            hint = "请先在设置中心下载或修复该模型后重试。"
            if resolved_path:
                hint = f"{hint} 当前模型目录：{resolved_path}"
            raise AppError.conflict(
                f"运行前检查失败：模型“{model_name}”尚未就绪。",
                code="TASK_PRECHECK_MODEL_NOT_READY",
                hint=hint,
            )

    async def _assert_vqa_runtime_ready(self, vqa_model_runtime: VQAModelRuntime) -> None:
        probes = [
            ("embedding", vqa_model_runtime.probe_embedding),
            ("vlm", vqa_model_runtime.probe_vlm),
            ("rerank", vqa_model_runtime.probe_rerank),
        ]
        for component, probe in probes:
            try:
                result = await probe()
            except Exception as exc:  # noqa: BLE001
                raise AppError.conflict(
                    f"运行前检查失败：{component} 模型最小推理校验未通过。",
                    code="TASK_PRECHECK_MODEL_RUNTIME_INVALID",
                    hint=f"请检查 Ollama 服务和对应模型拉取状态。详细原因：{exc}",
                ) from exc
            if result.ready:
                continue
            raise AppError.conflict(
                f"运行前检查失败：{component} 模型最小推理校验未通过。",
                code="TASK_PRECHECK_MODEL_RUNTIME_INVALID",
                hint=f"请检查 Ollama 服务和对应模型拉取状态。详细原因：{result.message}",
            )


def _required_model_ids(stage: PreflightStage) -> tuple[str, ...]:
    if stage == "stage_d_retry":
        return ("llm-default",)
    return ("whisper-default", "llm-default")


def _format_bytes(value: int) -> str:
    if value >= _GIB:
        return f"{value / _GIB:.1f} GiB"
    return f"{value / _MIB:.0f} MiB"
