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
    NOTES_COVERAGE_PATCH_PROMPT,
    NOTES_COVERAGE_PATCH_USER_CONTENT_TEMPLATE,
    NOTES_COVERAGE_PROMPT,
    NOTES_COVERAGE_USER_CONTENT_TEMPLATE,
    NOTES_EVIDENCE_CARD_PROMPT,
    NOTES_EVIDENCE_CARD_USER_CONTENT_TEMPLATE,
    NOTES_OUTLINE_PROMPT,
    NOTES_OUTLINE_USER_CONTENT_TEMPLATE,
    NOTES_SECTION_PROMPT,
    NOTES_SECTION_USER_CONTENT_TEMPLATE,
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
_NOTES_BATCH_MAX_CHARS = 7000
_NOTES_BATCH_OVERLAP_SEGMENTS = 3
_NOTES_SECTION_CARD_LIMIT = 10
_NOTES_EXPLICIT_SECTION_CARD_LIMIT = 16
_NOTES_COVERAGE_MAX_MISSING = 10
_MERMAID_REPAIR_RETRIES = 3
_MERMAID_PLACEHOLDER_TEMPLATE = "> [Mermaid 图示已省略：自动渲染失败（已重试 {retries} 次）。]"
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


@dataclass(slots=True)
class NotesPipelineArtifacts:
    evidence_batches: list[dict[str, object]]
    evidence_cards: list[dict[str, object]]
    outline: dict[str, object]
    outline_markdown: str
    section_markdowns: list[dict[str, object]]
    coverage_report: dict[str, object]
    notes_markdown: str


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
        self._model_cache_root = Path(settings.storage_dir) / "model-hub"
        self._model_cache_root.mkdir(parents=True, exist_ok=True)
        self._project_root = Path(__file__).resolve().parents[3]
        self._frontend_dir = self._project_root / "frontend"
        self._llm_runtime_cache: dict[str, tuple[Any, Any]] = {}
        self._api_runtime = OpenAICompatRuntime(component="llm")
        self._api_disable_thinking_support: dict[str, bool] = {}
        self._mermaid_renderer_command: list[str] | None = None
        self._mermaid_renderer_checked = False

    async def generate(
        self,
        title: str,
        transcript_text: str,
        transcript_segments: list[dict[str, float | str]] | None = None,
        on_summary_delta: Callable[[str, StreamMode], Awaitable[None]] | None = None,
        on_mindmap_delta: Callable[[str, StreamMode], Awaitable[None]] | None = None,
        on_fusion_prompt_preview: Callable[[str], Awaitable[None]] | None = None,
        llm_config_override: dict[str, object] | None = None,
    ) -> SummaryBundle:
        transcript_text = transcript_text.strip()
        if not transcript_text:
            raise ValueError("Empty transcript text")

        llm_config = (
            dict(llm_config_override)
            if llm_config_override is not None
            else await self._config_store.get()
        )
        mode = _normalize_llm_mode(llm_config.get("mode"))
        load_profile = _normalize_load_profile(llm_config.get("load_profile"))
        (
            summary_prompt,
            notes_prompt,
            mindmap_prompt,
        ) = await self._prompt_template_store.resolve_selected_prompts()
        if self._settings.enable_mock_llm:
            raise RuntimeError("LLM_ALL_UNAVAILABLE: Mock summary generation is disabled.")

        try:
            normalized_segments = _normalize_segments(
                transcript_segments
                if transcript_segments
                else _segmentize_plain_text(transcript_text)
            )
            notes_artifacts = await self.generate_notes_pipeline(
                title=title,
                transcript_text=transcript_text,
                transcript_segments=normalized_segments,
                notes_prompt=notes_prompt,
                llm_config_override=llm_config,
                on_notes_delta=on_summary_delta,
                on_fusion_prompt_preview=on_fusion_prompt_preview,
            )
            summary = await self.generate_summary_from_notes(
                title=title,
                notes_markdown=notes_artifacts.notes_markdown,
                outline_markdown=notes_artifacts.outline_markdown,
                summary_prompt=summary_prompt,
                llm_config_override=llm_config,
            )
            mindmap = await self.generate_mindmap_from_notes(
                title=title,
                outline_markdown=notes_artifacts.outline_markdown,
                notes_markdown=notes_artifacts.notes_markdown,
                evidence_cards=notes_artifacts.evidence_cards,
                mindmap_prompt=mindmap_prompt,
                llm_config_override=llm_config,
                on_mindmap_delta=on_mindmap_delta,
            )
            return SummaryBundle(
                summary_markdown=summary,
                mindmap_markdown=mindmap,
                notes_markdown=notes_artifacts.notes_markdown,
            )
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

        llm_config = (
            dict(llm_config_override)
            if llm_config_override is not None
            else await self._config_store.get()
        )
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
            str(llm_config.get("model", self._settings.llm_model)).strip()
            or self._settings.llm_model
        )
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

    async def generate_notes_pipeline(
        self,
        *,
        title: str,
        transcript_text: str,
        transcript_segments: list[dict[str, float | str]],
        notes_prompt: str,
        llm_config_override: dict[str, object] | None = None,
        on_notes_delta: Callable[[str, StreamMode], Awaitable[None]] | None = None,
        on_fusion_prompt_preview: Callable[[str], Awaitable[None]] | None = None,
    ) -> NotesPipelineArtifacts:
        cards_bundle = await self.build_notes_evidence_cards(
            title=title,
            transcript_text=transcript_text,
            transcript_segments=transcript_segments,
            llm_config_override=llm_config_override,
        )
        outline, outline_markdown = await self.build_notes_outline(
            title=title,
            evidence_cards=cards_bundle["evidence_cards"],
            llm_config_override=llm_config_override,
        )
        notes_markdown, section_markdowns = await self.generate_notes_sections(
            title=title,
            notes_prompt=notes_prompt,
            evidence_cards=cards_bundle["evidence_cards"],
            outline=outline,
            outline_markdown=outline_markdown,
            llm_config_override=llm_config_override,
            on_notes_delta=on_notes_delta,
            on_fusion_prompt_preview=on_fusion_prompt_preview,
        )
        coverage_report = await self.inspect_notes_coverage(
            title=title,
            evidence_cards=cards_bundle["evidence_cards"],
            outline=outline,
            outline_markdown=outline_markdown,
            notes_markdown=notes_markdown,
            llm_config_override=llm_config_override,
        )
        final_notes = await self.patch_notes_coverage(
            title=title,
            outline_markdown=outline_markdown,
            notes_markdown=notes_markdown,
            coverage_report=coverage_report,
            llm_config_override=llm_config_override,
        )
        return NotesPipelineArtifacts(
            evidence_batches=cards_bundle["evidence_batches"],
            evidence_cards=cards_bundle["evidence_cards"],
            outline=outline,
            outline_markdown=outline_markdown,
            section_markdowns=section_markdowns,
            coverage_report=coverage_report,
            notes_markdown=final_notes,
        )

    async def build_notes_evidence_cards(
        self,
        *,
        title: str,
        transcript_text: str,
        transcript_segments: list[dict[str, float | str]],
        llm_config_override: dict[str, object] | None = None,
    ) -> dict[str, list[dict[str, object]]]:
        llm_config = (
            dict(llm_config_override)
            if llm_config_override is not None
            else await self._config_store.get()
        )
        llm_mode, client, model_name = self._resolve_generation_runtime(llm_config)
        normalized_segments = _normalize_segments(
            transcript_segments or _segmentize_plain_text(transcript_text)
        )
        batches = _build_notes_segment_batches(
            normalized_segments,
            max_chars=_NOTES_BATCH_MAX_CHARS,
            overlap_segments=_NOTES_BATCH_OVERLAP_SEGMENTS,
        )
        if not batches:
            batches = [
                {
                    "batch_id": 1,
                    "batch_index": 1,
                    "batch_total": 1,
                    "start_seconds": 0.0,
                    "end_seconds": 0.0,
                    "segments": [],
                    "text": transcript_text.strip(),
                }
            ]

        cards: list[dict[str, object]] = []
        for batch in batches:
            user_content = NOTES_EVIDENCE_CARD_USER_CONTENT_TEMPLATE.format(
                title=title,
                batch_index=int(batch.get("batch_index", 1)),
                batch_total=int(batch.get("batch_total", len(batches))),
                start_seconds=float(batch.get("start_seconds", 0.0) or 0.0),
                end_seconds=float(batch.get("end_seconds", 0.0) or 0.0),
                batch_text=str(batch.get("text", "")).strip(),
            )
            raw = await self._chat_markdown_once_by_mode(
                llm_mode=llm_mode,
                client=client,
                model_name=model_name,
                instruction=NOTES_EVIDENCE_CARD_PROMPT,
                user_content=user_content,
                temperature=0.0,
                max_tokens=1100,
            )
            payload = _extract_json_payload(raw)
            cards.append(_normalize_notes_evidence_card(payload, batch))
        return {"evidence_batches": batches, "evidence_cards": cards}

    async def build_notes_outline(
        self,
        *,
        title: str,
        evidence_cards: list[dict[str, object]],
        llm_config_override: dict[str, object] | None = None,
    ) -> tuple[dict[str, object], str]:
        llm_config = (
            dict(llm_config_override)
            if llm_config_override is not None
            else await self._config_store.get()
        )
        llm_mode, client, model_name = self._resolve_generation_runtime(llm_config)
        cards_payload = _render_notes_cards_payload(evidence_cards, mode="outline")
        raw = await self._chat_markdown_once_by_mode(
            llm_mode=llm_mode,
            client=client,
            model_name=model_name,
            instruction=NOTES_OUTLINE_PROMPT,
            user_content=NOTES_OUTLINE_USER_CONTENT_TEMPLATE.format(
                title=title,
                cards_payload=cards_payload,
            ),
            temperature=0.0,
            max_tokens=1800,
        )
        payload = _extract_json_payload(raw)
        outline = _normalize_notes_outline(payload, title=title, evidence_cards=evidence_cards)
        outline_markdown = _render_notes_outline_markdown(outline, title=title)
        return outline, outline_markdown

    async def generate_notes_sections(
        self,
        *,
        title: str,
        notes_prompt: str,
        evidence_cards: list[dict[str, object]],
        outline: dict[str, object],
        outline_markdown: str,
        llm_config_override: dict[str, object] | None = None,
        on_notes_delta: Callable[[str, StreamMode], Awaitable[None]] | None = None,
        on_fusion_prompt_preview: Callable[[str], Awaitable[None]] | None = None,
    ) -> tuple[str, list[dict[str, object]]]:
        llm_config = (
            dict(llm_config_override)
            if llm_config_override is not None
            else await self._config_store.get()
        )
        llm_mode, client, model_name = self._resolve_generation_runtime(llm_config)
        sections = outline.get("sections")
        if not isinstance(sections, list) or not sections:
            sections = _build_fallback_outline_sections(evidence_cards)

        rendered_sections: list[str] = []
        section_artifacts: list[dict[str, object]] = []
        prompt_preview_sent = False
        for index, raw_section in enumerate(sections, start=1):
            section = raw_section if isinstance(raw_section, dict) else {}
            target_cards = _select_notes_section_cards(
                evidence_cards, section, limit=_NOTES_SECTION_CARD_LIMIT
            )
            section_instruction = f"{NOTES_SECTION_PROMPT}\n\n{notes_prompt}".strip()
            section_payload = orjson.dumps(
                {
                    "id": str(section.get("id", f"section_{index}")).strip() or f"section_{index}",
                    "title": str(section.get("title", f"章节 {index}")).strip() or f"章节 {index}",
                    "summary": str(section.get("summary", "")).strip(),
                    "key_points": _normalize_string_list(section.get("key_points")),
                    "source_batch_ids": _normalize_int_list(section.get("source_batch_ids")),
                },
                option=orjson.OPT_INDENT_2,
            ).decode("utf-8")
            cards_payload = _render_notes_cards_payload(target_cards, mode="section")
            user_content = NOTES_SECTION_USER_CONTENT_TEMPLATE.format(
                title=title,
                outline_markdown=outline_markdown[:_MAX_DIRECT_TRANSCRIPT_CHARS],
                section_payload=section_payload,
                cards_payload=cards_payload[:_MAX_DIRECT_TRANSCRIPT_CHARS],
            )
            if on_fusion_prompt_preview is not None and not prompt_preview_sent:
                await on_fusion_prompt_preview(
                    self._build_fusion_prompt_preview(
                        llm_mode=llm_mode,
                        model_name=model_name,
                        instruction=section_instruction,
                        user_content=user_content,
                    )
                )
                prompt_preview_sent = True
            if rendered_sections and on_notes_delta is not None:
                await on_notes_delta("\n\n", "compat")

            if llm_mode == "local":
                raw_section_markdown = await self._chat_markdown_once_local(
                    model_id=model_name,
                    instruction=section_instruction,
                    user_content=user_content,
                    temperature=0.15,
                    max_new_tokens=2200,
                )
                if on_notes_delta is not None and raw_section_markdown.strip():
                    await self._emit_compat_deltas(raw_section_markdown.strip(), on_notes_delta)
            else:
                raw_section_markdown = await self._chat_markdown_once_stream(
                    client=client,
                    model_name=model_name,
                    instruction=section_instruction,
                    user_content=user_content,
                    temperature=0.15,
                    max_tokens=2200,
                    on_delta=(
                        (lambda delta: on_notes_delta(delta, "realtime"))
                        if on_notes_delta is not None
                        else None
                    ),
                )
            normalized_section = _normalize_notes_section_markdown(
                raw_section_markdown,
                fallback_title=str(section.get("title", f"章节 {index}")).strip()
                or f"章节 {index}",
                fallback_cards=target_cards,
            )
            rendered_sections.append(normalized_section)
            section_artifacts.append(
                {
                    "section_id": str(section.get("id", f"section_{index}")).strip()
                    or f"section_{index}",
                    "section_title": str(section.get("title", f"章节 {index}")).strip()
                    or f"章节 {index}",
                    "source_batch_ids": _normalize_int_list(section.get("source_batch_ids")),
                    "markdown": normalized_section,
                }
            )

        notes_title = str(outline.get("title", "")).strip() or str(title).strip() or "详细笔记"
        notes_markdown = _ensure_single_markdown_title(
            "# "
            + notes_title
            + "\n\n"
            + "\n\n".join(section for section in rendered_sections if section.strip()),
            notes_title,
        )
        return notes_markdown, section_artifacts

    async def inspect_notes_coverage(
        self,
        *,
        title: str,
        evidence_cards: list[dict[str, object]],
        outline: dict[str, object],
        outline_markdown: str,
        notes_markdown: str,
        llm_config_override: dict[str, object] | None = None,
    ) -> dict[str, object]:
        llm_config = (
            dict(llm_config_override)
            if llm_config_override is not None
            else await self._config_store.get()
        )
        llm_mode, client, model_name = self._resolve_generation_runtime(llm_config)
        raw = await self._chat_markdown_once_by_mode(
            llm_mode=llm_mode,
            client=client,
            model_name=model_name,
            instruction=NOTES_COVERAGE_PROMPT,
            user_content=NOTES_COVERAGE_USER_CONTENT_TEMPLATE.format(
                title=title,
                outline_markdown=outline_markdown[:_MAX_DIRECT_TRANSCRIPT_CHARS],
                cards_payload=_render_notes_cards_payload(evidence_cards, mode="coverage")[
                    :_MAX_DIRECT_TRANSCRIPT_CHARS
                ],
                notes_markdown=notes_markdown[:_MAX_DIRECT_TRANSCRIPT_CHARS],
            ),
            temperature=0.0,
            max_tokens=1200,
        )
        payload = _extract_json_payload(raw)
        return _normalize_notes_coverage_report(payload, outline=outline)

    async def patch_notes_coverage(
        self,
        *,
        title: str,
        outline_markdown: str,
        notes_markdown: str,
        coverage_report: dict[str, object],
        llm_config_override: dict[str, object] | None = None,
    ) -> str:
        missing_items = coverage_report.get("missing_items")
        if not isinstance(missing_items, list) or not missing_items:
            return _ensure_single_markdown_title(notes_markdown, title)

        llm_config = (
            dict(llm_config_override)
            if llm_config_override is not None
            else await self._config_store.get()
        )
        llm_mode, client, model_name = self._resolve_generation_runtime(llm_config)
        raw = await self._chat_markdown_once_by_mode(
            llm_mode=llm_mode,
            client=client,
            model_name=model_name,
            instruction=NOTES_COVERAGE_PATCH_PROMPT,
            user_content=NOTES_COVERAGE_PATCH_USER_CONTENT_TEMPLATE.format(
                title=title,
                outline_markdown=outline_markdown[:_MAX_DIRECT_TRANSCRIPT_CHARS],
                notes_markdown=notes_markdown[: (_MAX_DIRECT_TRANSCRIPT_CHARS * 2)],
                coverage_payload=orjson.dumps(coverage_report, option=orjson.OPT_INDENT_2).decode(
                    "utf-8"
                ),
            ),
            temperature=0.1,
            max_tokens=2600,
        )
        normalized = raw.strip() or notes_markdown
        return _ensure_single_markdown_title(normalized, title)

    async def generate_summary_from_notes(
        self,
        *,
        title: str,
        notes_markdown: str,
        outline_markdown: str,
        summary_prompt: str,
        llm_config_override: dict[str, object] | None = None,
        on_summary_delta: Callable[[str, StreamMode], Awaitable[None]] | None = None,
    ) -> str:
        llm_config = (
            dict(llm_config_override)
            if llm_config_override is not None
            else await self._config_store.get()
        )
        llm_mode, client, model_name = self._resolve_generation_runtime(llm_config)
        user_content = (
            f"视频标题：{title}\n\n"
            f"详细笔记提纲：\n{outline_markdown[:12000]}\n\n"
            f"详细笔记正文：\n{notes_markdown[:_MAX_DIRECT_TRANSCRIPT_CHARS]}"
        )
        if llm_mode == "local":
            raw = await self._chat_markdown_once_local(
                model_id=model_name,
                instruction=summary_prompt,
                user_content=user_content,
                temperature=0.1,
                max_new_tokens=1400,
            )
            if on_summary_delta is not None and raw.strip():
                await self._emit_compat_deltas(raw.strip(), on_summary_delta)
        else:
            if on_summary_delta is None:
                raw = await self._chat_markdown_once(
                    client=client,
                    model_name=model_name,
                    instruction=summary_prompt,
                    user_content=user_content,
                    temperature=0.1,
                    max_tokens=1400,
                )
            else:
                raw = await self._chat_markdown_once_stream(
                    client=client,
                    model_name=model_name,
                    instruction=summary_prompt,
                    user_content=user_content,
                    temperature=0.1,
                    max_tokens=1400,
                    on_delta=(lambda delta: on_summary_delta(delta, "realtime")),
                )
        normalized = _normalize_summary_markdown_structure(raw)
        if normalized and "```mermaid" in normalized.lower():
            normalized = await self._replace_mermaid_with_images(
                markdown=normalized,
                llm_mode=llm_mode,
                client=client,
                model_name=model_name,
            )
        return normalized or _build_summary_from_notes_fallback(notes_markdown, outline_markdown)

    async def generate_mindmap_from_notes(
        self,
        *,
        title: str,
        outline_markdown: str,
        notes_markdown: str,
        evidence_cards: list[dict[str, object]] | None = None,
        mindmap_prompt: str,
        llm_config_override: dict[str, object] | None = None,
        on_mindmap_delta: Callable[[str, StreamMode], Awaitable[None]] | None = None,
    ) -> str:
        llm_config = (
            dict(llm_config_override)
            if llm_config_override is not None
            else await self._config_store.get()
        )
        llm_mode, client, model_name = self._resolve_generation_runtime(llm_config)
        sections = [
            f"视频标题：{title}",
            f"详细笔记提纲：\n{outline_markdown[:14000]}",
        ]
        evidence_payload = _render_notes_cards_payload(
            evidence_cards or [],
            mode="mindmap",
        )
        if evidence_payload.strip():
            sections.append(
                f"高保真信息卡片：\n{evidence_payload[:_MAX_DIRECT_TRANSCRIPT_CHARS]}"
            )
        else:
            sections.append(f"详细笔记正文：\n{notes_markdown[:_MAX_DIRECT_TRANSCRIPT_CHARS]}")
        user_content = "\n\n".join(section for section in sections if section.strip())
        if llm_mode == "local":
            raw = await self._chat_markdown_once_local(
                model_id=model_name,
                instruction=mindmap_prompt,
                user_content=user_content,
                temperature=0.1,
                max_new_tokens=1400,
            )
            if on_mindmap_delta is not None and raw.strip():
                await self._emit_compat_deltas(raw.strip(), on_mindmap_delta)
        else:
            raw = await self._chat_markdown_once_stream(
                client=client,
                model_name=model_name,
                instruction=mindmap_prompt,
                user_content=user_content,
                temperature=0.1,
                max_tokens=1400,
                on_delta=(
                    (lambda delta: on_mindmap_delta(delta, "realtime"))
                    if on_mindmap_delta
                    else None
                ),
            )
        normalized = _normalize_mindmap_markdown_structure(raw, title=title)
        return normalized or _build_fallback_mindmap_from_outline(title, outline_markdown)

    def _resolve_generation_runtime(
        self,
        llm_config: dict[str, object],
    ) -> tuple[Literal["api", "local"], AsyncOpenAI | None, str]:
        llm_mode = _normalize_llm_mode(llm_config.get("mode"))
        client = self._build_client(llm_config)
        model_name = (
            str(llm_config.get("model", self._settings.llm_model)).strip()
            or self._settings.llm_model
        )
        if llm_mode == "api" and client is None:
            raise RuntimeError("LLM API client unavailable in api mode")
        return llm_mode, client, model_name

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
                preview_delta = "\n".join(
                    text.strip() for text in appended_texts if text.strip()
                ).strip()
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
            parts.append(normalized[cursor : match.start()])
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
        if model_id in self._llm_runtime_cache:
            return self._llm_runtime_cache[model_id]

        _ensure_torch_cuda_ready(component="LLM")
        from transformers import AutoModelForCausalLM, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(
            model_id,
            cache_dir=str(self._model_cache_root),
            trust_remote_code=True,
            local_files_only=True,
        )
        model = AutoModelForCausalLM.from_pretrained(
            model_id,
            cache_dir=str(self._model_cache_root),
            trust_remote_code=True,
            device_map="auto",
            torch_dtype="auto",
            local_files_only=True,
        )
        self._llm_runtime_cache[model_id] = (tokenizer, model)
        return tokenizer, model

    def release_runtime_models(self) -> None:
        if not self._llm_runtime_cache:
            return
        self._llm_runtime_cache.clear()
        gc.collect()
        _clear_torch_cuda_cache()

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
    return "api"


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
    return "enable_thinking" in message and any(
        token in message
        for token in ("unknown", "unexpected", "unsupported", "invalid", "extra_forbidden")
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


def _segmentize_plain_text(text: str, *, target_chars: int = 320) -> list[dict[str, float | str]]:
    normalized = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []

    raw_units = [
        item.strip() for item in re.split(r"\n{2,}|(?<=[。！？!?])\s+", normalized) if item.strip()
    ]
    if not raw_units:
        raw_units = [line.strip() for line in normalized.splitlines() if line.strip()]
    if not raw_units:
        raw_units = [normalized]

    segments: list[dict[str, float | str]] = []
    bucket: list[str] = []
    bucket_chars = 0

    def flush_bucket() -> None:
        nonlocal bucket, bucket_chars
        if not bucket:
            return
        segment_index = len(segments)
        segment_text = "\n".join(bucket).strip()
        segments.append(
            {
                "start": float(segment_index),
                "end": float(segment_index + 1),
                "text": segment_text,
            }
        )
        bucket = []
        bucket_chars = 0

    safe_target_chars = max(120, target_chars)
    for unit in raw_units:
        unit_chars = len(unit)
        if bucket and bucket_chars + unit_chars > safe_target_chars:
            flush_bucket()
        bucket.append(unit)
        bucket_chars += unit_chars + 1
        if bucket_chars >= safe_target_chars:
            flush_bucket()
    flush_bucket()
    return segments


def _build_notes_segment_batches(
    segments: list[dict[str, float | str]],
    *,
    max_chars: int,
    overlap_segments: int,
) -> list[dict[str, object]]:
    normalized_segments = _normalize_segments(segments)
    if not normalized_segments:
        return []

    safe_max_chars = max(800, int(max_chars))
    safe_overlap = max(0, int(overlap_segments))
    batches: list[dict[str, object]] = []
    index = 0
    while index < len(normalized_segments):
        batch_start = index
        batch_segments: list[dict[str, float | str]] = []
        batch_chars = 0
        while index < len(normalized_segments):
            segment = normalized_segments[index]
            text = str(segment.get("text", "")).strip()
            next_chars = batch_chars + len(text) + (1 if batch_segments else 0)
            if batch_segments and next_chars > safe_max_chars:
                break
            batch_segments.append(segment)
            batch_chars = next_chars
            index += 1
            if batch_chars >= safe_max_chars:
                break
        if not batch_segments:
            segment = normalized_segments[index]
            batch_segments.append(segment)
            index += 1

        batch_index = len(batches) + 1
        batches.append(
            {
                "batch_id": batch_index,
                "batch_index": batch_index,
                "batch_total": 0,
                "start_seconds": round(_to_float(batch_segments[0].get("start")), 2),
                "end_seconds": round(_to_float(batch_segments[-1].get("end")), 2),
                "segment_indices": list(range(batch_start, batch_start + len(batch_segments))),
                "segments": batch_segments,
                "text": _join_segment_texts(batch_segments),
            }
        )
        if index >= len(normalized_segments):
            break
        index = max(batch_start + 1, index - safe_overlap)

    batch_total = len(batches)
    for batch in batches:
        batch["batch_total"] = batch_total
    return batches


def _normalize_string_list(raw: object) -> list[str]:
    if raw is None:
        return []

    candidates: list[str] = []
    if isinstance(raw, str):
        chunks = re.split(r"\n+|[;；]+|(?<=。)|(?<=！)|(?<=？)", raw)
        candidates.extend(str(item).strip() for item in chunks)
    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, str):
                candidates.append(item.strip())
            elif isinstance(item, dict):
                for key in ("text", "title", "name", "description", "summary"):
                    value = item.get(key)
                    if isinstance(value, str) and value.strip():
                        candidates.append(value.strip())
                        break
            elif item is not None:
                candidates.append(str(item).strip())
    else:
        candidates.append(str(raw).strip())

    result: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        cleaned = re.sub(r"^[\-\*\d\.\)\s]+", "", candidate).strip()
        if not cleaned:
            continue
        if cleaned in seen:
            continue
        seen.add(cleaned)
        result.append(cleaned)
    return result


