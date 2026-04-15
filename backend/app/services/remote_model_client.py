from __future__ import annotations

import base64
import io
import math
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import orjson
from openai import AsyncOpenAI

from app.services.async_utils import gather_limited

_DEFAULT_TIMEOUT_SECONDS = 120.0
_BAILIAN_PROTOCOL_COMPONENTS = {"embedding", "rerank"}
_DEFAULT_REMOTE_PARALLELISM = 4


class RemoteModelClient:
    async def chat_text(
        self,
        *,
        config: dict[str, object],
        messages: list[dict[str, object]],
        temperature: float = 0.2,
    ) -> str:
        client = self._build_openai_client(config)
        normalized_messages = _normalize_openai_chat_messages(config=config, messages=messages)
        response = await client.chat.completions.create(
            model=self._model_name(config),
            messages=normalized_messages,  # type: ignore[arg-type]
            temperature=temperature,
            stream=False,
        )
        if not response.choices or response.choices[0].message is None:
            return ""
        return _coerce_openai_message_content(response.choices[0].message.content)

    async def stream_chat_text(
        self,
        *,
        config: dict[str, object],
        messages: list[dict[str, object]],
        temperature: float = 0.2,
    ) -> AsyncIterator[str]:
        client = self._build_openai_client(config)
        normalized_messages = _normalize_openai_chat_messages(config=config, messages=messages)
        stream = await client.chat.completions.create(
            model=self._model_name(config),
            messages=normalized_messages,  # type: ignore[arg-type]
            temperature=temperature,
            stream=True,
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content if chunk.choices[0].delta is not None else None
            if isinstance(delta, str) and delta:
                yield delta
            elif isinstance(delta, list):
                text = _coerce_openai_message_content(delta)
                if text:
                    yield text

    async def embed_texts(
        self,
        *,
        config: dict[str, object],
        texts: list[str],
        input_type: str,
    ) -> list[list[float]]:
        contents = [[{"text": text}] for text in texts if text.strip()]
        return await self.embed_contents(
            config=config,
            items=contents,
            input_type=input_type,
            enable_fusion=False,
        )

    async def embed_contents(
        self,
        *,
        config: dict[str, object],
        items: list[list[dict[str, str]]],
        input_type: str,
        enable_fusion: bool,
    ) -> list[list[float]]:
        protocol = infer_remote_api_protocol(config)
        normalized_items = [
            [content for content in item if content.get("text") or content.get("image")]
            for item in items
        ]
        normalized_items = [item for item in normalized_items if item]
        if not normalized_items:
            return []

        if protocol == "aliyun_bailian":
            timeout_seconds = float(config.get("api_timeout_seconds", _DEFAULT_TIMEOUT_SECONDS) or _DEFAULT_TIMEOUT_SECONDS)
            url = (
                f"{_dashscope_api_root(str(config.get('api_base_url', '')))}"
                "/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding"
            )
            api_key = str(config.get("api_key", "")).strip()

            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                async def request_embedding(contents: list[dict[str, str]]) -> list[float]:
                    payload = {
                        "model": self._model_name(config),
                        "input": {"contents": contents},
                        "parameters": {
                            "text_type": input_type,
                            "enable_fusion": enable_fusion,
                        },
                    }
                    response = await self._post_json(
                        url=url,
                        api_key=api_key,
                        payload=payload,
                        timeout_seconds=timeout_seconds,
                        client=client,
                    )
                    return _parse_dashscope_embedding(response)

                vectors = await gather_limited(
                    normalized_items,
                    limit=min(len(normalized_items), _DEFAULT_REMOTE_PARALLELISM),
                    worker=request_embedding,
                )
            return [_normalize_embedding(vector) for vector in vectors]

        client = self._build_openai_client(config)
        response = await client.embeddings.create(
            model=self._model_name(config),
            input=[item[0]["text"] for item in normalized_items],  # type: ignore[arg-type]
        )
        return [_normalize_embedding([float(value) for value in item.embedding]) for item in response.data]

    async def rerank(
        self,
        *,
        config: dict[str, object],
        query_contents: list[dict[str, str]],
        document_contents: list[list[dict[str, str]]],
    ) -> list[float]:
        protocol = infer_remote_api_protocol(config)
        normalized_query = [item for item in query_contents if item.get("text") or item.get("image")]
        normalized_documents = [
            [content for content in item if content.get("text") or content.get("image")]
            for item in document_contents
        ]
        normalized_documents = [item for item in normalized_documents if item]
        if not normalized_query or not normalized_documents:
            return []

        if protocol == "aliyun_bailian":
            payload = {
                "model": self._model_name(config),
                "input": {
                    "query": normalized_query,
                    "documents": normalized_documents,
                },
            }
            response = await self._post_json(
                url=f"{_dashscope_api_root(str(config.get('api_base_url', '')))}/api/v1/services/rerank/text-rerank/text-rerank",
                api_key=str(config.get("api_key", "")).strip(),
                payload=payload,
                timeout_seconds=float(config.get("api_timeout_seconds", _DEFAULT_TIMEOUT_SECONDS) or _DEFAULT_TIMEOUT_SECONDS),
            )
            return _parse_dashscope_rerank_scores(response, expected_count=len(normalized_documents))

        document_lines = [f"{index + 1}. {_flatten_contents(item)}" for index, item in enumerate(normalized_documents)]
        prompt = (
            "你是重排序模型。请根据 query 为每个 document 输出 0 到 1 的相关度分数。"
            "严格返回 JSON：{\"scores\":[0.91,0.12]}。"
            f"\nquery: {_flatten_contents(normalized_query)}"
            f"\ndocuments:\n{chr(10).join(document_lines)}"
        )
        text = await self.chat_text(
            config=config,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        return _parse_scores_json(text, expected_count=len(normalized_documents))

    async def encode_image_as_data_url(
        self,
        *,
        image_path: str | Path,
        max_bytes: int,
        max_edge: int,
    ) -> str:
        path = Path(image_path).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(str(path))
        raw_bytes = path.read_bytes()
        media_type = _guess_image_media_type(path)
        if len(raw_bytes) <= max_bytes:
            return f"data:{media_type};base64,{base64.b64encode(raw_bytes).decode('utf-8')}"

        try:
            from PIL import Image  # type: ignore
        except Exception:
            return f"data:{media_type};base64,{base64.b64encode(raw_bytes).decode('utf-8')}"

        image = Image.open(io.BytesIO(raw_bytes))
        image = image.convert("RGB")
        width, height = image.size
        longest_edge = max(width, height)
        if longest_edge > max_edge:
            scale = max_edge / float(longest_edge)
            resized = (
                max(1, int(math.floor(width * scale))),
                max(1, int(math.floor(height * scale))),
            )
            image = image.resize(resized)

        quality = 82
        encoded_bytes = raw_bytes
        while quality >= 45:
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=quality, optimize=True)
            candidate = buffer.getvalue()
            encoded_bytes = candidate
            if len(candidate) <= max_bytes:
                break
            quality -= 7
        return f"data:image/jpeg;base64,{base64.b64encode(encoded_bytes).decode('utf-8')}"

    @staticmethod
    def _build_openai_client(config: dict[str, object]) -> AsyncOpenAI:
        return AsyncOpenAI(
            api_key=str(config.get("api_key", "")).strip(),
            base_url=str(config.get("api_base_url", "")).strip(),
            timeout=float(config.get("api_timeout_seconds", _DEFAULT_TIMEOUT_SECONDS) or _DEFAULT_TIMEOUT_SECONDS),
        )

    @staticmethod
    def _model_name(config: dict[str, object]) -> str:
        return (
            str(config.get("api_model", "")).strip()
            or str(config.get("model_id", "")).strip()
        )

    async def _post_json(
        self,
        *,
        url: str,
        api_key: str,
        payload: dict[str, object],
        timeout_seconds: float,
        client: httpx.AsyncClient | None = None,
    ) -> dict[str, object]:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if client is None:
            async with httpx.AsyncClient(timeout=timeout_seconds) as session:
                response = await session.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
        else:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, dict):
            raise RuntimeError("Remote API returned invalid JSON payload")
        return data


