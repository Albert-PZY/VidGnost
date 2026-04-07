from app.services.task_runner import (
    _join_transcript_segment_texts,
    _resolve_execution_mode,
)


def test_join_transcript_segment_texts_skips_empty_entries() -> None:
    text = _join_transcript_segment_texts(
        [
            {"start": 0.0, "end": 0.8, "text": "第一句"},
            {"start": 0.8, "end": 1.2, "text": "   "},
            {"start": 1.2, "end": 2.4, "text": "第二句"},
        ]
    )
    assert text == "第一句\n第二句"


def test_resolve_execution_mode_is_api_only() -> None:
    mode_local_llm = _resolve_execution_mode(
        llm_runtime_config={"mode": "local"},
    )
    assert mode_local_llm == "api"

    mode_api = _resolve_execution_mode(
        llm_runtime_config={"mode": "api"},
    )
    assert mode_api == "api"