def _normalize_int_list(raw: object) -> list[int]:
    values: list[int] = []
    source = raw if isinstance(raw, list) else [raw]
    for item in source:
        try:
            value = int(item)
        except (TypeError, ValueError):
            continue
        if value not in values:
            values.append(value)
    return values


def _normalize_notes_evidence_card(payload: object, batch: dict[str, object]) -> dict[str, object]:
    payload_dict = payload if isinstance(payload, dict) else {}
    batch_text = str(batch.get("text", "")).strip()
    fallback_points = _normalize_string_list(batch_text)[:4]
    if not fallback_points and batch_text:
        fallback_points = [batch_text[: min(180, len(batch_text))]]

    normalized = {
        "batch_id": int(batch.get("batch_id", 0) or 0),
        "batch_index": int(batch.get("batch_index", 0) or 0),
        "batch_total": int(batch.get("batch_total", 0) or 0),
        "start_seconds": round(_to_float(batch.get("start_seconds")), 2),
        "end_seconds": round(_to_float(batch.get("end_seconds")), 2),
        "time_range": (
            f"{round(_to_float(batch.get('start_seconds')), 2):.2f}s - "
            f"{round(_to_float(batch.get('end_seconds')), 2):.2f}s"
        ),
        "core_points": _normalize_string_list(payload_dict.get("core_points")) or fallback_points,
        "definitions": _normalize_string_list(payload_dict.get("definitions")),
        "steps": _normalize_string_list(payload_dict.get("steps")),
        "examples": _normalize_string_list(payload_dict.get("examples")),
        "comparisons": _normalize_string_list(payload_dict.get("comparisons")),
        "constraints": _normalize_string_list(payload_dict.get("constraints")),
        "caveats": _normalize_string_list(payload_dict.get("caveats")),
        "terms": _normalize_string_list(payload_dict.get("terms")),
        "open_loops": _normalize_string_list(payload_dict.get("open_loops")),
        "raw_excerpt": batch_text[:400],
    }
    if not any(
        normalized[key]
        for key in (
            "definitions",
            "steps",
            "examples",
            "comparisons",
            "constraints",
            "caveats",
            "terms",
        )
    ):
        normalized["caveats"] = normalized["caveats"] or []
    return normalized


