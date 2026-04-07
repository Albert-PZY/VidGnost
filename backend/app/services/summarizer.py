from __future__ import annotations

import asyncio
import base64
import gc
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Literal

import orjson
from openai import AsyncOpenAI

from app.config import Settings
from app.services.llm_client_runtime import OpenAICompatRuntime
from app.services.llm_config_store import LLMConfigStore
from app.services.prompt_constants import (
    AGGREGATE_SUMMARY_SECTION_TEMPLATE,
    CHAT_TRANSCRIPT_USER_CONTENT_TEMPLATE,
    REWRITE_TRANSCRIPT_PROMPT,
    REWRITE_TRANSCRIPT_USER_CONTENT_TEMPLATE,
    SLIDING_WINDOW_SUMMARY_PROMPT,
    SLIDING_WINDOW_USER_CONTENT_TEMPLATE,
    STRICT_CORRECTION_PROMPT,
    STRICT_CORRECTION_USER_CONTENT_TEMPLATE,
    WINDOW_AGGREGATE_ENTRY_TEMPLATE,
    WINDOW_AGGREGATE_PROMPT,
    WINDOW_AGGREGATE_USER_CONTENT_TEMPLATE,
    WINDOW_COMPRESS_USER_CONTENT_TEMPLATE,
)
from app.services.prompt_template_store import PromptTemplateStore

_JSON_CODE_FENCE_PATTERN = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", flags=re.IGNORECASE)
_MERMAID_CODE_FENCE_PATTERN = re.compile(r"```mermaid\s*([\s\S]*?)\s*```", flags=re.IGNORECASE)
_LOCAL_LLM_MODES = {"local", "api"}
_MAX_DIRECT_TRANSCRIPT_CHARS = 24000
_SUMMARY_WINDOW_CHARS = 9000
_SUMMARY_WINDOW_OVERLAP_CHARS = 1200
_SUMMARY_WINDOW_LIMIT = 16
_WINDOW_AGGREGATE_BATCH_SIZE = 4
_WINDOW_AGGREGATE_OVERLAP = 1
_CONTEXT_COMPRESS_MAX_ROUNDS = 2
_MERMAID_REPAIR_RETRIES = 3
_MERMAID_PLACEHOLDER_TEMPLATE = (
    "> [Mermaid 图示已省略：自动渲染失败（已重试 {retries} 次）。]"
)
_MERMAID_REPAIR_PROMPT = """你是一名 Mermaid 语法修复助手。

任务：
1. 输入内容中会给出一个渲染失败的 Mermaid 图示代码和错误信息；
2. 你必须输出一个可渲染、结构不失真的 Mermaid 代码块；
3. 代码必须优先保证 draw.io 导入兼容与 Mermaid 稳定渲染。

硬性约束：
- 仅输出一个 Mermaid 代码块，不输出解释。
- 仅允许 `flowchart` 或 `mindmap` 语法，不要使用实验性语法。
- 禁止 `%%{init...}%%`、`click`、`style`、`classDef`、HTML 标签。
- 节点文本使用短句纯文本，避免特殊符号与超长内容。
- 节点 ID 仅用英文字母、数字、下划线。
"""
StreamMode = Literal["realtime", "compat"]
PreviewSegment = dict[str, float | str]

@dataclass(slots=True)
class SummaryBundle:
    summary_markdown: str
    mindmap_markdown: str
    notes_markdown: str


@dataclass(slots=True)
class TranscriptCorrectionBundle:
    mode: Literal["off", "strict", "rewrite"]
    transcript_text: str
    summary_input_text: str
    segments: list[dict[str, float | str]]
    fallback_used: bool = False
    message: str = ""


