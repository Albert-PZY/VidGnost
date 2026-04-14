from pathlib import Path

from app.services.task_runner import (
    TaskSubmission,
    _join_transcript_segment_texts,
    _resolve_persisted_source_media_path,
    _resolve_execution_mode,
)
from app.services.ingestion import IngestionResult


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


def test_resolve_persisted_source_media_path_keeps_stable_local_source_path() -> None:
    submission = TaskSubmission(
        task_id="task-local",
        source_type="local_file",
        source_input="demo.mp4",
        source_local_path="F:/stable/uploads/task-local_demo.mp4",
        model_size="small",
        language="zh",
        workflow="notes",
    )
    ingestion_result = IngestionResult(
        media_path=Path("F:/storage/tmp/task-local/task-local.mp4"),
        title="demo",
        duration_seconds=12.3,
    )

    assert _resolve_persisted_source_media_path(submission, ingestion_result) == Path(
        "F:/stable/uploads/task-local_demo.mp4"
    )


def test_resolve_persisted_source_media_path_uses_persisted_bilibili_media_path() -> None:
    submission = TaskSubmission(
        task_id="task-remote",
        source_type="bilibili",
        source_input="https://www.bilibili.com/video/BV1xx411c7mD",
        source_local_path=None,
        model_size="small",
        language="zh",
        workflow="notes",
    )
    ingestion_result = IngestionResult(
        media_path=Path("F:/storage/uploads/task-remote_demo.mp4"),
        title="demo",
        duration_seconds=12.3,
    )

    assert _resolve_persisted_source_media_path(submission, ingestion_result) == Path(
        "F:/storage/uploads/task-remote_demo.mp4"
    )