def _render_notes_cards_payload(evidence_cards: list[dict[str, object]], *, mode: str) -> str:
    field_map = {
        "outline": (
            "batch_id",
            "time_range",
            "core_points",
            "definitions",
            "steps",
            "examples",
            "comparisons",
            "constraints",
            "caveats",
            "terms",
        ),
        "section": (
            "batch_id",
            "time_range",
            "core_points",
            "definitions",
            "steps",
            "examples",
            "comparisons",
            "constraints",
            "caveats",
            "terms",
        ),
        "mindmap": (
            "batch_id",
            "time_range",
            "core_points",
            "definitions",
            "steps",
            "examples",
            "comparisons",
            "constraints",
            "caveats",
            "terms",
            "open_loops",
        ),
        "coverage": (
            "batch_id",
            "time_range",
            "core_points",
            "definitions",
            "steps",
            "examples",
            "comparisons",
            "constraints",
            "caveats",
            "terms",
            "open_loops",
        ),
    }
    selected_fields = field_map.get(mode, field_map["outline"])
    payload: list[dict[str, object]] = []
    for card in evidence_cards:
        payload.append({field: card.get(field) for field in selected_fields if field in card})
    return orjson.dumps(payload, option=orjson.OPT_INDENT_2).decode("utf-8")


def _build_fallback_outline_sections(
    evidence_cards: list[dict[str, object]],
) -> list[dict[str, object]]:
    if not evidence_cards:
        return [
            {
                "id": "section_1",
                "title": "核心内容",
                "summary": "暂无可用信息卡片。",
                "key_points": ["暂无可用信息卡片。"],
                "source_batch_ids": [],
            }
        ]

    group_size = 1 if len(evidence_cards) <= 3 else 2
    sections: list[dict[str, object]] = []
    for index in range(0, len(evidence_cards), group_size):
        cards = evidence_cards[index : index + group_size]
        key_points: list[str] = []
        source_batch_ids: list[int] = []
        for card in cards:
            key_points.extend(_normalize_string_list(card.get("core_points"))[:2])
            batch_id = int(card.get("batch_id", 0) or 0)
            if batch_id and batch_id not in source_batch_ids:
                source_batch_ids.append(batch_id)
        summary = "；".join(key_points[:3]) if key_points else "补充该部分详细笔记。"
        title_seed = key_points[0] if key_points else f"章节 {len(sections) + 1}"
        sections.append(
            {
                "id": f"section_{len(sections) + 1}",
                "title": title_seed[:24] or f"章节 {len(sections) + 1}",
                "summary": summary,
                "key_points": key_points[:5] or [summary],
                "source_batch_ids": source_batch_ids,
            }
        )
    return sections


