from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.services.llm_config_store import LLMConfigStore
from app.services.task_store import TaskStore
from app.services.vqa_chat_service import ChatResult
from app.services.vqa_runtime_service import SearchBundle, VQARuntimeService
from app.services.vqa_types import RetrievalHit, SearchResult


def _build_settings(tmp_path: Path) -> Settings:
    storage_dir = tmp_path / "storage"
    return Settings(
        storage_dir=str(storage_dir),
        temp_dir=str(storage_dir / "tmp"),
        upload_dir=str(storage_dir / "uploads"),
        output_dir=str(storage_dir / "outputs"),
        runtime_config_path=str(storage_dir / "config.toml"),
        llm_config_path=str(storage_dir / "model_config.json"),
    )


def _build_hit() -> RetrievalHit:
    return RetrievalHit(
        doc_id="doc-1",
        task_id="task-1",
        task_title="RAG Demo",
        text="RAG 会先检索证据，再基于证据生成回答。",
        video_path="demo.mp4",
        start=720.0,
        end=730.0,
        source="audio+visual",
        source_set=["dense", "rerank"],
        image_path="frames/frame-0001.jpg",
        visual_text="画面中展示了检索增强生成流程示意。",
        dense_score=0.92,
        sparse_score=0.81,
        rrf_score=0.88,
        rerank_score=0.9,
        final_score=0.9,
    )


def _build_search_bundle(query_text: str) -> SearchBundle:
    hit = _build_hit()
    return SearchBundle(
        trace_id="trace-test-1",
        result=SearchResult(
            query_text=query_text,
            dense_hits=[hit],
            sparse_hits=[hit],
            rrf_hits=[hit],
            rerank_hits=[hit],
        ),
    )


@pytest.mark.asyncio
async def test_vqa_stream_chat_replaces_partial_answer_after_stream_fallback(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = _build_settings(tmp_path)
    runtime = VQARuntimeService(
        task_store=TaskStore(settings.storage_dir),
        llm_config_store=LLMConfigStore(settings),
        storage_dir=settings.storage_dir,
    )

    async def fake_search(**kwargs: object) -> SearchBundle:
        return _build_search_bundle(str(kwargs.get("query_text", "")))

    monkeypatch.setattr(runtime, "search", fake_search)

    async def fake_stream_answer(**_: object):
        yield {
            "type": "citations",
            "citations": [_build_hit().to_dict()],
            "context_tokens_approx": 42,
        }
        yield {"type": "chunk", "delta": "RAG 会先检索"}
        yield {
            "type": "error",
            "error": {
                "code": "LLM_STREAM_ERROR",
                "message": "peer closed connection without sending complete message body (incomplete chunked read)",
            },
        }

    async def fake_answer(**_: object) -> ChatResult:
        return ChatResult(
            answer="RAG 会先检索相关证据，再结合证据生成回答。",
            citations=[],
            context_tokens_approx=42,
            error=None,
        )

    monkeypatch.setattr(runtime._chat, "stream_answer", fake_stream_answer)
    monkeypatch.setattr(runtime._chat, "answer", fake_answer)

    events = [event async for event in runtime.stream_chat(query_text="什么是 RAG", task_id="task-1")]

    assert [event["status"] for event in events if event.get("type") == "status"] == [
        "retrieving",
        "generating",
        "fallback",
    ]
    assert not any(event.get("type") == "error" for event in events)
    replace_event = next(event for event in events if event.get("type") == "replace")
    assert replace_event["content"] == "RAG 会先检索相关证据，再结合证据生成回答。"


def test_vqa_chat_stream_route_returns_structured_error_instead_of_broken_chunk(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as client:
        async def fake_stream_chat(**_: object):
            if False:
                yield {}
            raise RuntimeError("unexpected stream transport break")

        monkeypatch.setattr(client.app.state.vqa_runtime, "stream_chat", fake_stream_chat)

        response = client.post(
            "/api/chat/stream",
            json={
                "question": "什么是 RAG",
                "task_id": "task-1",
                "top_k": 5,
            },
        )

        assert response.status_code == 200
        assert '"type":"error"' in response.text
        assert '"code":"VQA_STREAM_TRANSPORT_ERROR"' in response.text
        assert "[DONE]" in response.text