class LLMService:
    def __init__(
        self,
        settings: Settings,
        llm_config_store: LLMConfigStore,
        prompt_template_store: PromptTemplateStore,
    ) -> None:
        self._settings = settings
        self._config_store = llm_config_store
        self._prompt_template_store = prompt_template_store
        self._local_model_cache_root = Path(settings.storage_dir) / "model-hub"
        self._local_model_cache_root.mkdir(parents=True, exist_ok=True)
        self._project_root = Path(__file__).resolve().parents[3]
        self._frontend_dir = self._project_root / "frontend"
        self._local_llm_runtime: dict[str, tuple[Any, Any]] = {}
        self._api_runtime = OpenAICompatRuntime(component="llm")
        self._api_disable_thinking_support: dict[str, bool] = {}
        self._mermaid_renderer_command: list[str] | None = None
        self._mermaid_renderer_checked = False

    async def generate(
        self,
        title: str,
        transcript_text: str,
        on_summary_delta: Callable[[str, StreamMode], Awaitable[None]] | None = None,
        on_mindmap_delta: Callable[[str, StreamMode], Awaitable[None]] | None = None,
        on_fusion_prompt_preview: Callable[[str], Awaitable[None]] | None = None,
        llm_config_override: dict[str, object] | None = None,
    ) -> SummaryBundle:
        transcript_text = transcript_text.strip()
        if not transcript_text:
            raise ValueError("Empty transcript text")

        llm_config = dict(llm_config_override) if llm_config_override is not None else await self._config_store.get()
        mode = _normalize_llm_mode(llm_config.get("mode"))
        load_profile = _normalize_load_profile(llm_config.get("load_profile"))
        client = self._build_client(llm_config)
        model_name = str(llm_config.get("model", self._settings.llm_model)).strip() or self._settings.llm_model
        local_model_id = str(llm_config.get("local_model_id", self._settings.llm_local_model_id)).strip() or self._settings.llm_local_model_id
        summary_prompt, mindmap_prompt = await self._prompt_template_store.resolve_selected_prompts()
        if self._settings.enable_mock_llm:
            raise RuntimeError("LLM_ALL_UNAVAILABLE: Mock summary generation is disabled.")

        try:
            attempts: list[str] = []
            summary: str | None = None
            mindmap: str | None = None
            resolved_llm_mode: Literal["api", "local"] | None = None
            resolved_model_name = ""
            resolved_client: AsyncOpenAI | None = None
            prompt_preview_sent = False
            preferred_modes: tuple[Literal["local", "api"], Literal["local", "api"]] = (
                ("local", "api") if mode == "local" else ("api", "local")
            )

            for current_mode in preferred_modes:
                if current_mode == "api":
                    if client is None:
                        attempts.append("api unavailable: api_key is empty or client init failed")
                        continue
                    try:
                        async def summary_realtime_delta(delta: str) -> None:
                            if on_summary_delta is None:
                                return
                            await on_summary_delta(delta, "realtime")

                        async def mindmap_realtime_delta(delta: str) -> None:
                            if on_mindmap_delta is None:
                                return
                            await on_mindmap_delta(delta, "realtime")

                        summary_context = await self._build_summary_context(
                            title=title,
                            transcript_text=transcript_text,
                            llm_mode="api",
                            client=client,
                            model_name=model_name,
                        )
                        summary_user_content = CHAT_TRANSCRIPT_USER_CONTENT_TEMPLATE.format(
                            title=title,
                            transcript=summary_context[:_MAX_DIRECT_TRANSCRIPT_CHARS],
                        )
                        if on_fusion_prompt_preview is not None and not prompt_preview_sent:
                            await on_fusion_prompt_preview(
                                self._build_fusion_prompt_preview(
                                    llm_mode="api",
                                    model_name=model_name,
                                    instruction=summary_prompt,
                                    user_content=summary_user_content,
                                )
                            )
                            prompt_preview_sent = True
                        summary, mindmap = await asyncio.gather(
                            self._chat_markdown_stream(
                                client=client,
                                instruction=summary_prompt,
                                title=title,
                                transcript=summary_context,
                                model_name=model_name,
                                on_delta=summary_realtime_delta if on_summary_delta else None,
                            ),
                            self._chat_markdown_stream(
                                client=client,
                                instruction=mindmap_prompt,
                                title=title,
                                transcript=summary_context,
                                model_name=model_name,
                                on_delta=mindmap_realtime_delta if on_mindmap_delta else None,
                            ),
                        )
                        resolved_llm_mode = "api"
                        resolved_model_name = model_name
                        resolved_client = client
                        break
                    except Exception as exc:  # noqa: BLE001
                        attempts.append(f"api failed: {type(exc).__name__}: {exc}")
                        continue

                try:
                    summary_context = await self._build_summary_context(
                        title=title,
                        transcript_text=transcript_text,
                        llm_mode="local",
                        client=None,
                        model_name=local_model_id,
                    )
                    summary_user_content = CHAT_TRANSCRIPT_USER_CONTENT_TEMPLATE.format(
                        title=title,
                        transcript=summary_context[:_MAX_DIRECT_TRANSCRIPT_CHARS],
                    )
                    if on_fusion_prompt_preview is not None and not prompt_preview_sent:
                        await on_fusion_prompt_preview(
                            self._build_fusion_prompt_preview(
                                llm_mode="local",
                                model_name=local_model_id,
                                instruction=summary_prompt,
                                user_content=summary_user_content,
                            )
                        )
                        prompt_preview_sent = True
                    summary, mindmap = await asyncio.gather(
                        self._chat_markdown_once_local(
                            model_id=local_model_id,
                            instruction=summary_prompt,
                            user_content=summary_user_content,
                            temperature=0.25,
                        ),
                        self._chat_markdown_once_local(
                            model_id=local_model_id,
                            instruction=mindmap_prompt,
                            user_content=CHAT_TRANSCRIPT_USER_CONTENT_TEMPLATE.format(
                                title=title,
                                transcript=summary_context[:_MAX_DIRECT_TRANSCRIPT_CHARS],
                            ),
                            temperature=0.2,
                        ),
                    )
                    if on_summary_delta and summary:
                        await self._emit_compat_deltas(summary, on_summary_delta)
                    if on_mindmap_delta and mindmap:
                        await self._emit_compat_deltas(mindmap, on_mindmap_delta)
                    resolved_llm_mode = "local"
                    resolved_model_name = local_model_id
                    resolved_client = None
                    break
                except Exception as exc:  # noqa: BLE001
                    attempts.append(f"local failed: {type(exc).__name__}: {exc}")
                    continue

            if summary is None or mindmap is None:
                reason = " | ".join(attempts).strip() or "no available llm runtime"
                if len(reason) > 460:
                    reason = f"{reason[:457]}..."
                raise RuntimeError(f"LLM_ALL_UNAVAILABLE: {reason}")
            if resolved_llm_mode is None:
                raise RuntimeError("LLM_ALL_UNAVAILABLE: unresolved generation runtime")
            structured_summary = _normalize_summary_markdown_structure(summary)
            if structured_summary:
                summary = structured_summary
            summary = await self._replace_mermaid_with_images(
                markdown=summary,
                llm_mode=resolved_llm_mode,
                client=resolved_client,
                model_name=resolved_model_name,
            )
            notes = self._compose_notes(title=title, summary=summary)
            return SummaryBundle(summary_markdown=summary, mindmap_markdown=mindmap, notes_markdown=notes)
        finally:
            if mode == "local" and load_profile == "memory_first":
                self.release_runtime_models()

    async def correct_transcript(
        self,
        title: str,
        transcript_text: str,
        segments: list[dict[str, float | str]],
        llm_config_override: dict[str, object] | None = None,
        on_preview_delta: Callable[[str, StreamMode], Awaitable[None]] | None = None,
        on_preview_segment: Callable[[PreviewSegment, StreamMode], Awaitable[None]] | None = None,
    ) -> TranscriptCorrectionBundle:
        normalized_segments = _normalize_segments(segments)
        normalized_text = transcript_text.strip() or _join_segment_texts(normalized_segments)
        if not normalized_text:
            return TranscriptCorrectionBundle(
                mode="off",
                transcript_text="",
                summary_input_text="",
                segments=normalized_segments,
                fallback_used=True,
                message="Transcript is empty, skip correction.",
            )

        llm_config = dict(llm_config_override) if llm_config_override is not None else await self._config_store.get()
        mode = _normalize_correction_mode(llm_config.get("correction_mode"))
        load_profile = _normalize_load_profile(llm_config.get("load_profile"))
        if mode == "off":
            return TranscriptCorrectionBundle(
                mode="off",
                transcript_text=normalized_text,
                summary_input_text=normalized_text,
                segments=normalized_segments,
                message="Correction mode is off.",
            )

        llm_mode = _normalize_llm_mode(llm_config.get("mode"))
        client = self._build_client(llm_config)
        if self._settings.enable_mock_llm:
            return TranscriptCorrectionBundle(
                mode=mode,
                transcript_text=normalized_text,
                summary_input_text=normalized_text,
                segments=normalized_segments,
                fallback_used=True,
                message="Mock LLM is enabled, fallback to original transcript.",
            )
        if llm_mode == "api" and client is None:
            return TranscriptCorrectionBundle(
                mode=mode,
                transcript_text=normalized_text,
                summary_input_text=normalized_text,
                segments=normalized_segments,
                fallback_used=True,
                message="LLM API client unavailable, fallback to original transcript.",
            )

        model_name = (
            str(llm_config.get("local_model_id", self._settings.llm_local_model_id)).strip()
            if llm_mode == "local"
            else str(llm_config.get("model", self._settings.llm_model)).strip()
        ) or self._settings.llm_model
        try:
            if mode == "rewrite":
                try:
                    rewritten = await self._rewrite_transcript_text(
                        llm_mode=llm_mode,
                        client=client,
                        model_name=model_name,
                        title=title,
                        transcript_text=normalized_text,
                        on_preview_delta=on_preview_delta,
                    )
                except Exception as exc:  # noqa: BLE001
                    return TranscriptCorrectionBundle(
                        mode=mode,
                        transcript_text=normalized_text,
                        summary_input_text=normalized_text,
                        segments=normalized_segments,
                        fallback_used=True,
                        message=f"Rewrite correction failed: {type(exc).__name__}: {exc}",
                    )
                if not rewritten.strip():
                    return TranscriptCorrectionBundle(
                        mode=mode,
                        transcript_text=normalized_text,
                        summary_input_text=normalized_text,
                        segments=normalized_segments,
                        fallback_used=True,
                        message="Rewrite correction returned empty payload, fallback to original transcript.",
                    )
                return TranscriptCorrectionBundle(
                    mode=mode,
                    transcript_text=normalized_text,
                    summary_input_text=rewritten.strip(),
                    segments=normalized_segments,
                    message="Rewrite correction completed.",
                )

            if not normalized_segments:
                return TranscriptCorrectionBundle(
                    mode="strict",
                    transcript_text=normalized_text,
                    summary_input_text=normalized_text,
                    segments=normalized_segments,
                    fallback_used=True,
                    message="Strict correction requires transcript segments, fallback to original transcript.",
                )

            batch_size = _bounded_int(
                llm_config.get("correction_batch_size"),
                fallback=self._settings.llm_correction_batch_size,
                minimum=6,
                maximum=80,
            )
            overlap = _bounded_int(
                llm_config.get("correction_overlap"),
                fallback=self._settings.llm_correction_overlap,
                minimum=0,
                maximum=20,
            )
            if overlap >= batch_size:
                overlap = max(0, batch_size - 1)

            try:
                corrected_segments = await self._correct_transcript_strict(
                    llm_mode=llm_mode,
                    client=client,
                    model_name=model_name,
                    title=title,
                    segments=normalized_segments,
                    batch_size=batch_size,
                    overlap=overlap,
                    on_preview_delta=on_preview_delta,
                    on_preview_segment=on_preview_segment,
                )
            except Exception as exc:  # noqa: BLE001
                return TranscriptCorrectionBundle(
                    mode="strict",
                    transcript_text=normalized_text,
                    summary_input_text=normalized_text,
                    segments=normalized_segments,
                    fallback_used=True,
                    message=f"Strict correction failed: {type(exc).__name__}: {exc}",
                )

            if corrected_segments is None:
                return TranscriptCorrectionBundle(
                    mode="strict",
                    transcript_text=normalized_text,
                    summary_input_text=normalized_text,
                    segments=normalized_segments,
                    fallback_used=True,
                    message="Strict correction validation failed, fallback to original transcript.",
                )

            corrected_text = _join_segment_texts(corrected_segments) or normalized_text
            return TranscriptCorrectionBundle(
                mode="strict",
                transcript_text=corrected_text,
                summary_input_text=corrected_text,
                segments=corrected_segments,
                message="Strict correction completed with timeline preserved.",
            )
        finally:
            if llm_mode == "local" and load_profile == "memory_first":
                self.release_runtime_models()

    def _build_client(self, llm_config: dict) -> AsyncOpenAI | None:
        mode = _normalize_llm_mode(llm_config.get("mode"))
        if mode != "api":
            return None
        api_key = llm_config.get("api_key", "").strip()
        if not api_key:
            return None
        return AsyncOpenAI(
            api_key=api_key,
            base_url=llm_config.get("base_url", self._settings.llm_base_url),
            timeout=self._settings.llm_timeout_seconds,
        )

    async def _chat_completions_create_with_thinking_disabled(
        self,
        *,
        client: AsyncOpenAI,
        model_name: str,
        stream: bool,
        messages: list[dict[str, object]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> Any:
        base_kwargs: dict[str, object] = {
            "model": model_name,
            "stream": stream,
            "messages": messages,
        }
        if temperature is not None:
            base_kwargs["temperature"] = temperature
        if isinstance(max_tokens, int) and max_tokens > 0:
            base_kwargs["max_tokens"] = max_tokens

        base_url = str(getattr(client, "base_url", "") or "")
        support_cache_key = f"{base_url}|{model_name}"
        supports_disable_thinking = self._api_disable_thinking_support.get(support_cache_key, True)
        if supports_disable_thinking:
            try:
                response = await client.chat.completions.create(
                    **base_kwargs,
                    extra_body={"enable_thinking": False},
                )
                self._api_disable_thinking_support[support_cache_key] = True
                return response
            except Exception as exc:  # noqa: BLE001
                if not _is_unsupported_thinking_param_error(exc):
                    raise
                self._api_disable_thinking_support[support_cache_key] = False
        return await client.chat.completions.create(**base_kwargs)

    async def _chat_markdown_stream(
        self,
        client: AsyncOpenAI,
        instruction: str,
        title: str,
        transcript: str,
        model_name: str,
        on_delta: Callable[[str], Awaitable[None]] | None = None,
    ) -> str:
        async def request_stream() -> Any:
            return await self._chat_completions_create_with_thinking_disabled(
                client=client,
                model_name=model_name,
                stream=True,
                temperature=0.3,
                max_tokens=1800,
                messages=[
                    {"role": "system", "content": instruction},
                    {
                        "role": "user",
                        "content": CHAT_TRANSCRIPT_USER_CONTENT_TEMPLATE.format(
                            title=title,
                            transcript=transcript[:_MAX_DIRECT_TRANSCRIPT_CHARS],
                        ),
                    },
                ],
            )

        stream = await self._api_runtime.call_async(
            key=f"{str(getattr(client, 'base_url', ''))}:stream:{model_name}",
            request_factory=request_stream,
        )
        chunks: list[str] = []
        async for item in stream:
            if not item.choices:
                continue
            delta = item.choices[0].delta.content or ""
            if delta:
                chunks.append(delta)
                if on_delta:
                    await on_delta(delta)
        return "".join(chunks).strip()

    async def _chat_markdown_once(
        self,
        client: AsyncOpenAI,
        model_name: str,
        instruction: str,
        user_content: str,
        *,
        temperature: float = 0.1,
        max_tokens: int | None = None,
    ) -> str:
        async def request_once() -> Any:
            return await self._chat_completions_create_with_thinking_disabled(
                client=client,
                model_name=model_name,
                stream=False,
                temperature=temperature,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": instruction},
                    {"role": "user", "content": user_content},
                ],
            )

        completion = await self._api_runtime.call_async(
            key=f"{str(getattr(client, 'base_url', ''))}:once:{model_name}",
            request_factory=request_once,
        )
        if not completion.choices:
            return ""
        content = completion.choices[0].message.content
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                text = getattr(item, "text", None)
                if isinstance(text, str):
                    parts.append(text)
            return "".join(parts).strip()
        return ""

    async def _chat_markdown_once_stream(
        self,
        *,
        client: AsyncOpenAI,
        model_name: str,
        instruction: str,
        user_content: str,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        on_delta: Callable[[str], Awaitable[None]] | None = None,
    ) -> str:
        async def request_stream() -> Any:
            return await self._chat_completions_create_with_thinking_disabled(
                client=client,
                model_name=model_name,
                stream=True,
                temperature=temperature,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": instruction},
                    {"role": "user", "content": user_content},
                ],
            )

        stream = await self._api_runtime.call_async(
            key=f"{str(getattr(client, 'base_url', ''))}:stream:{model_name}",
            request_factory=request_stream,
        )
        chunks: list[str] = []
        async for item in stream:
            if not item.choices:
                continue
            delta = item.choices[0].delta.content or ""
            if not delta:
                continue
            chunks.append(delta)
            if on_delta is not None:
                await on_delta(delta)
        return "".join(chunks).strip()

    async def _chat_markdown_once_by_mode(
        self,
        *,
        llm_mode: Literal["api", "local"],
        client: AsyncOpenAI | None,
        model_name: str,
        instruction: str,
        user_content: str,
        temperature: float,
        max_tokens: int | None = None,
    ) -> str:
        if llm_mode == "local":
            return await self._chat_markdown_once_local(
                model_id=model_name,
                instruction=instruction,
                user_content=user_content,
                temperature=temperature,
                max_new_tokens=max_tokens,
            )
        if client is None:
            raise RuntimeError("LLM API client unavailable in api mode")
        return await self._chat_markdown_once(
            client=client,
            model_name=model_name,
            instruction=instruction,
            user_content=user_content,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def _build_summary_context(
        self,
        *,
        title: str,
        transcript_text: str,
        llm_mode: Literal["api", "local"],
        client: AsyncOpenAI | None,
        model_name: str,
    ) -> str:
        normalized = transcript_text.strip()
        if not normalized:
            return ""
        windows = _build_text_windows(
            normalized,
            window_chars=_SUMMARY_WINDOW_CHARS,
            overlap_chars=_SUMMARY_WINDOW_OVERLAP_CHARS,
            max_windows=_SUMMARY_WINDOW_LIMIT,
        )
        if len(windows) <= 1:
            return normalized[:_MAX_DIRECT_TRANSCRIPT_CHARS]

        window_summaries: list[str] = []
        for index, window in enumerate(windows):
            user_content = SLIDING_WINDOW_USER_CONTENT_TEMPLATE.format(
                title=title,
                window_index=index + 1,
                window_total=len(windows),
                window_text=window[:_MAX_DIRECT_TRANSCRIPT_CHARS],
            )
            chunk_summary = await self._chat_markdown_once_by_mode(
                llm_mode=llm_mode,
                client=client,
                model_name=model_name,
                instruction=SLIDING_WINDOW_SUMMARY_PROMPT,
                user_content=user_content,
                temperature=0.0,
            )
            normalized_chunk = chunk_summary.strip()
            if not normalized_chunk:
                normalized_chunk = window[: min(1200, len(window))]
            window_summaries.append(normalized_chunk)

        aggregate_chunks = _build_window_groups(
            window_summaries,
            batch_size=_WINDOW_AGGREGATE_BATCH_SIZE,
            overlap=_WINDOW_AGGREGATE_OVERLAP,
        )
        aggregated_summaries: list[str] = []
        for index, chunk_group in enumerate(aggregate_chunks):
            joined = "\n\n".join(
                WINDOW_AGGREGATE_ENTRY_TEMPLATE.format(
                    segment_index=offset + 1,
                    segment_content=item,
                )
                for offset, item in enumerate(chunk_group)
            )
            aggregate_summary = await self._chat_markdown_once_by_mode(
                llm_mode=llm_mode,
                client=client,
                model_name=model_name,
                instruction=WINDOW_AGGREGATE_PROMPT,
                user_content=WINDOW_AGGREGATE_USER_CONTENT_TEMPLATE.format(
                    title=title,
                    batch_index=index + 1,
                    batch_total=len(aggregate_chunks),
                    joined_content=joined[:_MAX_DIRECT_TRANSCRIPT_CHARS],
                ),
                temperature=0.0,
            )
            normalized_aggregate = aggregate_summary.strip()
            if not normalized_aggregate:
                normalized_aggregate = joined[: min(2400, len(joined))]
            aggregated_summaries.append(normalized_aggregate)

        if not aggregated_summaries:
            aggregated_summaries = window_summaries
        context = "\n\n".join(
            AGGREGATE_SUMMARY_SECTION_TEMPLATE.format(
                section_index=index + 1,
                section_content=item,
            )
            for index, item in enumerate(aggregated_summaries)
            if item.strip()
        ).strip()
        if not context:
            context = normalized
        return await self._compress_context_to_limit(
            title=title,
            llm_mode=llm_mode,
            client=client,
            model_name=model_name,
            context=context,
        )

    async def _compress_context_to_limit(
        self,
        *,
        title: str,
        llm_mode: Literal["api", "local"],
        client: AsyncOpenAI | None,
        model_name: str,
        context: str,
    ) -> str:
        current = context.strip()
        if len(current) <= _MAX_DIRECT_TRANSCRIPT_CHARS:
            return current

        for round_index in range(_CONTEXT_COMPRESS_MAX_ROUNDS):
            candidate = await self._chat_markdown_once_by_mode(
                llm_mode=llm_mode,
                client=client,
                model_name=model_name,
                instruction=WINDOW_AGGREGATE_PROMPT,
                user_content=WINDOW_COMPRESS_USER_CONTENT_TEMPLATE.format(
                    title=title,
                    round_index=round_index + 1,
                    round_total=_CONTEXT_COMPRESS_MAX_ROUNDS,
                    context_text=current[: _MAX_DIRECT_TRANSCRIPT_CHARS * 2],
                ),
                temperature=0.0,
            )
            normalized_candidate = candidate.strip()
            if not normalized_candidate:
                break
            if len(normalized_candidate) >= len(current):
                break
            current = normalized_candidate
            if len(current) <= _MAX_DIRECT_TRANSCRIPT_CHARS:
                return current
        return current[:_MAX_DIRECT_TRANSCRIPT_CHARS]

    async def _correct_transcript_strict(
        self,
        llm_mode: Literal["api", "local"],
        client: AsyncOpenAI | None,
        model_name: str,
        title: str,
        segments: list[dict[str, float | str]],
        *,
        batch_size: int,
        overlap: int,
        on_preview_delta: Callable[[str, StreamMode], Awaitable[None]] | None = None,
        on_preview_segment: Callable[[PreviewSegment, StreamMode], Awaitable[None]] | None = None,
    ) -> list[dict[str, float | str]] | None:
        total = len(segments)
        if total == 0:
            return []

        step = max(1, batch_size - overlap)
        corrected_texts: list[str] = []

        for batch_start in range(0, total, step):
            batch_end = min(total, batch_start + batch_size)
            batch = segments[batch_start:batch_end]
            indexed_segments = [
                {"index": batch_start + idx, "text": str(segment.get("text", ""))}
                for idx, segment in enumerate(batch)
            ]
            payload = orjson.dumps(indexed_segments).decode("utf-8")
            user_content = STRICT_CORRECTION_USER_CONTENT_TEMPLATE.format(
                title=title,
                segments_payload=payload,
            )
            if llm_mode == "local":
                raw = await self._chat_markdown_once_local(
                    model_id=model_name,
                    instruction=STRICT_CORRECTION_PROMPT,
                    user_content=user_content,
                    temperature=0.0,
                    max_new_tokens=720,
                )
            else:
                if client is None:
                    return None
                raw = await self._chat_markdown_once(
                    client=client,
                    model_name=model_name,
                    instruction=STRICT_CORRECTION_PROMPT,
                    user_content=user_content,
                    temperature=0.0,
                    max_tokens=720,
                )
            expected_indices = list(range(batch_start, batch_end))
            parsed = _parse_strict_correction_response(raw, expected_indices)
            if parsed is None:
                return None

            skip_count = 0 if batch_start == 0 else min(overlap, len(parsed))
            appended_texts = parsed[skip_count:]
            corrected_texts.extend(appended_texts)

            if on_preview_segment is not None:
                for offset, corrected_text in enumerate(appended_texts):
                    if not corrected_text.strip():
                        continue
                    segment_index = batch_start + skip_count + offset
                    if segment_index >= len(segments):
                        break
                    source_segment = segments[segment_index]
                    await on_preview_segment(
                        {
                            "start": round(_to_float(source_segment.get("start")), 2),
                            "end": round(_to_float(source_segment.get("end")), 2),
                            "text": corrected_text.strip(),
                        },
                        "compat",
                    )
            elif on_preview_delta is not None:
                preview_delta = "\n".join(text.strip() for text in appended_texts if text.strip()).strip()
                if preview_delta:
                    await self._emit_compat_deltas(f"{preview_delta}\n", on_preview_delta)

            if batch_end >= total:
                break

        if len(corrected_texts) > total:
            corrected_texts = corrected_texts[:total]
        if len(corrected_texts) != total:
            return None

        corrected_segments: list[dict[str, float | str]] = []
        for idx, segment in enumerate(segments):
            fallback_text = str(segment.get("text", "")).strip()
            next_text = corrected_texts[idx].strip() or fallback_text
            corrected_segments.append(
                {
                    "start": round(_to_float(segment.get("start")), 2),
                    "end": round(_to_float(segment.get("end")), 2),
                    "text": next_text,
                }
            )
        return corrected_segments

    async def _rewrite_transcript_text(
        self,
        llm_mode: Literal["api", "local"],
        client: AsyncOpenAI | None,
        model_name: str,
        title: str,
        transcript_text: str,
        on_preview_delta: Callable[[str, StreamMode], Awaitable[None]] | None = None,
    ) -> str:
        user_content = REWRITE_TRANSCRIPT_USER_CONTENT_TEMPLATE.format(
            title=title,
            transcript_text=transcript_text[:28000],
        )
        if llm_mode == "local":
            rewritten = await self._chat_markdown_once_local(
                model_id=model_name,
                instruction=REWRITE_TRANSCRIPT_PROMPT,
                user_content=user_content,
                temperature=0.2,
            )
            if on_preview_delta and rewritten.strip():
                await self._emit_compat_deltas(rewritten.strip(), on_preview_delta)
        else:
            if client is None:
                return ""
            async def realtime_delta(delta: str) -> None:
                if on_preview_delta is None:
                    return
                await on_preview_delta(delta, "realtime")

            if on_preview_delta is None:
                rewritten = await self._chat_markdown_once(
                    client=client,
                    model_name=model_name,
                    instruction=REWRITE_TRANSCRIPT_PROMPT,
                    user_content=user_content,
                    temperature=0.2,
                )
            else:
                rewritten = await self._chat_markdown_once_stream(
                    client=client,
                    model_name=model_name,
                    instruction=REWRITE_TRANSCRIPT_PROMPT,
                    user_content=user_content,
                    temperature=0.2,
                    on_delta=realtime_delta,
                )
        return rewritten.strip()

    async def _replace_mermaid_with_images(
        self,
        *,
        markdown: str,
        llm_mode: Literal["api", "local"],
        client: AsyncOpenAI | None,
        model_name: str,
    ) -> str:
        normalized = markdown.strip()
        if "```mermaid" not in normalized.lower():
            return normalized

        matches = list(_MERMAID_CODE_FENCE_PATTERN.finditer(normalized))
        if not matches:
            return normalized

        parts: list[str] = []
        cursor = 0
        for index, match in enumerate(matches, start=1):
            parts.append(normalized[cursor:match.start()])
            original_code = _normalize_mermaid_code(match.group(1))
            replacement = await self._render_mermaid_block_with_retry(
                block_index=index,
                original_code=original_code,
                llm_mode=llm_mode,
                client=client,
                model_name=model_name,
            )
            parts.append(replacement)
            cursor = match.end()
        parts.append(normalized[cursor:])
        return "".join(parts).strip()

    async def _render_mermaid_block_with_retry(
        self,
        *,
        block_index: int,
        original_code: str,
        llm_mode: Literal["api", "local"],
        client: AsyncOpenAI | None,
        model_name: str,
    ) -> str:
        current_code = original_code
        data_url, error_reason = await self._render_mermaid_png_data_url(current_code)
        if data_url:
            return self._build_mermaid_image_markdown(block_index, data_url)
        if _is_mermaid_renderer_unavailable(error_reason):
            return _MERMAID_PLACEHOLDER_TEMPLATE.format(retries=0)

        for _ in range(1, _MERMAID_REPAIR_RETRIES + 1):
            repaired_code = await self._repair_mermaid_code(
                llm_mode=llm_mode,
                client=client,
                model_name=model_name,
                broken_code=current_code,
                error_reason=error_reason,
            )
            if not repaired_code:
                continue
            current_code = repaired_code
            data_url, error_reason = await self._render_mermaid_png_data_url(current_code)
            if data_url:
                return self._build_mermaid_image_markdown(block_index, data_url)
            if _is_mermaid_renderer_unavailable(error_reason):
                break

        return _MERMAID_PLACEHOLDER_TEMPLATE.format(retries=_MERMAID_REPAIR_RETRIES)

    async def _repair_mermaid_code(
        self,
        *,
        llm_mode: Literal["api", "local"],
        client: AsyncOpenAI | None,
        model_name: str,
        broken_code: str,
        error_reason: str,
    ) -> str | None:
        user_content = (
            "请修复下面 Mermaid 代码，输出一个可渲染且 draw.io 可导入的 Mermaid 代码块。\n\n"
            "错误信息：\n"
            f"{error_reason or 'unknown'}\n\n"
            "原始代码：\n"
            "```mermaid\n"
            f"{broken_code}\n"
            "```"
        )
        try:
            repaired_raw = await self._chat_markdown_once_by_mode(
                llm_mode=llm_mode,
                client=client,
                model_name=model_name,
                instruction=_MERMAID_REPAIR_PROMPT,
                user_content=user_content,
                temperature=0.0,
                max_tokens=720,
            )
        except Exception:  # noqa: BLE001
            return None
        repaired_code = _extract_mermaid_code(repaired_raw)
        if not repaired_code:
            return None
        return repaired_code

    def _build_mermaid_image_markdown(self, block_index: int, data_url: str) -> str:
        return f"![Mermaid 图示 {block_index}]({data_url})"

    async def _render_mermaid_png_data_url(self, mermaid_code: str) -> tuple[str | None, str]:
        return await asyncio.to_thread(self._render_mermaid_png_data_url_sync, mermaid_code)

    def _render_mermaid_png_data_url_sync(self, mermaid_code: str) -> tuple[str | None, str]:
        command_prefix = self._resolve_mermaid_renderer_command_sync()
        if command_prefix is None:
            return (None, "renderer_unavailable: mmdc and pnpm are unavailable")
        if not mermaid_code.strip():
            return (None, "empty mermaid code")

        with tempfile.TemporaryDirectory(prefix="vg-mermaid-") as temp_dir:
            input_path = Path(temp_dir) / "diagram.mmd"
            output_path = Path(temp_dir) / "diagram.png"
            input_path.write_text(mermaid_code, encoding="utf-8")
            command = [
                *command_prefix,
                "-i",
                str(input_path),
                "-o",
                str(output_path),
                "-b",
                "white",
                "-t",
                "default",
                "-s",
                "2",
            ]
            try:
                result = subprocess.run(
                    command,
                    cwd=str(self._project_root),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=180,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                return (None, f"{type(exc).__name__}: {exc}")
            if result.returncode != 0:
                detail = (result.stderr or result.stdout or f"exit={result.returncode}").strip()
                if len(detail) > 320:
                    detail = f"{detail[:317]}..."
                return (None, detail)
            if not output_path.exists() or output_path.stat().st_size <= 0:
                return (None, "mmdc completed but output image is empty")
            encoded = base64.b64encode(output_path.read_bytes()).decode("ascii")
            return (f"data:image/png;base64,{encoded}", "")

    def _resolve_mermaid_renderer_command_sync(self) -> list[str] | None:
        if self._mermaid_renderer_checked:
            if self._mermaid_renderer_command is None:
                return None
            return list(self._mermaid_renderer_command)

        mmdc = shutil.which("mmdc")
        if mmdc:
            self._mermaid_renderer_command = [mmdc]
            self._mermaid_renderer_checked = True
            return list(self._mermaid_renderer_command)

        pnpm = shutil.which("pnpm")
        if pnpm:
            frontend_dir = str(self._frontend_dir)
            probe: subprocess.CompletedProcess[str] | None = None
            try:
                probe = subprocess.run(
                    [pnpm, "--dir", frontend_dir, "exec", "mmdc", "--version"],
                    cwd=str(self._project_root),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
            except (OSError, subprocess.TimeoutExpired):
                probe = None
            if probe is not None and probe.returncode == 0:
                self._mermaid_renderer_command = [pnpm, "--dir", frontend_dir, "exec", "mmdc"]
            else:
                self._mermaid_renderer_command = [
                    pnpm,
                    "--dir",
                    frontend_dir,
                    "dlx",
                    "@mermaid-js/mermaid-cli@11.4.0",
                ]
            self._mermaid_renderer_checked = True
            return list(self._mermaid_renderer_command)

        self._mermaid_renderer_command = None
        self._mermaid_renderer_checked = True
        return None

    async def _emit_compat_deltas(
        self,
        text: str,
        callback: Callable[[str, StreamMode], Awaitable[None]],
    ) -> None:
        if not text:
            return
        await callback(text, "compat")

    async def _chat_markdown_once_local(
        self,
        model_id: str,
        instruction: str,
        user_content: str,
        *,
        temperature: float = 0.2,
        max_new_tokens: int | None = None,
    ) -> str:
        return await asyncio.to_thread(
            self._chat_markdown_once_local_sync,
            model_id,
            instruction,
            user_content,
            temperature,
            max_new_tokens,
        )

    def _chat_markdown_once_local_sync(
        self,
        model_id: str,
        instruction: str,
        user_content: str,
        temperature: float,
        max_new_tokens: int | None,
    ) -> str:
        tokenizer, model = self._get_or_create_local_llm_runtime(model_id)
        messages = [
            {"role": "system", "content": instruction},
            {"role": "user", "content": user_content},
        ]
        if hasattr(tokenizer, "apply_chat_template"):
            try:
                prompt = tokenizer.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=True,
                    enable_thinking=False,
                )
            except TypeError:
                prompt = tokenizer.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=True,
                )
        else:
            prompt = f"[SYSTEM]\n{instruction}\n\n[USER]\n{user_content}\n\n[ASSISTANT]\n"
        inputs = tokenizer(prompt, return_tensors="pt")
        device = getattr(model, "device", None)
        if device is not None:
            inputs = {key: value.to(device) for key, value in inputs.items()}
        safe_max_new_tokens = 1200
        if isinstance(max_new_tokens, int) and max_new_tokens > 0:
            safe_max_new_tokens = max(32, min(2048, max_new_tokens))
        generate_kwargs: dict[str, Any] = {
            "max_new_tokens": safe_max_new_tokens,
        }
        # Only pass sampling knobs when sampling is enabled; otherwise
        # transformers may warn that temperature/top_p/top_k are ignored.
        if temperature > 0.0:
            generate_kwargs.update(
                {
                    "do_sample": True,
                    "temperature": max(0.01, temperature),
                    "top_p": 0.9,
                }
            )
        generated = model.generate(
            **inputs,
            **generate_kwargs,
        )
        input_length = int(inputs["input_ids"].shape[-1])
        output_tokens = generated[0][input_length:]
        return tokenizer.decode(output_tokens, skip_special_tokens=True).strip()

    def _get_or_create_local_llm_runtime(self, model_id: str) -> tuple[Any, Any]:
        if model_id in self._local_llm_runtime:
            return self._local_llm_runtime[model_id]

        _ensure_torch_cuda_ready(component="LLM")
        from transformers import AutoModelForCausalLM, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(
            model_id,
            cache_dir=str(self._local_model_cache_root),
            trust_remote_code=True,
            local_files_only=True,
        )
        model = AutoModelForCausalLM.from_pretrained(
            model_id,
            cache_dir=str(self._local_model_cache_root),
            trust_remote_code=True,
            device_map="auto",
            torch_dtype="auto",
            local_files_only=True,
        )
        self._local_llm_runtime[model_id] = (tokenizer, model)
        return tokenizer, model

    def release_runtime_models(self) -> None:
        if not self._local_llm_runtime:
            return
        self._local_llm_runtime.clear()
        gc.collect()
        _clear_torch_cuda_cache()

    @staticmethod
    def _compose_notes(title: str, summary: str) -> str:
        return (
            f"# {title}\n\n"
            "## 详细笔记\n\n"
            f"{summary}\n"
        )

    @staticmethod
    def _build_fusion_prompt_preview(
        *,
        llm_mode: Literal["api", "local"],
        model_name: str,
        instruction: str,
        user_content: str,
    ) -> str:
        normalized_instruction = instruction.strip()
        normalized_user_content = user_content.strip()
        return (
            "# 最终输入给 LLM 的提示词（用于整理笔记）\n\n"
            f"- 模式: `{llm_mode}`\n"
            f"- 模型: `{model_name}`\n\n"
            "## System\n\n"
            "~~~text\n"
            f"{normalized_instruction}\n"
            "~~~\n\n"
            "## User\n\n"
            "~~~text\n"
            f"{normalized_user_content}\n"
            "~~~"
        )


def _build_text_windows(
    text: str,
    *,
    window_chars: int,
    overlap_chars: int,
    max_windows: int,
) -> list[str]:
    cleaned = text.strip()
    if not cleaned:
        return []
    safe_window = max(200, window_chars)
    safe_overlap = max(0, min(overlap_chars, safe_window - 1))
    step = max(1, safe_window - safe_overlap)
    windows: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + safe_window)
        window = cleaned[start:end].strip()
        if window:
            windows.append(window)
        if end >= len(cleaned):
            break
        start += step
    if not windows:
        windows.append(cleaned[:safe_window])
        return windows

    limit = max(1, max_windows)
    if len(windows) <= limit:
        return windows

    if limit == 1:
        return [windows[0]]
    step_ratio = (len(windows) - 1) / (limit - 1)
    sampled: list[str] = []
    sampled_indices: set[int] = set()
    for idx in range(limit):
        source_index = int(round(idx * step_ratio))
        source_index = max(0, min(len(windows) - 1, source_index))
        if source_index in sampled_indices:
            continue
        sampled_indices.add(source_index)
        sampled.append(windows[source_index])
    if (len(windows) - 1) not in sampled_indices:
        sampled[-1] = windows[-1]
    return sampled