def _normalize_notes_outline(
    payload: object, *, title: str, evidence_cards: list[dict[str, object]]
) -> dict[str, object]:
    payload_dict = payload if isinstance(payload, dict) else {}
    raw_sections = (
        payload_dict.get("sections") if isinstance(payload_dict.get("sections"), list) else payload
    )
    sections: list[dict[str, object]] = []
    if isinstance(raw_sections, list):
        for index, item in enumerate(raw_sections, start=1):
            item_dict = item if isinstance(item, dict) else {}
            section_title = (
                str(item_dict.get("title", "")).strip()
                or str(item_dict.get("name", "")).strip()
                or f"章节 {index}"
            )
            section_summary = (
                str(item_dict.get("summary", "")).strip()
                or str(item_dict.get("description", "")).strip()
            )
            source_batch_ids = _normalize_int_list(
                item_dict.get("source_batch_ids")
                or item_dict.get("batch_ids")
                or item_dict.get("source_batches")
            )
            sections.append(
                {
                    "id": str(item_dict.get("id", f"section_{index}")).strip()
                    or f"section_{index}",
                    "title": section_title,
                    "summary": section_summary,
                    "key_points": _normalize_string_list(item_dict.get("key_points"))[:6],
                    "source_batch_ids": source_batch_ids,
                }
            )
    sections = [section for section in sections if section.get("title")]
    if not sections:
        sections = _build_fallback_outline_sections(evidence_cards)

    normalized_title = (
        str(payload_dict.get("title", "")).strip() or str(title).strip() or "详细笔记"
    )
    return {
        "title": normalized_title,
        "sections": sections,
    }


