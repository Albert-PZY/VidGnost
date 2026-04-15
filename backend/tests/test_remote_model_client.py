from __future__ import annotations

from app.services.remote_model_client import (
    _normalize_openai_chat_messages,
    infer_remote_api_protocol,
)


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


def test_normalize_openai_chat_messages_flattens_siliconflow_multimodal_messages() -> None:
    config = {
        "api_base_url": "https://api.siliconflow.cn/v1",
    }
    messages = [
        {"role": "system", "content": "你是图像理解助手，请先遵守 OCR 优先规则。"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请读取图片中的文字，并补充概括主要画面。"},
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,abc"}},
            ],
        },
    ]

    normalized = _normalize_openai_chat_messages(config=config, messages=messages)

    assert len(normalized) == 1
    assert normalized[0]["role"] == "user"
    assert isinstance(normalized[0]["content"], list)
    assert normalized[0]["content"][0]["type"] == "text"
    assert "系统要求：" in normalized[0]["content"][0]["text"]
    assert normalized[0]["content"][2]["type"] == "image_url"


def test_normalize_openai_chat_messages_keeps_non_siliconflow_messages_unchanged() -> None:
    config = {
        "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }
    messages = [
        {"role": "system", "content": "你是图像理解助手。"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请描述图片。"},
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,abc"}},
            ],
        },
    ]

    normalized = _normalize_openai_chat_messages(config=config, messages=messages)

    assert normalized == messages
