from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path

import orjson

from app.services.async_utils import gather_limited
from app.services.model_catalog_store import ModelCatalogStore
from app.services.ollama_client import OllamaClient
from app.services.remote_model_client import RemoteModelClient, infer_remote_api_protocol
from app.services.vqa_types import EvidenceDocument

_JSON_FENCE_PATTERN = re.compile(r"```(?:json)?\s*(?P<body>[\s\S]*?)```", re.IGNORECASE)
_THINK_BLOCK_PATTERN = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
_INLINE_THINK_PATTERN = re.compile(r"<think>[\s\S]*", re.IGNORECASE)
# The remote VLM self-check needs a representative image sample with visible text.
# Degenerate 1x1 probe images can trigger provider-side failures for OCR-oriented models.
_PROBE_IMAGE_BASE64 = (
    "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"
    "Ptk0ej9sEk+N6zLrA2Ae1OneVZv2OLx7t43VmuvROu9vMNMY9X64lVLt2PyA7q27zWp3pM6ta2zx1m617m2QNu0s52f52p5ncs/z"
    "83kKBLSxedwnxftr0WG6b3KxmM4mnuiNY/MPlR6H+kjiwXFNVJ3qcBlfa586Og3YB1WPzZpLq83Hx6rXb6hO8cRl3avacch5Tq+7"
    "w2p3pE5rvjNrbMmtuxe8+js4qXcmrXVRcxGUddf/w70soNcT570T3oTf8lyv1SKJQyivpQ3jSXMRvdawxiMP7kyVHR2XSR4G+efb"
    "V80wkZc8gPI+54ndeW117w5j3Wv+locEcxxGOw57ThPr7rDKjdQpy2bX2GKuu+qHXvMrYw/ucCbVm9LG9f9kbwroyf1zLPXa0EKI"
    "z8OaylTbwWYIX2uoOtXmvlNlh8bl00GoD6Hdp/5nh+ZBVQfSfk33S7c1MtZ95q/5dt1ZX9WOQ86p/PMsW59VbqROu2x/jS3muqu6"
    "9ZpfyYDe50wS0G8N6MuLt3dZsRGib2WkoOz8RLG0bXxbPlNlHdZ47INilA36OmTZ1N6B8fu0Mm/4ZjC5g2rP5ereHca6x/zNdRxO"
    "J/dzStWOQ86p/PMsW59VbqROr+yKscaW3Lp7+00EdLBO6px1yyY/4vhS7w3o5vX1BvI/AvEWWG7Audy6jnu9q0Vu3plle5I1Hu+g"
    "6LID4wrdDsTh4G7YVZ+8Q2rMnX1Q5aG0v/vx7pXNZsf68PzN45v77syDbscm11n+eZatzyo3UufWNbbYayf7MRbQss3emWyLL7mw"
    "+u7QLjsx1/8LvD2g3UmPvp1x/kaBd60CbHlqb6/D+Xjs9fOm7detHyOHKj+umL2B7+wDZ13BD56WA2n/dSv7ADbz8OhYjbnO1zmP"
    "2RpfsCZBv+T45J9n5rpbjHZH6jTXSs7J5bL3SMuuS/YjGdBhX66X94CkL9H3qKzs161sdx0KKxDQ7aTLDaE/T7OeFq1yl83ivJPL"
    "8teiiX5etJvv2t+RQ3Wl+2uPK+CO7crqU/sE0/a/ZR7Uy8ZfHzqrv1abj41Vz/VVv8557uXX7/e29XntrMnxyT/P/HWXdLsjdVpl"
    "M2tsMddd3ZsN6OZr7RWdSfngNPQPVax1vgxKzdmneXpAA8AW1zcNK6D/HwQ0gPeRPyfoff0/Q0ADeKP48+pP/nhiDwQ0gLfTn53/"
    "3x9tzAhoACiKgAaAoghoACiKgAaAoghoACiKgAaAoghoACiKgAaAoghoACiKgAaAoghoACiKgAaAol4U0Mn/YPtC/+9W/v9oNVJv"
    "+1tI+mVtI31bs/5z9SGX/3zcv1//ZzPzxX86A3yq5wf0yK+oMQLQDcKheoMAUxV7Bvomub8xJmn5bRPe/X7fCGjgcz05oO/BsQ4x"
    "+5eOLk+4bcCa4TZWr13HXDYXYPm+Se1TflTOsXoj8u63fuUQgE/33ID2fv/Y5BY8948ZvN+DZvw+tp3qzf/OMr8O1Tfh8uR+OJ1P"
    "wx9xrIP9GN3/H/46euB/8NyAjqhQuQWS8fGEDt2AV6+XoCkb+3Z57fqEPv4Z9LXNudvh/U07AL7H2wJaPXlGT8XRa4JX7yVA5W8O"
    "TtR3EbXvvSbeKMKATYjuv475eD6JH4KqPgH4KO8JaCvU1JNvK/kUHNV7EOE1X9ZTsTTcN/3r6aOAzYjud38Amh0fgJJeH9DLU6wI"
    "m+EQFDr16idK5weKlsG+XZ9o1x85RAGb4d/f/4Gp3W8A1b02oL0QbV+z0jJ6bZKp13qSlPVaf3Vvuk+Wa8nXnDA3A9Zrry2zFDXu"
    "74nGDqC8lwW0+dfUVrb9IK5brwzQFfH06wZmvm/yH8OYV7c9bVNAR/0GUN5LAnoJLTMkZ+N/le3Rer2nXc2vQ/ZtKKAHuAEdvQFF"
    "rwEo7+kBnQvRK/Np2PnHIA/XO/IZtFeH0zeLG7BJ/v33z6DXbzRj4wNQz3MDuv0BnXOtQ8X/J8urkNmx3kzAX/l1ZKrwAzYnvN/6"
    "qGR4fACqeW5AR8Fxu/THCzoIVcZsqncOubhMLNE3RxiwCf3770/Mo30DUNNzAxoAsBkBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAA"
    "UBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQB"
    "DQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBF"
    "EdAAUBQBDQBFEdAAUBQBDQBFEdAAUBQBDQBFEdAAUNQ/vQdTiHYjFG4AAAAASUVORK5CYII="
)
_REMOTE_CONTENT_PREP_CONCURRENCY = 4
_REMOTE_IMAGE_DESCRIPTION_CONCURRENCY = 3


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
        remote_model_client: RemoteModelClient | None = None,
        storage_dir: str | None = None,
    ) -> None:
        self._model_catalog_store = model_catalog_store
        self._ollama_client = ollama_client
        self._remote_model_client = remote_model_client or RemoteModelClient()
        self._storage_dir = str(storage_dir or "").strip()

    async def use_multimodal_retrieval_route(self) -> bool:
        mllm_model = await self._resolve_optional_model("mllm-default")
        embedding_model = await self._resolve_optional_model("embedding-default")
        return bool(
            mllm_model
            and embedding_model
            and _is_remote_model_ready(mllm_model)
            and _supports_multimodal_embedding(embedding_model)
        )

    async def embed_query_text(self, query_text: str) -> list[float]:
        vectors = await self._embed_texts_with_model(
            model=await self._resolve_model("embedding-default"),
            texts=[query_text],
            input_type="query",
        )
        return vectors[0] if vectors else []

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return await self._embed_texts_with_model(
            model=await self._resolve_model("embedding-default"),
            texts=texts,
            input_type="document",
        )

    async def embed_documents(
        self,
        documents: list[EvidenceDocument],
        *,
        multimodal: bool,
    ) -> list[list[float]]:
        model = await self._resolve_model("embedding-default")
        if not documents:
            return []
        if _is_remote_model_ready(model) and multimodal and _supports_multimodal_embedding(model):
            items = await gather_limited(
                documents,
                limit=min(len(documents), _REMOTE_CONTENT_PREP_CONCURRENCY),
                worker=lambda item: self._build_embedding_contents(model=model, document=item, multimodal=True),
            )
            return await self._remote_model_client.embed_contents(
                config=model,
                items=items,
                input_type="document",
                enable_fusion=True,
            )
        return await self._embed_texts_with_model(
            model=model,
            texts=[_compose_retrieval_text(text=item.text, visual_text=item.visual_text) for item in documents],
            input_type="document",
        )

    async def score_rerank_pairs(
        self,
        *,
        query: str,
        documents: list[str],
        image_paths: list[str] | None = None,
    ) -> list[float]:
        normalized_query = str(query).strip()
        normalized_docs = [str(item).strip() for item in documents if str(item).strip()]
        if not normalized_query or not normalized_docs:
            return []
        model = await self._resolve_model("rerank-default")
        if _is_remote_model_ready(model):
            document_contents = await gather_limited(
                list(enumerate(normalized_docs)),
                limit=min(len(normalized_docs), _REMOTE_CONTENT_PREP_CONCURRENCY),
                worker=lambda item: self._build_rerank_contents(
                    model=model,
                    text=item[1],
                    image_path=image_paths[item[0]] if image_paths and item[0] < len(image_paths) else "",
                ),
            )
            try:
                scores = await self._remote_model_client.rerank(
                    config=model,
                    query_contents=[{"text": normalized_query}],
                    document_contents=document_contents,
                )
            except Exception:
                scores = []
            if len(scores) == len(normalized_docs) and not _looks_uninformative_scores(scores):
                return scores
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
        if _is_remote_model_ready(model):
            sample_docs = normalized_docs[:3]
            try:
                scores = await self._remote_model_client.rerank(
                    config=model,
                    query_contents=[{"text": normalized_query}],
                    document_contents=[[{"text": item}] for item in sample_docs],
                )
            except Exception:
                return False
            return len(scores) == len(sample_docs) and not _looks_uninformative_scores(scores)
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
        if _is_remote_model_ready(model):
            async def describe_remote_image(image_path: str) -> str:
                encoded = await self.encode_image_for_model(model=model, image_path=image_path)
                system_prompt, user_prompt = _build_remote_vlm_prompts(
                    model_name=_display_model_name(model),
                    task="describe_frame",
                )
                content = await self._remote_model_client.chat_text(
                    config=model,
                    messages=[
                        {
                            "role": "system",
                            "content": system_prompt,
                        },
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": user_prompt},
                                {"type": "image_url", "image_url": {"url": encoded}},
                            ],
                        },
                    ],
                    temperature=0.1,
                )
                return _normalize_chat_text(content)

            return await gather_limited(
                normalized_paths,
                limit=min(len(normalized_paths), _REMOTE_IMAGE_DESCRIPTION_CONCURRENCY),
                worker=describe_remote_image,
            )

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

    async def encode_image_for_model(self, *, model: dict[str, object], image_path: str) -> str:
        if not _is_remote_model_ready(model):
            return await self._ollama_client.image_to_base64(image_path)
        return await self._remote_model_client.encode_image_as_data_url(
            image_path=image_path,
            max_bytes=int(model.get("api_image_max_bytes", 524288) or 524288),
            max_edge=int(model.get("api_image_max_edge", 1280) or 1280),
        )

    def resolve_task_image_path(self, *, task_id: str, image_path: str) -> str:
        candidate = Path(str(image_path or "").strip())
        if not str(candidate):
            return ""
        if candidate.is_absolute():
            return str(candidate.resolve())
        if self._storage_dir:
            return str((Path(self._storage_dir) / "tasks" / "stage-artifacts" / str(task_id).strip() / "D" / "fusion" / candidate).resolve())
        return str(candidate.resolve())

    async def get_mllm_model(self) -> dict[str, object] | None:
        model = await self._resolve_optional_model("mllm-default")
        return model if model and _is_remote_model_ready(model) else None

    async def probe_embedding(self) -> ModelProbeResult:
        model = await self._resolve_model("embedding-default")
        vectors = await self._embed_texts_with_model(model=model, texts=["VidGnost embedding probe"], input_type="query")
        ready = bool(vectors and vectors[0])
        return ModelProbeResult(
            ready=ready,
            message="Embedding 模型最小推理校验通过" if ready else "Embedding 模型探测失败",
            details={
                "provider": str(model.get("provider", "")).strip(),
                "model": _display_model_name(model),
                "endpoint": _display_endpoint(model, self._ollama_client),
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
            message="Rerank 模型最小推理校验通过" if ready else "Rerank 模型探测失败",
            details={
                "provider": str(model.get("provider", "")).strip(),
                "model": _display_model_name(model),
                "endpoint": _display_endpoint(model, self._ollama_client),
            },
        )

    async def probe_vlm(self) -> ModelProbeResult:
        model = await self._resolve_model("vlm-default")
        if _is_remote_model_ready(model):
            system_prompt, user_prompt = _build_remote_vlm_prompts(
                model_name=_display_model_name(model),
                task="probe",
            )
            response = await self._remote_model_client.chat_text(
                config=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/png;base64,{_PROBE_IMAGE_BASE64}"},
                            },
                        ],
                    },
                ],
                temperature=0,
            )
            text = _normalize_chat_text(response)
        else:
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
            message="VLM 模型最小推理校验通过" if ready else "VLM 模型探测失败",
            details={
                "provider": str(model.get("provider", "")).strip(),
                "model": _display_model_name(model),
                "endpoint": _display_endpoint(model, self._ollama_client),
            },
        )

    async def _resolve_model(self, model_id: str) -> dict[str, object]:
        models = await self._model_catalog_store.list_models()
        model = next((item for item in models if str(item.get("id", "")).strip() == model_id), None)
        if model is None:
            raise RuntimeError(f"Missing model configuration: {model_id}")
        if not bool(model.get("enabled", True)):
            raise RuntimeError(f"Model is disabled: {model_id}")
        if _is_remote_provider(model):
            if not _is_remote_model_ready(model):
                raise RuntimeError(f'Remote model "{_display_model_name(model) or model_id}" is not fully configured')
            return model
        if not bool(model.get("is_installed", False)):
            raise RuntimeError(
                f'Model "{str(model.get("model_id", "")).strip() or model_id}" has not been prepared locally'
            )
        return model

    async def _resolve_optional_model(self, model_id: str) -> dict[str, object] | None:
        models = await self._model_catalog_store.list_models()
        return next((item for item in models if str(item.get("id", "")).strip() == model_id), None)

    async def _embed_texts_with_model(
        self,
        *,
        model: dict[str, object],
        texts: list[str],
        input_type: str,
    ) -> list[list[float]]:
        normalized_inputs = [str(item).strip() for item in texts if str(item).strip()]
        if not normalized_inputs:
            return []
        if _is_remote_model_ready(model):
            return await self._remote_model_client.embed_texts(
                config=model,
                texts=normalized_inputs,
                input_type=input_type,
            )
        batch_size = max(1, int(model.get("max_batch_size", 8) or 8))
        outputs: list[list[float]] = []
        for start in range(0, len(normalized_inputs), batch_size):
            batch = normalized_inputs[start : start + batch_size]
            embeddings = await self._ollama_client.embed(model=str(model["model_id"]).strip(), inputs=batch)
            outputs.extend(_normalize_embedding(vector) for vector in embeddings)
        if len(outputs) != len(normalized_inputs):
            raise RuntimeError("Embedding result count mismatch")
        return outputs

    async def _build_embedding_contents(
        self,
        *,
        model: dict[str, object],
        document: EvidenceDocument,
        multimodal: bool,
    ) -> list[dict[str, str]]:
        contents: list[dict[str, str]] = []
        retrieval_text = _compose_retrieval_text(text=document.text, visual_text=document.visual_text)
        if retrieval_text:
            contents.append({"text": retrieval_text})
        if multimodal and document.image_path:
            contents.append(
                {
                    "image": await self.encode_image_for_model(
                        model=model,
                        image_path=self.resolve_task_image_path(task_id=document.task_id, image_path=document.image_path),
                    )
                }
            )
        return contents

    async def _build_rerank_contents(
        self,
        *,
        model: dict[str, object],
        text: str,
        image_path: str,
    ) -> list[dict[str, str]]:
        contents: list[dict[str, str]] = []
        normalized_text = str(text).strip()
        if normalized_text:
            contents.append({"text": normalized_text})
        normalized_image_path = str(image_path).strip()
        if normalized_image_path and _is_remote_model_ready(model):
            contents.append(
                {
                    "image": await self.encode_image_for_model(
                        model=model,
                        image_path=normalized_image_path,
                    )
                }
            )
        return contents

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


