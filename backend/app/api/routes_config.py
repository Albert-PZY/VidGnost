from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from app.errors import AppError
from app.schemas import (
    LLMConfigResponse,
    LLMConfigUpdateRequest,
    ModelListResponse,
    ModelReloadRequest,
    ModelUpdateRequest,
    PromptTemplateBundleResponse,
    PromptTemplateCreateRequest,
    PromptTemplateSelectionUpdateRequest,
    PromptTemplateUpdateRequest,
    UISettingsResponse,
    UISettingsUpdateRequest,
    WhisperConfigResponse,
    WhisperConfigUpdateRequest,
)
from app.services.llm_config_store import LLMConfigStore
from app.services.model_catalog_store import ModelCatalogStore
from app.services.model_download_service import ModelDownloadService
from app.services.prompt_template_store import PromptTemplateStore
from app.services.resource_guard import ResourceGuard
from app.services.runtime_config_store import RuntimeConfigStore
from app.services.ui_settings_store import UISettingsStore

router = APIRouter(prefix="/config", tags=["config"])


def get_store(request: Request) -> LLMConfigStore:
    return request.app.state.llm_config_store


def get_runtime_store(request: Request) -> RuntimeConfigStore:
    return request.app.state.runtime_config_store


def get_prompt_store(request: Request) -> PromptTemplateStore:
    return request.app.state.prompt_template_store


def get_resource_guard(request: Request) -> ResourceGuard:
    return request.app.state.resource_guard


def get_model_catalog(request: Request) -> ModelCatalogStore:
    return request.app.state.model_catalog_store


def get_model_download_service(request: Request) -> ModelDownloadService:
    return request.app.state.model_download_service


def get_ui_settings_store(request: Request) -> UISettingsStore:
    return request.app.state.ui_settings_store


async def _build_model_list_response(
    catalog: ModelCatalogStore,
    download_service: ModelDownloadService,
) -> ModelListResponse:
    items = await catalog.list_models()
    snapshots = await download_service.list_snapshots()
    merged: list[dict[str, object]] = []
    for item in items:
        snapshot = snapshots.get(item["id"])
        merged_item = dict(item)
        if snapshot is not None:
            merged_item["download"] = dict(snapshot)
            if snapshot["state"] == "downloading":
                merged_item["status"] = "loading"
            elif snapshot["state"] == "failed" and merged_item.get("status") != "ready":
                merged_item["status"] = "error"
        merged.append(merged_item)
    return ModelListResponse(items=merged)


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
        local_model_id=payload["local_model_id"],
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
            "local_model_id": body.local_model_id,
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
        local_model_id=response_payload["local_model_id"],
        api_key=response_payload["api_key"],
        api_key_configured=response_payload["api_key_configured"],
        base_url=response_payload["base_url"],
        model=response_payload["model"],
        correction_mode=response_payload["correction_mode"],  # type: ignore[arg-type]
        correction_batch_size=response_payload["correction_batch_size"],
        correction_overlap=response_payload["correction_overlap"],
    )


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


@router.get("/prompts", response_model=PromptTemplateBundleResponse)
async def get_prompt_templates(prompt_store: PromptTemplateStore = Depends(get_prompt_store)) -> PromptTemplateBundleResponse:
    payload = await prompt_store.get_bundle()
    return PromptTemplateBundleResponse.model_validate(payload)


@router.put("/prompts/selection", response_model=PromptTemplateBundleResponse)
async def update_prompt_template_selection(
    body: PromptTemplateSelectionUpdateRequest,
    prompt_store: PromptTemplateStore = Depends(get_prompt_store),
) -> PromptTemplateBundleResponse:
    updates = {
        key: value
        for key, value in {
            "correction": body.correction,
            "notes": body.notes,
            "mindmap": body.mindmap,
            "vqa": body.vqa,
        }.items()
        if value
    }
    try:
        payload = await prompt_store.update_selection(updates)  # type: ignore[arg-type]
    except ValueError as exc:
        raise AppError.bad_request(str(exc), code="PROMPT_TEMPLATE_SELECTION_INVALID") from exc
    return PromptTemplateBundleResponse.model_validate(payload)


