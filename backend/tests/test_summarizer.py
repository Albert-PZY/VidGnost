import asyncio
from pathlib import Path

import pytest

from app.config import Settings
from app.services.exporters import render_markmap_html
from app.services.summarizer import (
    LLMService,
    _build_text_windows,
    _build_window_groups,
    _extract_mermaid_code,
    _normalize_correction_mode,
    _normalize_summary_markdown_structure,
    _parse_strict_correction_response,
)


def test_compose_notes_contains_summary_only() -> None:
    notes = LLMService._compose_notes(
        title="示例视频",
        summary="## 摘要\n- 要点 1",
    )
    assert notes.startswith("# 示例视频")
    assert "## 详细笔记" in notes
    assert "## 摘要" in notes
    assert "- 要点 1" in notes
    assert "## 思维导图 Mermaid" not in notes
    assert "```mermaid" not in notes
    assert "## 转写全文" not in notes


def test_compose_notes_does_not_embed_mindmap_text() -> None:
    notes = LLMService._compose_notes(
        title="示例视频",
        summary="摘要",
    )
    assert "mindmap" not in notes
    assert "```" not in notes
    assert "## 转写全文" not in notes


def test_render_markmap_html_uses_white_background() -> None:
    html = render_markmap_html("# Demo", title="Demo")
    assert "background: #ffffff;" in html
    assert "color: #111827;" in html


def test_parse_strict_correction_response_accepts_indexed_segments() -> None:
    raw = """{
      "segments": [
        {"index": 5, "text": "第一段已纠错"},
        {"index": 6, "text": "第二段已纠错"}
      ]
    }"""
    parsed = _parse_strict_correction_response(raw, expected_indices=[5, 6])
    assert parsed == ["第一段已纠错", "第二段已纠错"]


def test_parse_strict_correction_response_rejects_missing_index() -> None:
    raw = """{
      "segments": [
        {"index": 5, "text": "第一段已纠错"}
      ]
    }"""
    parsed = _parse_strict_correction_response(raw, expected_indices=[5, 6])
    assert parsed is None


def test_normalize_correction_mode_defaults_to_strict() -> None:
    assert _normalize_correction_mode("rewrite") == "rewrite"
    assert _normalize_correction_mode("off") == "off"
    assert _normalize_correction_mode("bad-mode") == "strict"


def test_build_text_windows_with_overlap_preserves_tail_context() -> None:
    text = "\n".join(f"line-{index:02d}" for index in range(60))
    windows = _build_text_windows(
        text,
        window_chars=120,
        overlap_chars=24,
        max_windows=12,
    )
    assert len(windows) >= 2
    assert windows[0].startswith("line-00")
    assert any("line-59" in chunk for chunk in windows)


def test_build_window_groups_respects_batch_and_overlap() -> None:
    windows = [f"chunk-{index}" for index in range(7)]
    groups = _build_window_groups(windows, batch_size=3, overlap=1)
    assert groups[0] == ["chunk-0", "chunk-1", "chunk-2"]
    assert groups[1] == ["chunk-2", "chunk-3", "chunk-4"]
    assert groups[-1][-1] == "chunk-6"


def test_build_text_windows_downsamples_with_tail_coverage() -> None:
    text = "".join(f"section-{index:02d}\n" for index in range(240))
    windows = _build_text_windows(
        text,
        window_chars=180,
        overlap_chars=24,
        max_windows=6,
    )
    assert len(windows) <= 6
    assert windows[0].startswith("section-00")
    assert "section-239" in windows[-1]


def test_normalize_summary_keeps_mermaid_fence() -> None:
    raw = "## 结构\n\n```mermaid\nflowchart TD\nA-->B\n```"
    normalized = _normalize_summary_markdown_structure(raw)
    assert normalized == raw


def test_extract_mermaid_code_from_fence() -> None:
    raw = "文本\n```mermaid\nflowchart TD\nA-->B\n```\n"
    extracted = _extract_mermaid_code(raw)
    assert extracted == "flowchart TD\nA-->B"


class _DummyLLMConfigStore:
    async def get(self) -> dict[str, object]:
        return {
            "mode": "api",
            "local_model_id": "Qwen/Qwen2.5-7B-Instruct",
            "api_key": "",
            "base_url": "https://example.invalid/v1",
            "model": "qwen3.5-flash",
            "correction_mode": "strict",
            "correction_batch_size": 24,
            "correction_overlap": 3,
        }


class _DummyPromptTemplateStore:
    async def resolve_selected_prompts(self) -> tuple[str, str]:
        return ("summary prompt", "mindmap prompt")


def _build_settings(tmp_path: Path) -> Settings:
    return Settings(
        storage_dir=str(tmp_path / "storage"),
        temp_dir=str(tmp_path / "storage" / "tmp"),
        upload_dir=str(tmp_path / "storage" / "uploads"),
        output_dir=str(tmp_path / "storage" / "outputs"),
        llm_config_path=str(tmp_path / "storage" / "model_config.json"),
        runtime_config_path=str(tmp_path / "storage" / "config.toml"),
    )


