from __future__ import annotations

from app.services.remote_model_client import infer_remote_api_protocol


def test_infer_remote_api_protocol_uses_dashscope_native_route_for_embedding_and_rerank() -> None:
    embedding_config = {
        "component": "embedding",
        "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }
    rerank_config = {
        "component": "rerank",
        "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }

    assert infer_remote_api_protocol(embedding_config) == "aliyun_bailian"
    assert infer_remote_api_protocol(rerank_config) == "aliyun_bailian"


def test_infer_remote_api_protocol_keeps_chat_models_on_openai_compatible() -> None:
    llm_config = {
        "component": "llm",
        "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }
    vlm_config = {
        "component": "vlm",
        "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }
    mllm_config = {
        "component": "mllm",
        "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }

    assert infer_remote_api_protocol(llm_config) == "openai_compatible"
    assert infer_remote_api_protocol(vlm_config) == "openai_compatible"
    assert infer_remote_api_protocol(mllm_config) == "openai_compatible"
