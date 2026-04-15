from __future__ import annotations

import orjson
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import TaskStatus
from app.services.task_preflight import TaskPreflightService
from app.services.vqa_model_runtime import VQAModelRuntime


@pytest.fixture(autouse=True)
def stub_task_preflight(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_preflight(
        _self: TaskPreflightService,
        *,
        workflow: str,
        stage: str = "full_task",
    ) -> None:
        _ = workflow
        _ = stage

    monkeypatch.setattr(TaskPreflightService, "assert_ready_for_analysis", fake_preflight)


@pytest.fixture(autouse=True)
def stub_vqa_models(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_embed_texts(_self: VQAModelRuntime, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            normalized = str(text)
            vectors.append(
                [
                    float(len(normalized) % 13 + 1),
                    float(normalized.count("用户") + 1),
                    float(normalized.count("设计") + 1),
                ]
            )
        return vectors

    async def fake_embed_query_text(_self: VQAModelRuntime, query_text: str) -> list[float]:
        vectors = await fake_embed_texts(_self, [query_text])
        return vectors[0] if vectors else []

    async def fake_embed_documents(
        _self: VQAModelRuntime,
        documents: list[object],
        *,
        multimodal: bool,
    ) -> list[list[float]]:
        _ = multimodal
        texts = [
            f"{str(getattr(item, 'text', '')).strip()} {str(getattr(item, 'visual_text', '')).strip()}".strip()
            for item in documents
        ]
        return await fake_embed_texts(_self, texts)

    async def fake_use_multimodal_retrieval_route(_self: VQAModelRuntime) -> bool:
        return False

    async def fake_score_rerank_pairs(
        _self: VQAModelRuntime,
        *,
        query: str,
        documents: list[str],
        image_paths: list[str] | None = None,
    ) -> list[float]:
        _ = query
        _ = image_paths
        return [max(0.1, 1.0 - index * 0.1) for index, _ in enumerate(documents)]

    async def fake_describe_images(_self: VQAModelRuntime, image_paths: list[str]) -> list[str]:
        return [f"测试关键帧 {index + 1}" for index, _ in enumerate(image_paths)]

    monkeypatch.setattr(VQAModelRuntime, "embed_texts", fake_embed_texts)
    monkeypatch.setattr(VQAModelRuntime, "embed_query_text", fake_embed_query_text)
    monkeypatch.setattr(VQAModelRuntime, "embed_documents", fake_embed_documents)
    monkeypatch.setattr(VQAModelRuntime, "use_multimodal_retrieval_route", fake_use_multimodal_retrieval_route)
    monkeypatch.setattr(VQAModelRuntime, "score_rerank_pairs", fake_score_rerank_pairs)
    monkeypatch.setattr(VQAModelRuntime, "describe_images", fake_describe_images)


def test_vqa_search_supports_question_alias() -> None:
    with TestClient(app) as client:
        async def fake_submit(_) -> None:  # type: ignore[no-untyped-def]
            return

        client.app.state.task_runner.submit = fake_submit
        create_response = client.post(
            "/api/tasks/url",
            json={
                "url": "BV1xx411c7mD",
                "model_size": "small",
                "language": "zh",
                "workflow": "vqa",
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        task_store = client.app.state.task_store
        task_store.update(
            task_id,
            status=TaskStatus.COMPLETED.value,
            transcript_segments_json=orjson.dumps(
                [
                    {"start": 0.0, "end": 2.0, "text": "用户体验设计要关注用户目标。"},
                    {"start": 2.0, "end": 4.0, "text": "需要结合场景做交互设计。"},
                ]
            ).decode("utf-8"),
        )

        response = client.post(
            "/api/search",
            json={
                "question": "用户体验设计核心是什么",
                "task_id": task_id,
                "top_k": 5,
            },
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["trace_id"]
        assert isinstance(payload.get("results", []), list)
        if payload["results"]:
            assert "source" in payload["results"][0]
        if payload.get("hits"):
            assert isinstance(payload["hits"][0].get("source_set"), list)


def test_vqa_query_required_error_has_hint_and_retryable() -> None:
    with TestClient(app) as client:
        response = client.post("/api/search", json={})
        assert response.status_code == 400
        payload = response.json()
        assert payload["code"] == "VQA_QUERY_REQUIRED"
        assert "hint" in payload
        assert "retryable" in payload
        assert payload["retryable"] is False


def test_vqa_trace_reports_real_frame_hits_and_readable_scores(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from app.services import vqa_ollama_retriever as vqa_retriever_module

    def fake_extract_video_frames(
        media_path: Path,
        output_dir: Path,
        *,
        interval_seconds: float = 10.0,
        quality: int = 4,
    ) -> list[Path]:
        _ = media_path
        _ = interval_seconds
        _ = quality
        output_dir.mkdir(parents=True, exist_ok=True)
        frame_path = output_dir / "frame-000000.jpg"
        frame_path.write_bytes(b"frame")
        return [frame_path]

    monkeypatch.setattr(vqa_retriever_module, "extract_video_frames", fake_extract_video_frames)

    with TestClient(app) as client:
        async def fake_submit(_) -> None:  # type: ignore[no-untyped-def]
            return

        client.app.state.task_runner.submit = fake_submit
        video_path = tmp_path / "demo.mp4"
        video_path.write_bytes(b"video")

        create_response = client.post(
            "/api/tasks/path",
            json={
                "local_path": str(video_path),
                "model_size": "small",
                "language": "zh",
                "workflow": "vqa",
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        task_store = client.app.state.task_store
        task_store.update(
            task_id,
            status=TaskStatus.COMPLETED.value,
            transcript_segments_json=orjson.dumps(
                [
                    {"start": 0.0, "end": 4.0, "text": "用户体验设计要围绕真实用户目标展开。"},
                    {"start": 4.0, "end": 8.0, "text": "交互设计要匹配使用场景和关键任务。"},
                ]
            ).decode("utf-8"),
        )

        response = client.post(
            "/api/search",
            json={
                "question": "用户体验设计核心是什么",
                "task_id": task_id,
                "top_k": 5,
            },
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["trace_id"]
        assert payload["dense_hits"]
        assert payload["sparse_hits"]
        assert payload["rerank_hits"]
        assert payload["dense_hits"][0]["dense_score"] > 0
        assert isinstance(payload["sparse_hits"][0]["sparse_score"], (int, float))
        assert payload["rerank_hits"][0]["image_path"].startswith("frames/")

        dense_texts = [item["text"] for item in payload["dense_hits"]]
        rerank_texts = [item["text"] for item in payload["rerank_hits"]]
        assert len(dense_texts) == len(set(dense_texts))
        assert len(rerank_texts) == len(set(rerank_texts))

        trace_response = client.get(f"/api/traces/{payload['trace_id']}")
        assert trace_response.status_code == 200
        trace_payload = trace_response.json()
        trace_started = next(item for item in trace_payload["records"] if item["stage"] == "trace_started")
        assert trace_started["payload"]["config_snapshot"]["retrieval"]["query_expansion"] is False
