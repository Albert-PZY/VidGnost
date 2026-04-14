from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any

import orjson

from app.services.model_catalog_store import ModelCatalogStore
from app.services.ollama_client import OllamaClient

_JSON_FENCE_PATTERN = re.compile(r"```(?:json)?\s*(?P<body>[\s\S]*?)```", re.IGNORECASE)
_THINK_BLOCK_PATTERN = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
_INLINE_THINK_PATTERN = re.compile(r"<think>[\s\S]*", re.IGNORECASE)
_PROBE_IMAGE_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s0X8dUAAAAASUVORK5CYII="
)


@dataclass(frozen=True, slots=True)
class ModelProbeResult:
    ready: bool
    message: str
    details: dict[str, str]


class VQAModelRuntime:
    def __init__(
        self,
        *,
        model_catalog_store: ModelCatalogStore,
        ollama_client: OllamaClient,
    ) -> None:
        self._model_catalog_store = model_catalog_store
        self._ollama_client = ollama_client

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        normalized_inputs = [str(item).strip() for item in texts if str(item).strip()]
        if not normalized_inputs:
            return []
        model = await self._resolve_model("embedding-default")
        batch_size = max(1, int(model.get("max_batch_size", 8) or 8))
        outputs: list[list[float]] = []
        for start in range(0, len(normalized_inputs), batch_size):
            batch = normalized_inputs[start : start + batch_size]
            embeddings = await self._ollama_client.embed(model=str(model["model_id"]).strip(), inputs=batch)
            outputs.extend(_normalize_embedding(vector) for vector in embeddings)
        if len(outputs) != len(normalized_inputs):
            raise RuntimeError("Ollama embedding result count mismatch")
        return outputs

    async def score_rerank_pairs(self, *, query: str, documents: list[str]) -> list[float]:
        normalized_query = str(query).strip()
        normalized_docs = [str(item).strip() for item in documents if str(item).strip()]
        if not normalized_query or not normalized_docs:
            return []
        model = await self._resolve_model("rerank-default")
        primary_model_id = str(model["model_id"]).strip()
        batch_size = max(1, int(model.get("max_batch_size", 8) or 8))
        scores: list[float] = []
        for start in range(0, len(normalized_docs), batch_size):
            batch = normalized_docs[start : start + batch_size]
            try:
                batch_scores = await self._score_rerank_batch(
                    model_id=primary_model_id,
                    query=normalized_query,
                    documents=batch,
                )
            except RuntimeError:
                batch_scores = []
            if len(batch_scores) != len(batch) or _looks_uninformative_scores(batch_scores):
                batch_scores = await self._score_by_embedding_similarity(
                    query=normalized_query,
                    documents=batch,
                )
            scores.extend(batch_scores)
        return scores

    async def warm_rerank(self, *, query: str, documents: list[str]) -> bool:
        normalized_query = str(query).strip()
        normalized_docs = [str(item).strip() for item in documents if str(item).strip()]
        if not normalized_query or not normalized_docs:
            return False
        model = await self._resolve_model("rerank-default")
        batch_size = max(1, int(model.get("max_batch_size", 8) or 8))
        sample_docs = normalized_docs[: max(1, min(len(normalized_docs), batch_size))]
        try:
            scores = await self._score_rerank_batch(
                model_id=str(model["model_id"]).strip(),
                query=normalized_query,
                documents=sample_docs,
            )
        except RuntimeError:
            return False
        return len(scores) == len(sample_docs) and not _looks_uninformative_scores(scores)

    async def describe_images(self, image_paths: list[str]) -> list[str]:
        normalized_paths = [str(item).strip() for item in image_paths if str(item).strip()]
        if not normalized_paths:
            return []
        model = await self._resolve_model("vlm-default")
        descriptions: list[str] = []
        for image_path in normalized_paths:
            encoded = await self._ollama_client.image_to_base64(image_path)
            content = await self._ollama_client.chat(
                model=str(model["model_id"]).strip(),
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是视频关键帧理解助手。请用简洁中文描述画面中的主体、场景、动作、字幕和重要物体。"
                            "不要编造，不要输出项目符号。"
                        ),
                    },
                    {
                        "role": "user",
                        "content": "请概括这张视频帧画面的关键信息，控制在一到两句话内。",
                        "images": [encoded],
                    },
                ],
                options={"temperature": 0.1},
                keep_alive="5m",
            )
            descriptions.append(_normalize_chat_text(content))
        return descriptions

    async def probe_embedding(self) -> ModelProbeResult:
        model = await self._resolve_model("embedding-default")
        vectors = await self.embed_texts(["VidGnost embedding probe"])
        ready = bool(vectors and vectors[0])
        return ModelProbeResult(
            ready=ready,
            message="Embedding 模型已通过 Ollama 最小推理校验" if ready else "Embedding 模型探测失败",
            details={
                "provider": str(model.get("provider", "")).strip(),
                "model": str(model.get("model_id", "")).strip(),
                "endpoint": self._ollama_client.base_url,
            },
        )

    async def probe_rerank(self) -> ModelProbeResult:
        model = await self._resolve_model("rerank-default")
        scores = await self.score_rerank_pairs(
            query="什么是检索增强生成",
            documents=[
                "RAG 会先检索证据，再基于证据生成回答。",
                "今天的天气很好，适合出去散步。",
            ],
        )
        ready = len(scores) == 2 and scores[0] != scores[1]
        return ModelProbeResult(
            ready=ready,
            message="Rerank 模型已通过 Ollama 最小推理校验" if ready else "Rerank 模型探测失败",
            details={
                "provider": str(model.get("provider", "")).strip(),
                "model": str(model.get("model_id", "")).strip(),
                "endpoint": self._ollama_client.base_url,
            },
        )

    async def probe_vlm(self) -> ModelProbeResult:
        model = await self._resolve_model("vlm-default")
        response = await self._ollama_client.chat(
            model=str(model["model_id"]).strip(),
            messages=[
                {
                    "role": "system",
                    "content": "你是图像理解助手，请简洁描述图像。",
                },
                {
                    "role": "user",
                    "content": "请用一句中文描述这张图片。",
                    "images": [_PROBE_IMAGE_BASE64],
                },
            ],
            options={"temperature": 0},
            keep_alive="5m",
        )
        text = _normalize_chat_text(response)
        ready = bool(text)
        return ModelProbeResult(
            ready=ready,
            message="VLM 模型已通过 Ollama 最小推理校验" if ready else "VLM 模型探测失败",
            details={
                "provider": str(model.get("provider", "")).strip(),
                "model": str(model.get("model_id", "")).strip(),
                "endpoint": self._ollama_client.base_url,
            },
        )

    async def _resolve_model(self, model_id: str) -> dict[str, object]:
        models = await self._model_catalog_store.list_models()
        model = next((item for item in models if str(item.get("id", "")).strip() == model_id), None)
        if model is None:
            raise RuntimeError(f"Missing model configuration: {model_id}")
        if not bool(model.get("enabled", True)):
            raise RuntimeError(f"Model is disabled: {model_id}")
        if not bool(model.get("is_installed", False)):
            raise RuntimeError(
                f'Model "{str(model.get("model_id", "")).strip() or model_id}" has not been pulled by Ollama'
            )
        return model

    async def _score_rerank_batch(
        self,
        *,
        model_id: str,
        query: str,
        documents: list[str],
    ) -> list[float]:
        response = await self._ollama_client.chat(
            model=model_id,
            messages=_build_rerank_messages(query=query, documents=documents),
            options={"temperature": 0, "num_predict": 128},
            keep_alive="5m",
            format=_build_rerank_scores_schema(len(documents)),
        )
        return _parse_rerank_scores(response, expected_count=len(documents))

    async def _score_by_embedding_similarity(
        self,
        *,
        query: str,
        documents: list[str],
    ) -> list[float]:
        if not documents:
            return []
        query_embedding = (await self.embed_texts([query]))[0]
        document_embeddings = await self.embed_texts(documents)
        return [
            max(0.0, min(1.0, (_cosine_similarity(query_embedding, embedding) + 1.0) / 2.0))
            for embedding in document_embeddings
        ]


