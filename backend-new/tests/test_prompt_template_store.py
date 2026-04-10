from __future__ import annotations

from pathlib import Path

import orjson
import pytest

from app.config import Settings
from app.services.prompt_constants import SUMMARY_PROMPT
from app.services.prompt_template_store import PromptTemplateStore


def _build_settings(tmp_path: Path) -> Settings:
    return Settings(
        storage_dir=str(tmp_path / "storage"),
        temp_dir=str(tmp_path / "storage" / "tmp"),
        upload_dir=str(tmp_path / "storage" / "uploads"),
        output_dir=str(tmp_path / "storage" / "outputs"),
        llm_config_path=str(tmp_path / "storage" / "model_config.json"),
        runtime_config_path=str(tmp_path / "storage" / "config.toml"),
    )


@pytest.mark.asyncio
async def test_prompt_store_syncs_default_summary_template_content(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    store = PromptTemplateStore(settings)
    _ = await store.get_bundle()

    default_template_path = (
        Path(settings.storage_dir)
        / "prompts"
        / "templates"
        / "summary-default-main.json"
    )
    payload = orjson.loads(default_template_path.read_bytes())
    payload["content"] = "stale-template-content"
    default_template_path.write_bytes(orjson.dumps(payload))

    bundle = await store.get_bundle()
    selected_id = bundle["selected_summary_template_id"]
    selected = next(item for item in bundle["summary_templates"] if item["id"] == selected_id)
    assert selected["content"] == SUMMARY_PROMPT
