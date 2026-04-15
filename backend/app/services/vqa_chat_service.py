from __future__ import annotations

from dataclasses import dataclass
from typing import Any, AsyncIterator

from app.services.async_utils import gather_limited
from app.services.llm_config_store import LLMConfigStore
from app.services.model_catalog_store import ModelCatalogStore
from app.services.remote_model_client import RemoteModelClient
from app.services.vqa_model_runtime import VQAModelRuntime
from app.services.vqa_types import Citation, RetrievalHit

_MULTIMODAL_IMAGE_BUILD_CONCURRENCY = 4


@dataclass(slots=True)
class ChatResult:
    answer: str
    citations: list[Citation]
    context_tokens_approx: int
    error: dict[str, str] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "citations": [item.to_dict() for item in self.citations],
            "context_tokens_approx": self.context_tokens_approx,
            "error": self.error,
        }


class VQAChatService:
    def __init__(
        self,
        *,
        llm_config_store: LLMConfigStore,
        model_catalog_store: ModelCatalogStore,
        model_runtime: VQAModelRuntime,
        remote_model_client: RemoteModelClient | None = None,
    ) -> None:
        self._llm_config_store = llm_config_store
        self._model_catalog_store = model_catalog_store
        self._model_runtime = model_runtime
        self._remote_model_client = remote_model_client or RemoteModelClient()

    async def answer(self, *, query_text: str, hits: list[RetrievalHit]) -> ChatResult:
        citations = _build_citations(hits)
        config, messages, context_tokens_approx = await self._build_chat_request(query_text=query_text, hits=hits)
        if config is None:
            return ChatResult(
                answer="",
                citations=citations,
                context_tokens_approx=context_tokens_approx,
                error={"code": "LLM_DISABLED", "message": "LLM 或全模态模型尚未完成可用配置。"},
            )
        try:
            answer = await self._remote_model_client.chat_text(
                config=config,
                messages=messages,
                temperature=0.2,
            )
        except Exception as exc:  # noqa: BLE001
            return ChatResult(
                answer="",
                citations=citations,
                context_tokens_approx=context_tokens_approx,
                error={"code": "LLM_COMPLETION_ERROR", "message": str(exc)},
            )
        return ChatResult(
            answer=(answer or "").strip(),
            citations=citations,
            context_tokens_approx=context_tokens_approx,
            error=None,
        )

    async def stream_answer(self, *, query_text: str, hits: list[RetrievalHit]) -> AsyncIterator[dict[str, Any]]:
        citations = _build_citations(hits)
        config, messages, context_tokens_approx = await self._build_chat_request(query_text=query_text, hits=hits)
        if config is None:
            yield {
                "type": "error",
                "error": {"code": "LLM_DISABLED", "message": "LLM 或全模态模型尚未完成可用配置。"},
            }
            return

        yield {
            "type": "citations",
            "citations": [item.to_dict() for item in citations],
            "context_tokens_approx": context_tokens_approx,
        }
        try:
            async for delta in self._remote_model_client.stream_chat_text(
                config=config,
                messages=messages,
                temperature=0.2,
            ):
                if delta:
                    yield {"type": "chunk", "delta": delta}
        except Exception as exc:  # noqa: BLE001
            yield {
                "type": "error",
                "error": {"code": "LLM_STREAM_ERROR", "message": str(exc)},
            }
            return
        yield {"type": "done"}

    async def _build_chat_request(
        self,
        *,
        query_text: str,
        hits: list[RetrievalHit],
    ) -> tuple[dict[str, object] | None, list[dict[str, object]], int]:
        mllm_model = await self._model_runtime.get_mllm_model()
        if mllm_model is not None and any(str(item.image_path).strip() for item in hits):
            messages = await self._build_multimodal_messages(query_text=query_text, hits=hits, model=mllm_model)
            return mllm_model, messages, _estimate_multimodal_tokens(query_text, hits)

        llm_model = await self._resolve_text_llm_config()
        system_prompt, user_prompt = _build_text_prompts(query_text=query_text, hits=hits)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        return llm_model, messages, _estimate_tokens(system_prompt + "\n" + user_prompt)

    async def _resolve_text_llm_config(self) -> dict[str, object] | None:
        model = await self._model_catalog_store.get_model("llm-default")
        if model is not None and _is_remote_model_ready(model):
            return model
        llm_config = await self._llm_config_store.get(mask_secrets=False)
        if not llm_config.get("api_key_configured"):
            return None
        return {
            "provider": "openai_compatible",
            "api_base_url": str(llm_config.get("base_url", "")).strip(),
            "api_key": str(llm_config.get("api_key", "")).strip(),
            "api_model": str(llm_config.get("model", "")).strip(),
            "api_protocol": "openai_compatible",
            "api_timeout_seconds": float(llm_config.get("timeout_seconds", 120) or 120),
            "enabled": True,
        }

    async def _build_multimodal_messages(
        self,
        *,
        query_text: str,
        hits: list[RetrievalHit],
        model: dict[str, object],
    ) -> list[dict[str, object]]:
        system_prompt = (
            "你是视频证据问答助手。"
            "请同时结合文本证据和关键帧图像作答，不要编造。"
            "优先给出可验证结论，并在关键结论中体现时间锚点。"
            "回答使用简洁的 Markdown。"
        )
        content: list[dict[str, object]] = [
            {
                "type": "text",
                "text": _build_multimodal_context_text(query_text=query_text, hits=hits),
            }
        ]
        image_hits = [item for item in hits if str(item.image_path).strip()][:4]

        async def build_image_blocks(item: tuple[int, RetrievalHit]) -> list[dict[str, object]]:
            index, hit = item
            absolute_path = self._model_runtime.resolve_task_image_path(task_id=hit.task_id, image_path=hit.image_path)
            if not absolute_path:
                return []
            encoded = await self._model_runtime.encode_image_for_model(model=model, image_path=absolute_path)
            return [
                {
                    "type": "text",
                    "text": f"证据图 {index} 对应片段：{hit.task_title} {hit.start:.2f}-{hit.end:.2f}s",
                },
                {
                    "type": "image_url",
                    "image_url": {"url": encoded},
                },
            ]

        image_blocks = await gather_limited(
            list(enumerate(image_hits, start=1)),
            limit=min(len(image_hits), _MULTIMODAL_IMAGE_BUILD_CONCURRENCY) if image_hits else 1,
            worker=build_image_blocks,
        )
        for block in image_blocks:
            content.extend(block)
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content},
        ]


