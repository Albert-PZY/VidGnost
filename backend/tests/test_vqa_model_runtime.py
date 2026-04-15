from __future__ import annotations

import asyncio
import base64
import struct
from pathlib import Path

from app.config import Settings
from app.services.model_catalog_store import ModelCatalogStore
from app.services.vqa_model_runtime import VQAModelRuntime


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


class DummyOllamaClient:
    base_url = "http://127.0.0.1:11434"


class CapturingRemoteModelClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def chat_text(
        self,
        *,
        config: dict[str, object],
        messages: list[dict[str, object]],
        temperature: float = 0.2,
    ) -> str:
        self.calls.append(
            {
                "config": config,
                "messages": messages,
                "temperature": temperature,
            }
        )
        return "VidGnost OCR Probe 2026-04-15"


def test_probe_vlm_uses_text_bearing_probe_image_for_remote_models(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    store = ModelCatalogStore(settings)
    asyncio.run(
        store.update_model(
            "vlm-default",
            {
                "provider": "openai_compatible",
                "enabled": True,
                "is_installed": True,
                "api_base_url": "https://api.siliconflow.cn/v1",
                "api_key": "sk-test",
                "api_key_configured": True,
                "api_model": "PaddlePaddle/PaddleOCR-VL-1.5",
            },
        )
    )
    remote_client = CapturingRemoteModelClient()
    runtime = VQAModelRuntime(
        model_catalog_store=store,
        ollama_client=DummyOllamaClient(),  # type: ignore[arg-type]
        remote_model_client=remote_client,  # type: ignore[arg-type]
        storage_dir=settings.storage_dir,
    )

    result = asyncio.run(runtime.probe_vlm())

    assert result.ready is True
    assert len(remote_client.calls) == 1
    messages = remote_client.calls[0]["messages"]
    assert isinstance(messages, list)
    image_url = messages[1]["content"][1]["image_url"]["url"]  # type: ignore[index]
    assert isinstance(image_url, str)
    assert image_url.startswith("data:image/png;base64,")

    raw = base64.b64decode(image_url.split(",", 1)[1])
    assert raw.startswith(b"\x89PNG\r\n\x1a\n")
    width, height = struct.unpack(">II", raw[16:24])
    assert width >= 320
    assert height >= 160
