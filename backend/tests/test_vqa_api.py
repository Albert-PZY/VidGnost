from __future__ import annotations

import orjson
from fastapi.testclient import TestClient

from app.main import app
from app.models import TaskStatus


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