def _build_rerank_messages(*, query: str, documents: list[str]) -> list[dict[str, object]]:
    document_lines = [f"{index + 1}. {text}" for index, text in enumerate(documents)]
    return [
        {
            "role": "system",
            "content": (
                "你是中文检索重排序模型。请根据用户问题为每个候选文档输出 0 到 1 的相关度分数。"
                "只返回 JSON，对应格式必须是 {\"scores\":[0.91,0.12,...]}，不要输出额外解释。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"问题：{query}\n\n"
                "候选文档如下：\n"
                f"{chr(10).join(document_lines)}\n\n"
                "请严格按照候选文档顺序返回 scores 数组。"
            ),
        },
    ]


def _build_rerank_scores_schema(expected_count: int) -> dict[str, object]:
    safe_count = max(1, int(expected_count))
    return {
        "type": "object",
        "properties": {
            "scores": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": safe_count,
                "maxItems": safe_count,
            }
        },
        "required": ["scores"],
    }

def _parse_rerank_scores(raw_text: str, *, expected_count: int) -> list[float]:
    cleaned = _normalize_chat_text(raw_text)
    payload = _parse_json_payload(cleaned)
    raw_scores = payload.get("scores")
    if not isinstance(raw_scores, list):
        raise RuntimeError("Ollama rerank response is missing scores")
    scores = [max(0.0, min(1.0, float(item))) for item in raw_scores[:expected_count]]
    if len(scores) != expected_count:
        raise RuntimeError("Ollama rerank response count mismatch")
    return scores


def _parse_json_payload(text: str) -> dict[str, Any]:
    candidate = text.strip()
    match = _JSON_FENCE_PATTERN.search(candidate)
    if match is not None:
        candidate = match.group("body").strip()
    try:
        payload = orjson.loads(candidate.encode("utf-8"))
    except orjson.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid Ollama JSON response: {candidate[:240]}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("Ollama JSON response must be an object")
    return payload


def _normalize_chat_text(text: str) -> str:
    normalized = _THINK_BLOCK_PATTERN.sub("", str(text or ""))
    normalized = _INLINE_THINK_PATTERN.sub("", normalized)
    return normalized.strip()


def _normalize_embedding(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(float(value) * float(value) for value in vector))
    if norm <= 0:
        return [float(value) for value in vector]
    return [float(value) / norm for value in vector]


def _cosine_similarity(lhs: list[float], rhs: list[float]) -> float:
    if not lhs or not rhs:
        return 0.0
    length = min(len(lhs), len(rhs))
    if length <= 0:
        return 0.0
    return sum(float(lhs[index]) * float(rhs[index]) for index in range(length))


def _looks_uninformative_scores(scores: list[float]) -> bool:
    if not scores:
        return True
    rounded = {round(float(item), 6) for item in scores}
    return len(rounded) <= 1