def _build_window_groups(
    windows: list[str],
    *,
    batch_size: int,
    overlap: int,
) -> list[list[str]]:
    if not windows:
        return []
    safe_batch = max(1, batch_size)
    safe_overlap = max(0, min(overlap, safe_batch - 1))
    step = max(1, safe_batch - safe_overlap)
    groups: list[list[str]] = []
    for start in range(0, len(windows), step):
        group = windows[start : start + safe_batch]
        if not group:
            continue
        groups.append(group)
        if start + safe_batch >= len(windows):
            break
    return groups


def _normalize_correction_mode(raw: object) -> Literal["off", "strict", "rewrite"]:
    candidate = str(raw).strip().lower()
    if candidate in {"off", "strict", "rewrite"}:
        return candidate  # type: ignore[return-value]
    return "strict"


def _normalize_llm_mode(raw: object) -> Literal["api", "local"]:
    candidate = str(raw).strip().lower()
    if candidate in _LOCAL_LLM_MODES:
        return candidate  # type: ignore[return-value]
    return "local"


def _normalize_load_profile(raw: object) -> Literal["balanced", "memory_first"]:
    candidate = str(raw).strip().lower()
    if candidate in {"balanced", "memory_first"}:
        return candidate  # type: ignore[return-value]
    return "balanced"


