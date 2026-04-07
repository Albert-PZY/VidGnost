from pathlib import Path

import pytest

from app.config import Settings
from app.services.exporters import render_markmap_html
from app.services.summarizer import (
    LLMService,
    NotesPipelineArtifacts,
    _build_text_windows,
    _build_window_groups,
    _ensure_single_markdown_title,
    _extract_mermaid_code,
    _normalize_correction_mode,
    _normalize_summary_markdown_structure,
    _parse_strict_correction_response,
)


def test_ensure_single_markdown_title_does_not_duplicate_existing_h1() -> None:
    notes = _ensure_single_markdown_title(
        "# 示例视频\n\n## 摘要\n- 要点 1\n\n# 重复标题",
        "示例视频",
    )
    assert notes.startswith("# 示例视频")
    assert sum(1 for line in notes.splitlines() if line.startswith("# ")) == 1
    assert "## 重复标题" in notes


def test_ensure_single_markdown_title_adds_single_fallback_h1() -> None:
    notes = _ensure_single_markdown_title(
        "## 关键内容\n- 要点 1",
        "示例视频",
    )
    assert notes.startswith("# 示例视频")
    assert notes.count("# 示例视频") == 1


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
    async def resolve_selected_prompts(self) -> tuple[str, str, str]:
        return ("summary prompt", "notes prompt", "mindmap prompt")


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
async def test_generate_raises_when_api_client_unavailable(tmp_path: Path) -> None:
    service = LLMService(
        settings=_build_settings(tmp_path),
        llm_config_store=_DummyLLMConfigStore(),
        prompt_template_store=_DummyPromptTemplateStore(),
    )
    service._build_client = lambda _config: None  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="LLM API client unavailable"):
        await service.generate(
            title="demo",
            transcript_text="测试文本",
            llm_config_override={"mode": "api", "api_key": ""},
        )


@pytest.mark.asyncio
async def test_generate_orchestrates_notes_summary_and_mindmap(tmp_path: Path) -> None:
    service = LLMService(
        settings=_build_settings(tmp_path),
        llm_config_store=_DummyLLMConfigStore(),
        prompt_template_store=_DummyPromptTemplateStore(),
    )

    async def fake_generate_notes_pipeline(**_: object) -> NotesPipelineArtifacts:
        return NotesPipelineArtifacts(
            evidence_batches=[],
            evidence_cards=[],
            outline={"title": "demo", "sections": []},
            outline_markdown="# demo",
            section_markdowns=[],
            coverage_report={"missing_items": []},
            notes_markdown="# demo\n\n## 章节\n- 细节",
        )

    async def fake_generate_summary_from_notes(**_: object) -> str:
        return "## 核心结论\n- summary"

    async def fake_generate_mindmap_from_notes(**_: object) -> str:
        return "```mindmap\nmindmap\n  root((demo))\n```"

    service.generate_notes_pipeline = fake_generate_notes_pipeline  # type: ignore[method-assign]
    service.generate_summary_from_notes = fake_generate_summary_from_notes  # type: ignore[method-assign]
    service.generate_mindmap_from_notes = fake_generate_mindmap_from_notes  # type: ignore[method-assign]

    bundle = await service.generate(
        title="demo",
        transcript_text="测试文本",
        llm_config_override={"mode": "api", "api_key": "test", "model": "qwen3.5-flash"},
    )
    assert bundle.summary_markdown == "## 核心结论\n- summary"
    assert bundle.notes_markdown.startswith("# demo")
    assert bundle.mindmap_markdown.startswith("```mindmap")


@pytest.mark.asyncio
async def test_generate_summary_from_notes_replaces_mermaid_block_with_image_markdown(tmp_path: Path) -> None:
    service = LLMService(
        settings=_build_settings(tmp_path),
        llm_config_store=_DummyLLMConfigStore(),
        prompt_template_store=_DummyPromptTemplateStore(),
    )

    async def _local_response(*args, **kwargs) -> str:  # type: ignore[no-untyped-def]
        _ = args
        _ = kwargs
        return "## 笔记\n\n```mermaid\nflowchart TD\nA-->B\n```"

    async def _render_ok(_code: str) -> tuple[str | None, str]:
        return ("data:image/png;base64,ZmFrZQ==", "")

    service._chat_markdown_once_local = _local_response  # type: ignore[method-assign]
    service._render_mermaid_png_data_url = _render_ok  # type: ignore[method-assign]

    summary = await service.generate_summary_from_notes(
        title="demo",
        notes_markdown="# demo\n\n## 章节\n- 细节",
        outline_markdown="# demo",
        summary_prompt="summary prompt",
        llm_config_override={"mode": "local", "local_model_id": "demo-local"},
    )
    assert "```mermaid" not in summary
    assert "data:image/png;base64,ZmFrZQ==" in summary
