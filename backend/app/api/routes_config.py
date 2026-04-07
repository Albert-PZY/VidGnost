from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from app.errors import AppError
from app.schemas import (
    LLMConfigResponse,
    LLMConfigUpdateRequest,
    PromptTemplateBundleResponse,
    PromptTemplateCreateRequest,
    PromptTemplateSelectionUpdateRequest,
    PromptTemplateUpdateRequest,
    WhisperConfigResponse,
    WhisperConfigUpdateRequest,
)
from app.services.llm_config_store import LLMConfigStore
from app.services.prompt_template_store import PromptTemplateStore
from app.services.resource_guard import ResourceGuard
from app.services.runtime_config_store import RuntimeConfigStore
from app.services.task_runner import TaskRunner

router = APIRouter(prefix="/config", tags=["config"])


def get_store(request: Request) -> LLMConfigStore:
    return request.app.state.llm_config_store


def get_runtime_store(request: Request) -> RuntimeConfigStore:
    return request.app.state.runtime_config_store


def get_prompt_store(request: Request) -> PromptTemplateStore:
    return request.app.state.prompt_template_store


def get_resource_guard(request: Request) -> ResourceGuard:
    return request.app.state.resource_guard


def get_runner(request: Request) -> TaskRunner:
    return request.app.state.task_runner


@router.get("/llm", response_model=LLMConfigResponse)
async def get_llm_config(
    reveal_secrets: bool = Query(default=False),
    store: LLMConfigStore = Depends(get_store),
) -> LLMConfigResponse:
    _ = reveal_secrets
    payload = await store.get(mask_secrets=False)
    return LLMConfigResponse(
        mode=payload["mode"],  # type: ignore[arg-type]
        load_profile=payload["load_profile"],  # type: ignore[arg-type]
        api_key=payload["api_key"],
        api_key_configured=payload["api_key_configured"],
        base_url=payload["base_url"],
        model=payload["model"],
        correction_mode=payload["correction_mode"],  # type: ignore[arg-type]
        correction_batch_size=payload["correction_batch_size"],
        correction_overlap=payload["correction_overlap"],
    )


@router.put("/llm", response_model=LLMConfigResponse)
async def update_llm_config(
    body: LLMConfigUpdateRequest,
    store: LLMConfigStore = Depends(get_store),
    guard: ResourceGuard = Depends(get_resource_guard),
) -> LLMConfigResponse:
    await store.save(
        {
            "mode": body.mode,
            "load_profile": body.load_profile,
            "api_key": body.api_key,
            "base_url": body.base_url,
            "model": body.model,
            "correction_mode": body.correction_mode,
            "correction_batch_size": body.correction_batch_size,
            "correction_overlap": body.correction_overlap,
        }
    )
    saved = await store.get(mask_secrets=False)
    checked = guard.guard_llm_config(saved)
    llm_payload = checked["config"]
    if checked["rollback_applied"]:
        await store.save(llm_payload)  # type: ignore[arg-type]
        saved = await store.get(mask_secrets=False)
    else:
        saved = llm_payload  # type: ignore[assignment]
    response_payload = saved.copy()  # type: ignore[assignment]

    return LLMConfigResponse(
        mode=response_payload["mode"],  # type: ignore[arg-type]
        load_profile=response_payload["load_profile"],  # type: ignore[arg-type]
        api_key=response_payload["api_key"],
        api_key_configured=response_payload["api_key_configured"],
        base_url=response_payload["base_url"],
        model=response_payload["model"],
        correction_mode=response_payload["correction_mode"],  # type: ignore[arg-type]
        correction_batch_size=response_payload["correction_batch_size"],
        correction_overlap=response_payload["correction_overlap"],
    )


@router.get("/prompts", response_model=PromptTemplateBundleResponse)
async def get_prompt_templates(prompt_store: PromptTemplateStore = Depends(get_prompt_store)) -> PromptTemplateBundleResponse:
    payload = await prompt_store.get_bundle()
    return PromptTemplateBundleResponse.model_validate(payload)


