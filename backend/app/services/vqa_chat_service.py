from __future__ import annotations

from dataclasses import dataclass
from typing import Any, AsyncIterator

from openai import AsyncOpenAI

from app.services.llm_config_store import LLMConfigStore
from app.services.vqa_types import Citation, RetrievalHit


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
    def __init__(self, *, llm_config_store: LLMConfigStore) -> None:
        self._llm_config_store = llm_config_store

    async def answer(self, *, query_text: str, hits: list[RetrievalHit]) -> ChatResult:
        citations = _build_citations(hits)
        system_prompt, user_prompt = _build_prompts(query_text=query_text, hits=hits)
        context_tokens_approx = _estimate_tokens(system_prompt + "\n" + user_prompt)
        llm_config = await self._llm_config_store.get(mask_secrets=False)
        if not llm_config.get("api_key_configured"):
            return ChatResult(
                answer="",
                citations=citations,
                context_tokens_approx=context_tokens_approx,
                error={"code": "LLM_DISABLED", "message": "API key is not configured."},
            )
        client = _build_client(llm_config)
        try:
            response = await client.chat.completions.create(
                model=str(llm_config.get("model", "")).strip(),
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                stream=False,
                temperature=0.2,
            )
        except Exception as exc:  # noqa: BLE001
            return ChatResult(
                answer="",
                citations=citations,
                context_tokens_approx=context_tokens_approx,
                error={"code": "LLM_COMPLETION_ERROR", "message": str(exc)},
            )
        answer = (
            response.choices[0].message.content
            if response.choices and response.choices[0].message is not None
            else ""
        )
        return ChatResult(
            answer=(answer or "").strip(),
            citations=citations,
            context_tokens_approx=context_tokens_approx,
            error=None,
        )

    async def stream_answer(self, *, query_text: str, hits: list[RetrievalHit]) -> AsyncIterator[dict[str, Any]]:
        citations = _build_citations(hits)
        system_prompt, user_prompt = _build_prompts(query_text=query_text, hits=hits)
        context_tokens_approx = _estimate_tokens(system_prompt + "\n" + user_prompt)
        llm_config = await self._llm_config_store.get(mask_secrets=False)
        if not llm_config.get("api_key_configured"):
            yield {
                "type": "error",
                "error": {"code": "LLM_DISABLED", "message": "API key is not configured."},
            }
            return

        yield {
            "type": "citations",
            "citations": [item.to_dict() for item in citations],
            "context_tokens_approx": context_tokens_approx,
        }
        client = _build_client(llm_config)
        try:
            stream = await client.chat.completions.create(
                model=str(llm_config.get("model", "")).strip(),
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                stream=True,
                temperature=0.2,
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta.content if chunk.choices[0].delta is not None else None
                if delta:
                    yield {"type": "chunk", "delta": delta}
        except Exception as exc:  # noqa: BLE001
            yield {
                "type": "error",
                "error": {"code": "LLM_STREAM_ERROR", "message": str(exc)},
            }
            return
        yield {"type": "done"}


def _build_client(llm_config: dict[str, Any]) -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=str(llm_config.get("api_key", "")).strip(),
        base_url=str(llm_config.get("base_url", "")).strip(),
        timeout=float(llm_config.get("timeout_seconds", 120) or 120),
    )


def _build_prompts(*, query_text: str, hits: list[RetrievalHit]) -> tuple[str, str]:
    context_lines: list[str] = []
    for index, hit in enumerate(hits, start=1):
        context_lines.append(
            (
                f"[{index}] task={hit.task_title} source={hit.source} "
                f"time={hit.start:.2f}-{hit.end:.2f}s\n"
                f"evidence={hit.text}"
            )
        )
    context = "\n\n".join(context_lines)
    system_prompt = (
        "你是视频证据问答助手。"
        "回答必须基于证据上下文，不要编造。"
        "优先给出可验证结论，并在关键结论中体现时间锚点。"
    )
    user_prompt = (
        f"用户问题：{query_text.strip()}\n\n"
        "证据上下文如下：\n"
        f"{context if context else '(无命中证据)'}\n\n"
        "请输出中文回答，并在证据不足时明确说明。"
    )
    return system_prompt, user_prompt


def _build_citations(hits: list[RetrievalHit]) -> list[Citation]:
    return [
        Citation(
            doc_id=item.doc_id,
            task_id=item.task_id,
            task_title=item.task_title,
            source=item.source,
            start=item.start,
            end=item.end,
            text=item.text,
            image_path=item.image_path,
        )
        for item in hits
    ]


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)
