from __future__ import annotations

from app.services.llm_config_store import LLMConfig, LLMConfigStore
from app.services.model_catalog_store import ModelCatalogStore


async def sync_llm_runtime_config_from_catalog(
    *,
    llm_config_store: LLMConfigStore,
    model_catalog_store: ModelCatalogStore,
    ollama_base_url: str,
) -> LLMConfig:
    current = await llm_config_store.get(mask_secrets=False)
    model = await model_catalog_store.get_model("llm-default")
    if model is None:
        return current
    payload = build_llm_runtime_payload(
        current=current,
        model=model,
        ollama_base_url=ollama_base_url,
    )
    return await llm_config_store.save(payload)


def build_llm_runtime_payload(
    *,
    current: LLMConfig,
    model: dict[str, object],
    ollama_base_url: str,
) -> LLMConfig:
    provider = str(model.get("provider", "")).strip().lower()
    model_id = str(model.get("model_id", "")).strip()
    api_model = str(model.get("api_model", "")).strip() or model_id
    api_key = str(model.get("api_key", "")).strip()
    base_url = str(current.get("base_url", "")).strip()
    runtime_model = str(current.get("model", "")).strip()

    if provider == "openai_compatible":
        base_url = str(model.get("api_base_url", "")).strip() or base_url
        runtime_model = api_model or runtime_model
    elif provider == "ollama":
        normalized_ollama_base = str(ollama_base_url or "").strip().rstrip("/")
        if normalized_ollama_base:
            base_url = f"{normalized_ollama_base}/v1"
        runtime_model = model_id or runtime_model
        api_key = "ollama"

    return {
        "mode": "api",
        "load_profile": str(model.get("load_profile", current["load_profile"])).strip() or current["load_profile"],
        "local_model_id": model_id or current["local_model_id"],
        "api_key": api_key,
        "api_key_configured": bool(api_key),
        "base_url": base_url,
        "model": runtime_model,
        "correction_mode": str(current.get("correction_mode", "strict")).strip() or "strict",
        "correction_batch_size": int(current.get("correction_batch_size", 24) or 24),
        "correction_overlap": int(current.get("correction_overlap", 3) or 3),
    }