def _render_notes_outline_markdown(outline: dict[str, object], *, title: str) -> str:
    resolved_title = str(outline.get("title", "")).strip() or str(title).strip() or "详细笔记"
    lines: list[str] = [f"# {resolved_title}"]
    sections = outline.get("sections")
    if isinstance(sections, list):
        for item in sections:
            if not isinstance(item, dict):
                continue
            section_title = str(item.get("title", "")).strip()
            if not section_title:
                continue
            lines.append("")
            lines.append(f"## {section_title}")
            summary = str(item.get("summary", "")).strip()
            if summary:
                lines.append(summary)
            key_points = _normalize_string_list(item.get("key_points"))
            for point in key_points:
                lines.append(f"- {point}")
    return _ensure_single_markdown_title("\n".join(lines).strip(), resolved_title)


def _select_notes_section_cards(
    evidence_cards: list[dict[str, object]],
    section: dict[str, object],
    *,
    limit: int,
) -> list[dict[str, object]]:
    safe_limit = max(1, int(limit))
    source_batch_ids = set(_normalize_int_list(section.get("source_batch_ids")))
    if source_batch_ids:
        selected = [
            card for card in evidence_cards if int(card.get("batch_id", 0) or 0) in source_batch_ids
        ]
        if selected:
            explicit_limit = max(
                safe_limit,
                min(_NOTES_EXPLICIT_SECTION_CARD_LIMIT, len(selected)),
            )
            return selected[:explicit_limit]

    title = str(section.get("title", "")).strip()
    key_points = _normalize_string_list(section.get("key_points"))
    keywords = [keyword for keyword in [title, *key_points] if keyword]
    if keywords:
        selected = []
        for card in evidence_cards:
            haystack = " ".join(
                _normalize_string_list(card.get("core_points"))
                + _normalize_string_list(card.get("definitions"))
                + _normalize_string_list(card.get("steps"))
                + _normalize_string_list(card.get("examples"))
            )
            if any(keyword in haystack or haystack in keyword for keyword in keywords):
                selected.append(card)
        if selected:
            return selected[:safe_limit]
    return evidence_cards[:safe_limit]