def _parse_json_payload(text: str) -> dict[str, object]:
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


def _is_remote_provider(model: dict[str, object]) -> bool:
    return str(model.get("provider", "")).strip().lower() == "openai_compatible"


def _is_remote_model_ready(model: dict[str, object]) -> bool:
    return bool(
        _is_remote_provider(model)
        and str(model.get("api_base_url", "")).strip()
        and str(model.get("api_key", "")).strip()
        and _display_model_name(model)
        and bool(model.get("enabled", True))
    )


def _supports_multimodal_embedding(model: dict[str, object]) -> bool:
    return bool(_is_remote_model_ready(model) and infer_remote_api_protocol(model) == "aliyun_bailian")


def _display_model_name(model: dict[str, object]) -> str:
    return str(model.get("api_model", "")).strip() or str(model.get("model_id", "")).strip()


def _display_endpoint(model: dict[str, object], ollama_client: OllamaClient) -> str:
    if _is_remote_provider(model):
        return str(model.get("api_base_url", "")).strip()
    return ollama_client.base_url


def _build_remote_vlm_prompts(*, model_name: str, task: str) -> tuple[str, str]:
    normalized_model_name = str(model_name or "").strip().lower()
    if "paddleocr-vl" in normalized_model_name:
        system_prompt = (
            "你是 OCR 与图像理解助手。"
            "请优先提取图片中的可见文字、数字、标题和界面标签，"
            "再补充概括主要场景和主体，不要编造。"
        )
        if task == "probe":
            return system_prompt, "请读取这张图片中的可见文字；如果几乎没有文字，再用一句中文概括可见内容。"
        return system_prompt, "请先提取这张视频帧中的可见文字，再用一到两句中文概括主体场景、动作和关键信息。"
    system_prompt = "你是视频关键帧理解助手。请用简洁中文描述画面主体、场景、动作和字幕，不要编造。"
    if task == "probe":
        return system_prompt, "请用一句中文描述这张图片。"
    return system_prompt, "请概括这张视频帧画面的关键信息，控制在一到两句话内。"


def _compose_retrieval_text(*, text: str, visual_text: str) -> str:
    transcript = str(text).strip()
    vision = str(visual_text).strip()
    if transcript and vision:
        return f"{transcript}\n视觉线索：{vision}"
    return transcript or vision