def _dashscope_api_root(base_url: str) -> str:
    normalized = str(base_url or "").strip().rstrip("/")
    marker = "/compatible-mode/v1"
    if normalized.endswith(marker):
        return normalized[: -len(marker)]
    return normalized


def infer_remote_api_protocol(config: dict[str, object]) -> str:
    component = str(config.get("component", "")).strip().lower()
    explicit = str(config.get("api_protocol", "")).strip().lower()
    if component in _BAILIAN_PROTOCOL_COMPONENTS and (
        _is_dashscope_compatible_base_url(str(config.get("api_base_url", "")).strip())
        or explicit == "aliyun_bailian"
    ):
        return "aliyun_bailian"
    return "openai_compatible"


def _is_dashscope_compatible_base_url(base_url: str) -> bool:
    normalized = str(base_url or "").strip().lower()
    return bool(normalized and "dashscope.aliyuncs.com" in normalized)


def _is_siliconflow_base_url(base_url: str) -> bool:
    normalized = str(base_url or "").strip().lower()
    return bool(normalized and "api.siliconflow.cn" in normalized)


def _parse_dashscope_embedding(payload: dict[str, object]) -> list[float]:
    output = payload.get("output")
    if isinstance(output, dict):
        embeddings = output.get("embeddings")
        if isinstance(embeddings, list) and embeddings:
            first = embeddings[0]
            if isinstance(first, dict) and isinstance(first.get("embedding"), list):
                return [float(value) for value in first["embedding"]]
        embedding = output.get("embedding")
        if isinstance(embedding, list):
            return [float(value) for value in embedding]
    raise RuntimeError("Embedding API response is missing embedding values")