def _build_notes_section_fallback_markdown(
    fallback_title: str, fallback_cards: list[dict[str, object]]
) -> str:
    core_points: list[str] = []
    definitions: list[str] = []
    steps: list[str] = []
    examples: list[str] = []
    caveats: list[str] = []
    for card in fallback_cards:
        core_points.extend(_normalize_string_list(card.get("core_points"))[:3])
        definitions.extend(_normalize_string_list(card.get("definitions"))[:2])
        steps.extend(_normalize_string_list(card.get("steps"))[:3])
        examples.extend(_normalize_string_list(card.get("examples"))[:2])
        caveats.extend(
            (
                _normalize_string_list(card.get("caveats"))
                + _normalize_string_list(card.get("constraints"))
            )[:2]
        )

    lines = [f"## {fallback_title}", "", "### 本节要点"]
    for item in core_points[:5] or ["补充该章节的关键内容。"]:
        lines.append(f"- {item}")
    if definitions:
        lines.extend(["", "### 定义与术语"])
        for item in definitions[:4]:
            lines.append(f"- {item}")
    if steps:
        lines.extend(["", "### 步骤与过程"])
        for item in steps[:5]:
            lines.append(f"- {item}")
    lines.extend(["", "### 关键案例"])
    for item in examples[:4] or ["当前章节未显式给出案例，可在后续复核时补充。"]:
        lines.append(f"- {item}")
    lines.extend(["", "### 注意事项"])
    for item in caveats[:4] or ["结合原始转写进一步核对边界条件与例外情况。"]:
        lines.append(f"- {item}")
    return "\n".join(lines).strip()