@router.put("/prompts/selection", response_model=PromptTemplateBundleResponse)
async def update_prompt_template_selection(
    body: PromptTemplateSelectionUpdateRequest,
    prompt_store: PromptTemplateStore = Depends(get_prompt_store),
) -> PromptTemplateBundleResponse:
    try:
        payload = await prompt_store.update_selection(
            selected_summary_template_id=body.selected_summary_template_id,
            selected_notes_template_id=body.selected_notes_template_id,
            selected_mindmap_template_id=body.selected_mindmap_template_id,
        )
    except ValueError as exc:
        raise AppError.bad_request(
            str(exc),
            code="PROMPT_TEMPLATE_SELECTION_INVALID",
        ) from exc
    return PromptTemplateBundleResponse.model_validate(payload)


@router.post("/prompts/templates", response_model=PromptTemplateBundleResponse)
async def create_prompt_template(
    body: PromptTemplateCreateRequest,
    prompt_store: PromptTemplateStore = Depends(get_prompt_store),
) -> PromptTemplateBundleResponse:
    try:
        payload = await prompt_store.create_template(channel=body.channel, name=body.name, content=body.content)
    except ValueError as exc:
        raise AppError.bad_request(
            str(exc),
            code="PROMPT_TEMPLATE_CREATE_INVALID",
        ) from exc
    return PromptTemplateBundleResponse.model_validate(payload)


@router.patch("/prompts/templates/{template_id}", response_model=PromptTemplateBundleResponse)
async def update_prompt_template(
    template_id: str,
    body: PromptTemplateUpdateRequest,
    prompt_store: PromptTemplateStore = Depends(get_prompt_store),
) -> PromptTemplateBundleResponse:
    try:
        payload = await prompt_store.update_template(template_id=template_id, name=body.name, content=body.content)
    except ValueError as exc:
        raise AppError.bad_request(
            str(exc),
            code="PROMPT_TEMPLATE_UPDATE_INVALID",
        ) from exc
    return PromptTemplateBundleResponse.model_validate(payload)


@router.delete("/prompts/templates/{template_id}", response_model=PromptTemplateBundleResponse)
async def delete_prompt_template(
    template_id: str,
    prompt_store: PromptTemplateStore = Depends(get_prompt_store),
) -> PromptTemplateBundleResponse:
    try:
        payload = await prompt_store.delete_template(template_id=template_id)
    except ValueError as exc:
        raise AppError.bad_request(
            str(exc),
            code="PROMPT_TEMPLATE_DELETE_INVALID",
        ) from exc
    return PromptTemplateBundleResponse.model_validate(payload)


@router.get("/whisper", response_model=WhisperConfigResponse)
async def get_whisper_config(
    reveal_secrets: bool = Query(default=False),
    runtime_store: RuntimeConfigStore = Depends(get_runtime_store),
) -> WhisperConfigResponse:
    _ = reveal_secrets
    config = await runtime_store.get_whisper(mask_secrets=False)
    return WhisperConfigResponse(**config, warnings=[], rollback_applied=False)


@router.put("/whisper", response_model=WhisperConfigResponse)
async def update_whisper_config(
    body: WhisperConfigUpdateRequest,
    runtime_store: RuntimeConfigStore = Depends(get_runtime_store),
    guard: ResourceGuard = Depends(get_resource_guard),
) -> WhisperConfigResponse:
    saved_raw = await runtime_store.save_whisper(
        {
            "model_default": body.model_default,
            "language": body.language,
            "device": body.device,
            "compute_type": body.compute_type,
            "model_load_profile": body.model_load_profile,
            "beam_size": body.beam_size,
            "vad_filter": body.vad_filter,
            "chunk_seconds": body.chunk_seconds,
            "target_sample_rate": body.target_sample_rate,
            "target_channels": body.target_channels,
        }
    )
    checked = guard.guard_whisper_config(saved_raw)
    final_config = checked["config"]
    if checked["rollback_applied"]:
        await runtime_store.save_whisper(final_config)  # type: ignore[arg-type]
        final_config = await runtime_store.get_whisper(mask_secrets=False)
    return WhisperConfigResponse(
        **final_config,
        warnings=checked["warnings"],
        rollback_applied=checked["rollback_applied"],
    )