@router.post("/prompts/templates", response_model=PromptTemplateBundleResponse)
async def create_prompt_template(
    body: PromptTemplateCreateRequest,
    prompt_store: PromptTemplateStore = Depends(get_prompt_store),
) -> PromptTemplateBundleResponse:
    try:
        payload = await prompt_store.create_template(channel=body.channel, name=body.name, content=body.content)
    except ValueError as exc:
        raise AppError.bad_request(str(exc), code="PROMPT_TEMPLATE_CREATE_INVALID") from exc
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
        raise AppError.bad_request(str(exc), code="PROMPT_TEMPLATE_UPDATE_INVALID") from exc
    return PromptTemplateBundleResponse.model_validate(payload)


@router.delete("/prompts/templates/{template_id}", response_model=PromptTemplateBundleResponse)
async def delete_prompt_template(
    template_id: str,
    prompt_store: PromptTemplateStore = Depends(get_prompt_store),
) -> PromptTemplateBundleResponse:
    try:
        payload = await prompt_store.delete_template(template_id=template_id)
    except ValueError as exc:
        raise AppError.bad_request(str(exc), code="PROMPT_TEMPLATE_DELETE_INVALID") from exc
    return PromptTemplateBundleResponse.model_validate(payload)


@router.get("/models", response_model=ModelListResponse)
async def list_models(
    catalog: ModelCatalogStore = Depends(get_model_catalog),
    download_service: ModelDownloadService = Depends(get_model_download_service),
) -> ModelListResponse:
    return await _build_model_list_response(catalog, download_service)


@router.post("/models/reload", response_model=ModelListResponse)
async def reload_models(
    payload: ModelReloadRequest,
    catalog: ModelCatalogStore = Depends(get_model_catalog),
    download_service: ModelDownloadService = Depends(get_model_download_service),
) -> ModelListResponse:
    await catalog.reload_models(model_id=payload.model_id)
    return await _build_model_list_response(catalog, download_service)


@router.patch("/models/{model_id}", response_model=ModelListResponse)
async def update_model_config(
    model_id: str,
    payload: ModelUpdateRequest,
    catalog: ModelCatalogStore = Depends(get_model_catalog),
    download_service: ModelDownloadService = Depends(get_model_download_service),
) -> ModelListResponse:
    try:
        await catalog.update_model(
            model_id,
            {
                "path": payload.path,
                "status": payload.status,
                "load_profile": payload.load_profile,
                "quantization": payload.quantization,
                "max_batch_size": payload.max_batch_size,
                "enabled": payload.enabled,
            },
        )
    except ValueError as exc:
        raise AppError.bad_request(str(exc), code="MODEL_UPDATE_INVALID") from exc
    return await _build_model_list_response(catalog, download_service)


@router.post("/models/{model_id}/download", response_model=ModelListResponse)
async def start_model_download(
    model_id: str,
    catalog: ModelCatalogStore = Depends(get_model_catalog),
    download_service: ModelDownloadService = Depends(get_model_download_service),
) -> ModelListResponse:
    try:
        models = await catalog.list_models()
        target = next((item for item in models if item["id"] == model_id), None)
        if target is None:
            raise ValueError("Model not found")
        await download_service.start_download(
            model_id,
            force_redownload=False,
        )
    except ValueError as exc:
        raise AppError.bad_request(str(exc), code="MODEL_DOWNLOAD_INVALID") from exc
    return await _build_model_list_response(catalog, download_service)


@router.delete("/models/{model_id}/download", response_model=ModelListResponse)
async def cancel_model_download(
    model_id: str,
    catalog: ModelCatalogStore = Depends(get_model_catalog),
    download_service: ModelDownloadService = Depends(get_model_download_service),
) -> ModelListResponse:
    try:
        await download_service.cancel_download(model_id)
    except ValueError as exc:
        raise AppError.bad_request(str(exc), code="MODEL_DOWNLOAD_CANCEL_INVALID") from exc
    return await _build_model_list_response(catalog, download_service)


@router.get("/ui", response_model=UISettingsResponse)
async def get_ui_settings(store: UISettingsStore = Depends(get_ui_settings_store)) -> UISettingsResponse:
    return UISettingsResponse.model_validate(await store.get())


@router.put("/ui", response_model=UISettingsResponse)
async def update_ui_settings(
    payload: UISettingsUpdateRequest,
    store: UISettingsStore = Depends(get_ui_settings_store),
) -> UISettingsResponse:
    updates = {
        "language": payload.language,
        "font_size": payload.font_size,
        "auto_save": payload.auto_save,
        "theme_hue": payload.theme_hue,
        "background_image": payload.background_image,
        "background_image_opacity": payload.background_image_opacity,
    }
    return UISettingsResponse.model_validate(await store.update(updates))