def _bounded_int(raw: object, *, fallback: int, minimum: int, maximum: int) -> int:
    try:
        numeric = int(raw)
    except (TypeError, ValueError):
        numeric = fallback
    return max(minimum, min(maximum, numeric))


def _to_float(raw: object) -> float:
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


def _is_unsupported_thinking_param_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "enable_thinking" in message
        and any(token in message for token in ("unknown", "unexpected", "unsupported", "invalid", "extra_forbidden"))
    )


def _normalize_segments(segments: list[dict[str, float | str]]) -> list[dict[str, float | str]]:
    normalized: list[dict[str, float | str]] = []
    for segment in segments:
        normalized.append(
            {
                "start": round(_to_float(segment.get("start")), 2),
                "end": round(_to_float(segment.get("end")), 2),
                "text": str(segment.get("text", "")),
            }
        )
    return normalized


def _join_segment_texts(segments: list[dict[str, float | str]]) -> str:
    lines: list[str] = []
    for segment in segments:
        text = str(segment.get("text", "")).strip()
        if text:
            lines.append(text)
    return "\n".join(lines).strip()


def _normalize_summary_markdown_structure(raw: str) -> str:
    normalized = raw.strip()
    if not normalized:
        return ""
    if "```" in normalized:
        # Keep fenced code blocks (especially Mermaid) untouched.
        return normalized
    structured = _summary_markdown_to_structure(raw)
    if not structured:
        return normalized
    rendered = _render_summary_structure(structured)
    return rendered.strip() or normalized