def _normalize_notes_section_markdown(
    raw: str,
    *,
    fallback_title: str,
    fallback_cards: list[dict[str, object]],
) -> str:
    normalized = (raw or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if normalized.startswith("```"):
        match = re.search(
            r"```(?:markdown|md)?\s*([\s\S]*?)\s*```", normalized, flags=re.IGNORECASE
        )
        if match:
            normalized = match.group(1).strip()
    if not normalized:
        normalized = _build_notes_section_fallback_markdown(fallback_title, fallback_cards)

    lines: list[str] = []
    has_heading = False
    for line in normalized.splitlines():
        stripped = line.strip()
        if re.match(r"^#\s+", stripped):
            stripped = "## " + stripped.lstrip("#").strip()
            has_heading = True
        elif re.match(r"^##\s+", stripped):
            has_heading = True
        lines.append(stripped if stripped else "")
    normalized = "\n".join(lines).strip()
    if not has_heading:
        normalized = f"## {fallback_title}\n\n{normalized}".strip()
    return normalized


def _normalize_notes_coverage_report(
    payload: object, *, outline: dict[str, object]
) -> dict[str, object]:
    payload_dict = payload if isinstance(payload, dict) else {}
    covered_items = _normalize_string_list(payload_dict.get("covered_items"))
    raw_missing_items = payload_dict.get("missing_items")
    missing_items: list[dict[str, object]] = []
    if isinstance(raw_missing_items, list):
        for item in raw_missing_items:
            item_dict = item if isinstance(item, dict) else {}
            description = (
                str(item_dict.get("description", "")).strip()
                or str(item_dict.get("text", "")).strip()
                or str(item_dict.get("summary", "")).strip()
            )
            if not description:
                continue
            missing_items.append(
                {
                    "section_id": str(item_dict.get("section_id", "")).strip() or None,
                    "section_title": str(item_dict.get("section_title", "")).strip() or None,
                    "item_type": str(item_dict.get("item_type", "")).strip() or "detail",
                    "description": description,
                    "source_batch_ids": _normalize_int_list(item_dict.get("source_batch_ids")),
                }
            )
    missing_items = missing_items[:_NOTES_COVERAGE_MAX_MISSING]
    return {
        "covered_items": covered_items,
        "missing_items": missing_items,
        "missing_count": len(missing_items),
        "needs_patch": bool(missing_items),
        "outline_title": str(outline.get("title", "")).strip(),
    }


def _ensure_single_markdown_title(markdown: str, title: str) -> str:
    normalized = (markdown or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    resolved_title = (title or "").strip() or "详细笔记"
    if not normalized:
        return f"# {resolved_title}"

    lines = normalized.splitlines()
    first_h1_text = ""
    body_lines: list[str] = []
    h1_seen = False
    for line in lines:
        stripped = line.strip()
        if re.match(r"^#\s+", stripped):
            heading_text = stripped.lstrip("#").strip()
            if not h1_seen:
                first_h1_text = heading_text
                h1_seen = True
            else:
                body_lines.append(f"## {heading_text}")
            continue
        body_lines.append(line.rstrip())

    final_title = first_h1_text or resolved_title
    body = "\n".join(body_lines).strip()
    if body:
        return f"# {final_title}\n\n{body}".strip()
    return f"# {final_title}"


def _sanitize_mindmap_topic(value: str) -> str:
    normalized = (value or "").strip()
    if not normalized:
        return ""
    normalized = re.sub(r"\[(.*?)\]\((.*?)\)", r"\1", normalized)
    normalized = re.sub(r"</?[^>]+>", "", normalized)
    normalized = normalized.replace("**", "").replace("__", "").replace("`", "")
    normalized = re.sub(r"^\s*(?:[-*+]\s+|\d+\.\s+|#{1,6}\s+)", "", normalized)
    normalized = re.sub(r"[*~]+", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized.strip("\"'“”‘’")


def _extract_mindmap_topic_from_line(raw_line: str) -> str:
    candidate = (raw_line or "").strip()
    if not candidate:
        return ""
    if candidate.lower().startswith("mindmap"):
        return ""
    candidate = re.sub(r"^root\b", "", candidate, flags=re.IGNORECASE).strip()
    if re.match(r"^[A-Za-z0-9_-]+\s*(?=[(\[{])", candidate):
        candidate = re.sub(r"^[A-Za-z0-9_-]+\s*", "", candidate, count=1).strip()
    while True:
        updated = candidate
        for opening, closing in (
            ("((", "))"),
            ("[[", "]]"),
            ("{{", "}}"),
            ("(", ")"),
            ("[", "]"),
            ("{", "}"),
        ):
            if updated.startswith(opening) and updated.endswith(closing):
                updated = updated[len(opening) : -len(closing)].strip()
                break
        if updated == candidate:
            break
        candidate = updated
    return _sanitize_mindmap_topic(candidate)


def _normalize_mermaid_mindmap_code(raw: str, *, title: str) -> str:
    normalized = (raw or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return ""
    lines = [line.rstrip() for line in normalized.splitlines() if line.strip()]
    if lines and lines[0].strip().lower().startswith("mindmap"):
        lines = lines[1:]

    topics: list[tuple[int, str]] = []
    for raw_line in lines:
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        topic = _extract_mindmap_topic_from_line(raw_line)
        if topic:
            topics.append((indent, topic))
    if not topics:
        return ""

    base_indent = topics[0][0]
    root_topic = topics[0][1] or _sanitize_mindmap_topic(title) or "思维导图"
    normalized_lines = ["mindmap", f"  root(({root_topic}))"]
    for indent, topic in topics[1:]:
        relative_depth = max(1, max(0, indent - base_indent) // 2)
        normalized_lines.append(f"{' ' * (2 + relative_depth * 2)}{topic}")
    return "\n".join(normalized_lines).strip()


def _normalize_mindmap_markdown_structure(raw: str, *, title: str) -> str:
    normalized = (raw or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return ""

    fenced_match = re.fullmatch(
        r"```(mindmap|mermaid)\s*([\s\S]*?)\s*```",
        normalized,
        flags=re.IGNORECASE,
    )
    if fenced_match:
        language = str(fenced_match.group(1) or "").strip().lower()
        code = str(fenced_match.group(2) or "").strip()
        if code.lower().startswith("mindmap"):
            normalized_code = _normalize_mermaid_mindmap_code(code, title=title)
            if normalized_code:
                return f"```mindmap\n{normalized_code}\n```".strip()
        if language == "mermaid" and code.lower().startswith(("graph", "flowchart")):
            return f"```mermaid\n{code}\n```".strip()

    if normalized.lower().startswith("mindmap"):
        normalized_code = _normalize_mermaid_mindmap_code(normalized, title=title)
        if normalized_code:
            return f"```mindmap\n{normalized_code}\n```".strip()
    if normalized.lower().startswith(("graph", "flowchart")):
        return normalized

    cleaned_lines: list[str] = []
    has_structure = False
    for raw_line in normalized.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("```"):
            continue
        heading_match = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading_match:
            level = max(1, min(4, len(heading_match.group(1))))
            topic = _sanitize_mindmap_topic(heading_match.group(2))
            if topic:
                cleaned_lines.append(f"{'#' * level} {topic}")
                has_structure = True
            continue
        bullet_match = re.match(r"^([-*+]|\d+\.)\s+(.+)$", stripped)
        if bullet_match:
            topic = _sanitize_mindmap_topic(bullet_match.group(2))
            if topic:
                cleaned_lines.append(f"- {topic}")
                has_structure = True
            continue
        topic = _sanitize_mindmap_topic(stripped)
        if topic:
            cleaned_lines.append(topic)

    if not cleaned_lines:
        return ""
    if has_structure:
        return _ensure_single_markdown_title("\n".join(cleaned_lines).strip(), title)
    return _ensure_single_markdown_title(
        "## 核心主题\n- " + "\n- ".join(cleaned_lines),
        title,
    )


def _build_summary_from_notes_fallback(notes_markdown: str, outline_markdown: str) -> str:
    outline_sections = _summary_markdown_to_structure(outline_markdown)
    source_sections = outline_sections or _summary_markdown_to_structure(notes_markdown)
    highlights: list[str] = []
    for section in source_sections:
        title = str(section.get("title", "")).strip()
        if title:
            highlights.append(title)
        items = section.get("items")
        if isinstance(items, list):
            for item in items:
                text = str(item).strip()
                if text:
                    highlights.append(text)
                if len(highlights) >= 6:
                    break
        if len(highlights) >= 6:
            break

    bullet_lines = (
        "\n".join(f"- {item}" for item in highlights[:6]) or "- 建议基于详细笔记重新生成简版总结"
    )
    return (
        "## 核心摘要\n\n"
        f"{bullet_lines}\n\n"
        "## 后续建议\n\n"
        "- 结合详细笔记复核关键术语与边界条件\n"
        "- 如需更短摘要，可切换 summary 模板重新生成\n"
    )


def _build_fallback_mindmap_from_outline(title: str, outline_markdown: str) -> str:
    resolved_title = (title or "").strip() or "详细笔记"
    sections = _summary_markdown_to_structure(outline_markdown)
    branches: list[tuple[str, list[str]]] = []
    if not sections:
        branches = [("核心主题", ["复核详细笔记结构"])]
    else:
        for section in sections[:8]:
            heading = str(section.get("title", "")).strip() or "主题"
            children: list[str] = []
            items = section.get("items")
            if isinstance(items, list):
                for item in items[:5]:
                    text = re.sub(r"[`*_#\[\]\(\)]", "", str(item).strip())
                    if text:
                        children.append(text[:40])
            branches.append((heading[:40], children))

    lines = ["```mindmap", "mindmap", f"  root(({resolved_title}))"]
    for heading, children in branches:
        lines.append(f"    {heading}")
        for child in children:
            lines.append(f"      {child}")
    lines.append("```")
    return "\n".join(lines).strip()


def _summary_markdown_to_structure(markdown: str) -> list[dict[str, object]]:
    normalized = (markdown or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []

    sections: list[dict[str, object]] = []
    current_title = "核心内容"
    current_items: list[str] = []

    def flush_section() -> None:
        nonlocal current_items, current_title
        cleaned_items = [item.strip() for item in current_items if item.strip()]
        if not current_title.strip() and not cleaned_items:
            return
        sections.append(
            {
                "title": current_title.strip() or "核心内容",
                "items": cleaned_items,
            }
        )
        current_items = []

    for raw_line in normalized.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            continue
        if stripped.startswith("# "):
            continue
        if stripped.startswith("## "):
            if current_items or sections:
                flush_section()
            current_title = stripped[3:].strip() or "核心内容"
            continue
        if stripped.startswith("- "):
            current_items.append(stripped[2:].strip())
            continue
        if not current_items:
            current_items.append(stripped)
        else:
            current_items[-1] = f"{current_items[-1]} {stripped}".strip()

    flush_section()
    return sections


def _extract_mermaid_code(raw: str) -> str:
    normalized = (raw or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return ""
    match = _MERMAID_CODE_FENCE_PATTERN.search(normalized)
    if match:
        return match.group(1).strip()
    return normalized


def _normalize_mermaid_code(raw: str) -> str:
    extracted = _extract_mermaid_code(raw)
    if not extracted:
        return ""
    return extracted.strip()


def _normalize_summary_markdown_structure(raw: str) -> str:
    normalized = (raw or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return ""
    fence_match = re.fullmatch(
        r"```(?:markdown|md)?\s*([\s\S]*?)\s*```", normalized, flags=re.IGNORECASE
    )
    if fence_match:
        normalized = fence_match.group(1).strip()
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()
    return normalized


def _is_mermaid_renderer_unavailable(reason: str) -> bool:
    message = str(reason or "").strip().lower()
    return any(
        token in message
        for token in (
            "renderer unavailable",
            "mmdc not found",
            "pnpm not found",
            "executable file not found",
            "is not recognized",
            "command not found",
            "module not found",
        )
    )


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

    if segments_payload and all(
        isinstance(item, dict) and "index" not in item for item in segments_payload
    ):
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