def _parse_dashscope_rerank_scores(payload: dict[str, object], *, expected_count: int) -> list[float]:
    output = payload.get("output")
    if not isinstance(output, dict):
        raise RuntimeError("Rerank API response is missing output")
    results = output.get("results")
    if not isinstance(results, list):
        raise RuntimeError("Rerank API response is missing results")
    scores_by_index: dict[int, float] = {}
    for item in results:
        if not isinstance(item, dict):
            continue
        index = int(item.get("index", -1) or -1)
        score = float(item.get("relevance_score", item.get("score", 0.0)) or 0.0)
        if index >= 0:
            scores_by_index[index] = max(0.0, min(1.0, score))
    return [scores_by_index.get(index, 0.0) for index in range(expected_count)]


def _parse_scores_json(text: str, *, expected_count: int) -> list[float]:
    candidate = str(text or "").strip()
    try:
        payload = orjson.loads(candidate.encode("utf-8"))
    except orjson.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid rerank JSON: {candidate[:200]}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("Rerank JSON must be an object")
    raw_scores = payload.get("scores")
    if not isinstance(raw_scores, list):
        raise RuntimeError("Rerank JSON is missing scores")
    scores = [max(0.0, min(1.0, float(item))) for item in raw_scores[:expected_count]]
    if len(scores) != expected_count:
        raise RuntimeError("Rerank score count mismatch")
    return scores


def _coerce_openai_message_content(content: object) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        fragments: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    fragments.append(text.strip())
        return "\n".join(fragments).strip()
    return ""


def _normalize_embedding(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(float(value) * float(value) for value in vector))
    if norm <= 0:
        return [float(value) for value in vector]
    return [float(value) / norm for value in vector]


def _flatten_contents(contents: list[dict[str, str]]) -> str:
    parts: list[str] = []
    for item in contents:
        if item.get("text"):
            parts.append(str(item["text"]).strip())
        elif item.get("image"):
            parts.append("[image]")
    return " ".join(part for part in parts if part).strip()


def _guess_image_media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    return {
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(suffix, "image/jpeg")


def _normalize_openai_chat_messages(
    *,
    config: dict[str, object],
    messages: list[dict[str, object]],
) -> list[dict[str, object]]:
    if not _should_flatten_multimodal_messages(config=config, messages=messages):
        return messages

    merged_content: list[dict[str, object]] = []
    for message in messages:
        role = str(message.get("role", "")).strip().lower()
        content = _coerce_message_content_parts(message.get("content"))
        if not content:
            continue
        if role == "system":
            merged_content.append(
                {
                    "type": "text",
                    "text": f"系统要求：{_flatten_content_parts(content)}",
                }
            )
            continue
        merged_content.extend(content)
    if not merged_content:
        return messages
    return [{"role": "user", "content": merged_content}]


def _should_flatten_multimodal_messages(
    *,
    config: dict[str, object],
    messages: list[dict[str, object]],
) -> bool:
    base_url = str(config.get("api_base_url", "")).strip()
    if not _is_siliconflow_base_url(base_url):
        return False
    return any(_message_contains_multimodal_parts(message) for message in messages)


def _message_contains_multimodal_parts(message: dict[str, object]) -> bool:
    content = message.get("content")
    if isinstance(content, list):
        return any(
            isinstance(item, dict)
            and str(item.get("type", "")).strip().lower() in {"image_url", "input_image", "video_url", "input_video"}
            for item in content
        )
    return False


def _coerce_message_content_parts(content: object) -> list[dict[str, object]]:
    if isinstance(content, str):
        text = content.strip()
        return [{"type": "text", "text": text}] if text else []
    if not isinstance(content, list):
        return []

    normalized_parts: list[dict[str, object]] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        part_type = str(item.get("type", "")).strip().lower()
        if part_type in {"text", "input_text"}:
            text = str(item.get("text", "")).strip() or str(item.get("input_text", "")).strip()
            if text:
                normalized_parts.append({"type": "text", "text": text})
            continue
        if part_type == "image_url":
            image_url = item.get("image_url")
            if isinstance(image_url, dict):
                url = str(image_url.get("url", "")).strip()
                if url:
                    normalized_parts.append({"type": "image_url", "image_url": {"url": url}})
            continue
        if part_type == "input_image":
            image_url = item.get("image_url")
            if isinstance(image_url, dict):
                url = str(image_url.get("url", "")).strip()
                if url:
                    normalized_parts.append({"type": "image_url", "image_url": {"url": url}})
            else:
                url = str(item.get("input_image", "")).strip()
                if url:
                    normalized_parts.append({"type": "image_url", "image_url": {"url": url}})
            continue
        if part_type in {"video_url", "input_video"}:
            video_url = item.get("video_url")
            if isinstance(video_url, dict):
                url = str(video_url.get("url", "")).strip()
                if url:
                    normalized_parts.append({"type": "video_url", "video_url": {"url": url}})
            continue
    return normalized_parts


def _flatten_content_parts(parts: list[dict[str, object]]) -> str:
    text_fragments: list[str] = []
    for part in parts:
        if str(part.get("type", "")).strip().lower() != "text":
            continue
        text = str(part.get("text", "")).strip()
        if text:
            text_fragments.append(text)
    return "\n".join(text_fragments).strip()