def _extract_mermaid_code(raw: str) -> str | None:
    match = _MERMAID_CODE_FENCE_PATTERN.search(raw)
    if match:
        return _normalize_mermaid_code(match.group(1))
    cleaned = _normalize_mermaid_code(raw)
    if not cleaned:
        return None
    if cleaned.startswith(("flowchart", "mindmap")):
        return cleaned
    return None


def _normalize_mermaid_code(raw: str) -> str:
    lines = [line.rstrip() for line in raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    cleaned = "\n".join(lines).strip()
    if not cleaned:
        return ""
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:mermaid)?\s*", "", cleaned, count=1, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned, count=1)
        cleaned = cleaned.strip()
    return cleaned


def _is_mermaid_renderer_unavailable(reason: str) -> bool:
    lowered = reason.lower()
    return "renderer_unavailable" in lowered


def _summary_markdown_to_structure(raw: str) -> list[dict[str, object]]:
    lines = [line.rstrip() for line in raw.splitlines()]
    sections: list[dict[str, object]] = []
    current_title: str | None = None
    current_items: list[str] = []
    free_lines: list[str] = []

    def flush_current() -> None:
        nonlocal current_title, current_items
        if current_title is None:
            return
        sections.append(
            {
                "title": current_title.strip() or "摘要",
                "items": [item for item in current_items if item.strip()],
            }
        )
        current_title = None
        current_items = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            flush_current()
            heading = stripped.lstrip("#").strip()
            current_title = heading or "摘要"
            continue
        item = stripped
        if item[:2] in {"- ", "* "}:
            item = item[2:].strip()
        elif "." in item:
            prefix, rest = item.split(".", 1)
            if prefix.isdigit():
                item = rest.strip()
        if current_title is None:
            free_lines.append(item)
        else:
            current_items.append(item)

    flush_current()
    if not sections and free_lines:
        sections.append({"title": "摘要", "items": [line for line in free_lines if line.strip()]})
    return sections