@pytest.mark.asyncio
async def test_generate_fails_when_all_llm_paths_unavailable(tmp_path: Path) -> None:
    service = LLMService(
        settings=_build_settings(tmp_path),
        llm_config_store=_DummyLLMConfigStore(),
        prompt_template_store=_DummyPromptTemplateStore(),
    )

    async def _raise_local(*args, **kwargs) -> str:  # type: ignore[no-untyped-def]
        raise RuntimeError("local unavailable")

    service._chat_markdown_once_local = _raise_local  # type: ignore[method-assign]
    service._build_client = lambda _config: None  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="LLM_ALL_UNAVAILABLE"):
        await service.generate(
            title="demo",
            transcript_text="测试文本",
            llm_config_override={"mode": "api", "api_key": ""},
        )


@pytest.mark.asyncio
async def test_generate_can_fallback_from_api_to_local(tmp_path: Path) -> None:
    service = LLMService(
        settings=_build_settings(tmp_path),
        llm_config_store=_DummyLLMConfigStore(),
        prompt_template_store=_DummyPromptTemplateStore(),
    )

    async def _local_response(*args, **kwargs) -> str:  # type: ignore[no-untyped-def]
        if kwargs.get("instruction") == "summary prompt":
            return "## summary"
        return "# mindmap"

    service._chat_markdown_once_local = _local_response  # type: ignore[method-assign]
    service._build_client = lambda _config: None  # type: ignore[method-assign]

    bundle = await service.generate(
        title="demo",
        transcript_text="测试文本",
        llm_config_override={"mode": "api", "api_key": ""},
    )
    assert bundle.summary_markdown == "## summary"
    assert bundle.mindmap_markdown == "# mindmap"


@pytest.mark.asyncio
async def test_generate_replaces_mermaid_block_with_image_markdown(tmp_path: Path) -> None:
    service = LLMService(
        settings=_build_settings(tmp_path),
        llm_config_store=_DummyLLMConfigStore(),
        prompt_template_store=_DummyPromptTemplateStore(),
    )

    async def _local_response(*args, **kwargs) -> str:  # type: ignore[no-untyped-def]
        if kwargs.get("instruction") == "summary prompt":
            return "## 笔记\n\n```mermaid\nflowchart TD\nA-->B\n```"
        return "# mindmap"

    async def _render_ok(_code: str) -> tuple[bytes | None, str]:
        return (b"\x89PNG\r\n\x1a\nfake", "")

    service._chat_markdown_once_local = _local_response  # type: ignore[method-assign]
    service._build_client = lambda _config: None  # type: ignore[method-assign]
    service._render_mermaid_png_bytes = _render_ok  # type: ignore[method-assign]

    bundle = await service.generate(
        title="demo",
        transcript_text="测试文本",
        llm_config_override={"mode": "local"},
    )
    assert "```mermaid" not in bundle.summary_markdown
    assert "![Mermaid 图示 1](notes-images/mermaid-001.png)" in bundle.summary_markdown
    assert len(bundle.notes_image_assets) == 1
    assert bundle.notes_image_assets[0].relative_path == "notes-images/mermaid-001.png"


@pytest.mark.asyncio
async def test_correct_transcript_skips_long_rewrite_to_keep_pipeline_responsive(tmp_path: Path) -> None:
    service = LLMService(
        settings=_build_settings(tmp_path),
        llm_config_store=_DummyLLMConfigStore(),
        prompt_template_store=_DummyPromptTemplateStore(),
    )

    async def _rewrite_should_not_run(*args, **kwargs) -> str:  # type: ignore[no-untyped-def]
        raise AssertionError("long rewrite should be skipped before invoking LLM")

    service._rewrite_transcript_text = _rewrite_should_not_run  # type: ignore[method-assign]

    long_text = ("这是很长的一段转写内容。\n" * 2200).strip()
    bundle = await service.correct_transcript(
        title="demo",
        transcript_text=long_text,
        segments=[{"start": 0.0, "end": 1.0, "text": "第一段"}],
        llm_config_override={
            "mode": "api",
            "api_key": "demo-key",
            "base_url": "https://example.invalid/v1",
            "model": "qwen3.5-flash",
            "correction_mode": "rewrite",
        },
    )

    assert bundle.fallback_used is True
    assert bundle.summary_input_text == long_text
    assert "skipped for long transcript" in bundle.message


@pytest.mark.asyncio
async def test_correct_transcript_falls_back_when_strict_correction_times_out(tmp_path: Path) -> None:
    service = LLMService(
        settings=_build_settings(tmp_path),
        llm_config_store=_DummyLLMConfigStore(),
        prompt_template_store=_DummyPromptTemplateStore(),
    )

    async def _strict_timeout(*args, **kwargs) -> list[dict[str, float | str]]:  # type: ignore[no-untyped-def]
        raise asyncio.TimeoutError()

    service._correct_transcript_strict = _strict_timeout  # type: ignore[method-assign]

    bundle = await service.correct_transcript(
        title="demo",
        transcript_text="第一句",
        segments=[{"start": 0.0, "end": 1.0, "text": "第一句"}],
        llm_config_override={
            "mode": "api",
            "api_key": "demo-key",
            "base_url": "https://example.invalid/v1",
            "model": "qwen3.5-flash",
            "correction_mode": "strict",
        },
    )

    assert bundle.fallback_used is True
    assert bundle.summary_input_text == "第一句"
    assert "timed out" in bundle.message
