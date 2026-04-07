from pathlib import Path

import orjson
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


def test_get_and_update_whisper_config_api_only() -> None:
    with TestClient(app) as client:
        response = client.get("/api/config/whisper")
        assert response.status_code == 200
        current = response.json()
        assert "model_default" in current
        assert "chunk_seconds" in current
        assert "frame_extraction_enabled" not in current
        assert "vlm_enabled" not in current
        assert "vlm_api_key_configured" not in current
        assert current["model_default"] == "small"

        payload = {
            **current,
            "chunk_seconds": 300,
            "beam_size": 4,
            "vad_filter": False,
        }
        update_response = client.put("/api/config/whisper", json=payload)
        assert update_response.status_code == 200
        saved = update_response.json()
        assert saved["chunk_seconds"] == 300
        assert saved["beam_size"] == 4
        assert saved["vad_filter"] is False
        assert saved["device"] == "cuda"


def test_get_and_update_llm_config_persists_file() -> None:
    settings = get_settings()
    llm_path = Path(settings.llm_config_path)

    with TestClient(app) as client:
        response = client.get("/api/config/llm")
        assert response.status_code == 200
        current = response.json()
        assert current["mode"] == "api"
        assert current["correction_mode"] in {"off", "strict", "rewrite"}
        assert isinstance(current["correction_batch_size"], int)
        assert isinstance(current["correction_overlap"], int)
        assert "api_key_configured" in current

        payload = {
            "mode": "api",
            "local_model_id": "Qwen/Qwen2.5-7B-Instruct",
            "api_key": "  test-key  ",
            "base_url": " https://example.com/v1 ",
            "model": " test-model ",
            "correction_mode": "rewrite",
            "correction_batch_size": 18,
            "correction_overlap": 2,
        }
        update_response = client.put("/api/config/llm", json=payload)
        assert update_response.status_code == 200
        saved = update_response.json()
        assert saved["mode"] == "api"
        assert saved["api_key"] == "test-key"
        assert saved["api_key_configured"] is True
        assert saved["base_url"] == "https://example.com/v1"
        assert saved["model"] == "test-model"
        assert saved["correction_mode"] == "rewrite"
        assert saved["correction_batch_size"] == 18
        assert saved["correction_overlap"] == 2

        assert llm_path.exists()
        disk = orjson.loads(llm_path.read_bytes())
        assert disk["mode"] == "api"
        assert disk["base_url"] == "https://example.com/v1"
        assert disk["model"] == "test-model"


def test_prompt_templates_endpoints_work() -> None:
    with TestClient(app) as client:
        bundle_response = client.get("/api/config/prompts")
        assert bundle_response.status_code == 200
        bundle = bundle_response.json()
        assert "summary_templates" in bundle
        assert "mindmap_templates" in bundle