def _render_summary_structure(sections: list[dict[str, object]]) -> str:
    lines: list[str] = []
    for section in sections:
        title = str(section.get("title", "")).strip() or "摘要"
        lines.append(f"## {title}")
        items = section.get("items", [])
        if isinstance(items, list) and items:
            for item in items:
                text = str(item).strip()
                if text:
                    lines.append(f"- {text}")
        lines.append("")
    return "\n".join(lines).strip()


def _parse_strict_correction_response(raw: str, expected_indices: list[int]) -> list[str] | None:
    payload = _extract_json_payload(raw)
    if payload is None:
        return None

    segments_payload: object = payload
    if isinstance(payload, dict):
        segments_payload = payload.get("segments")

    if not isinstance(segments_payload, list):
        return None

    if segments_payload and all(isinstance(item, str) for item in segments_payload):
        if len(segments_payload) != len(expected_indices):
            return None
        return [str(item).strip() for item in segments_payload]

    if segments_payload and all(isinstance(item, dict) and "index" not in item for item in segments_payload):
        if len(segments_payload) != len(expected_indices):
            return None
        return [str(item.get("text", "")).strip() for item in segments_payload]

    by_index: dict[int, str] = {}
    for item in segments_payload:
        if not isinstance(item, dict):
            return None
        index_raw = item.get("index")
        try:
            index = int(index_raw)
        except (TypeError, ValueError):
            return None
        text = str(item.get("text", "")).strip()
        by_index[index] = text

    missing = [index for index in expected_indices if index not in by_index]
    if missing:
        return None
    return [by_index[index] for index in expected_indices]