def _build_text_prompts(*, query_text: str, hits: list[RetrievalHit]) -> tuple[str, str]:
    context_lines: list[str] = []
    for index, hit in enumerate(hits, start=1):
        context_lines.append(
            (
                f"[{index}] task={hit.task_title} source={hit.source} "
                f"time={hit.start:.2f}-{hit.end:.2f}s\n"
                f"transcript={hit.text}\n"
                f"visual={hit.visual_text or '(无视觉描述)'}"
            )
        )
    context = "\n\n".join(context_lines)
    system_prompt = (
        "你是视频证据问答助手。"
        "回答必须基于证据上下文，不要编造。"
        "优先给出可验证结论，并在关键结论中体现时间锚点。"
        "回答使用简洁的 Markdown。"
    )
    user_prompt = (
        f"用户问题：{query_text.strip()}\n\n"
        "证据上下文如下：\n"
        f"{context if context else '(无命中证据)'}\n\n"
        "请输出中文 Markdown 回答，并在证据不足时明确说明。"
    )
    return system_prompt, user_prompt


def _build_multimodal_context_text(*, query_text: str, hits: list[RetrievalHit]) -> str:
    lines = [f"用户问题：{query_text.strip()}", "", "命中的视频证据如下："]
    for index, hit in enumerate(hits, start=1):
        lines.append(
            (
                f"[{index}] task={hit.task_title} source={hit.source} "
                f"time={hit.start:.2f}-{hit.end:.2f}s "
                f"transcript={hit.text} "
                f"visual={hit.visual_text or '(无视觉描述)'}"
            )
        )
    lines.append("")
    lines.append("请综合这些文本与后续图片证据作答，并在证据不足时明确说明。")
    return "\n".join(lines).strip()


def _build_citations(hits: list[RetrievalHit]) -> list[Citation]:
    return [
        Citation(
            doc_id=item.doc_id,
            task_id=item.task_id,
            task_title=item.task_title,
            source=item.source,
            source_set=list(item.source_set),
            start=item.start,
            end=item.end,
            text=item.text,
            image_path=item.image_path,
            visual_text=item.visual_text,
        )
        for item in hits
    ]


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _estimate_multimodal_tokens(query_text: str, hits: list[RetrievalHit]) -> int:
    text_budget = _estimate_tokens(_build_multimodal_context_text(query_text=query_text, hits=hits))
    image_budget = sum(160 for item in hits[:4] if str(item.image_path).strip())
    return text_budget + image_budget


def _is_remote_model_ready(model: dict[str, object]) -> bool:
    return bool(
        str(model.get("provider", "")).strip().lower() == "openai_compatible"
        and str(model.get("api_base_url", "")).strip()
        and str(model.get("api_key", "")).strip()
        and (str(model.get("api_model", "")).strip() or str(model.get("model_id", "")).strip())
        and bool(model.get("enabled", True))
    )