def _extract_json_payload(raw: str) -> object | None:
    stripped = raw.strip()
    if not stripped:
        return None

    match = _JSON_CODE_FENCE_PATTERN.search(stripped)
    if match:
        stripped = match.group(1).strip()

    parsed = _try_orjson_loads(stripped)
    if parsed is not None:
        return parsed

    object_start = stripped.find("{")
    object_end = stripped.rfind("}")
    if object_start >= 0 and object_end > object_start:
        parsed = _try_orjson_loads(stripped[object_start : object_end + 1])
        if parsed is not None:
            return parsed

    array_start = stripped.find("[")
    array_end = stripped.rfind("]")
    if array_start >= 0 and array_end > array_start:
        parsed = _try_orjson_loads(stripped[array_start : array_end + 1])
        if parsed is not None:
            return parsed

    return None


def _try_orjson_loads(raw: str) -> object | None:
    try:
        return orjson.loads(raw)
    except orjson.JSONDecodeError:
        return None


def _clear_torch_cuda_cache() -> None:
    try:
        import torch
    except Exception:  # noqa: BLE001
        return
    try:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        return


def _ensure_torch_cuda_ready(*, component: str) -> None:
    try:
        import torch
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"Local {component} runtime requires `torch`, but it is unavailable: {type(exc).__name__}: {exc}"
        ) from exc

    version_text = str(getattr(torch, "__version__", "")).strip().lower()
    if "+cpu" in version_text:
        raise RuntimeError(
            f"Local {component} runtime requires CUDA-enabled torch, but current build is CPU-only (`{version_text}`)."
        )
    cuda_version = str(getattr(getattr(torch, "version", None), "cuda", "") or "").strip()
    if not cuda_version:
        raise RuntimeError(
            f"Local {component} runtime requires CUDA-enabled torch, but `torch.version.cuda` is empty."
        )
    try:
        cuda_available = bool(torch.cuda.is_available())
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"Local {component} runtime requires CUDA, but `torch.cuda.is_available()` failed: {type(exc).__name__}: {exc}"
        ) from exc
    if not cuda_available:
        raise RuntimeError(
            f"Local {component} runtime requires CUDA, but no CUDA device is available in current runtime."
        )
