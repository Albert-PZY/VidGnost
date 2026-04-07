from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.services.events import EventBus
from app.services.self_check import (
    SelfCheckService,
    SelfCheckSession,
    _prune_terminal_self_check_sessions,
)


def test_self_check_start_and_report() -> None:
    with TestClient(app) as client:
        start_response = client.post("/api/self-check/start")
        assert start_response.status_code == 200
        payload = start_response.json()
        session_id = payload["session_id"]
        assert payload["status"] == "running"

        report = None
        for _ in range(80):
            response = client.get(f"/api/self-check/{session_id}/report")
            assert response.status_code == 200
            report = response.json()
            if report["status"] in {"completed", "failed"}:
                break
            time.sleep(0.1)

        assert report is not None
        assert report["session_id"] == session_id
        assert isinstance(report["steps"], list)
        assert len(report["steps"]) > 0
        assert "progress" in report


def test_self_check_report_not_found() -> None:
    with TestClient(app) as client:
        response = client.get("/api/self-check/not-exist-session/report")
        assert response.status_code == 404


def test_self_check_prune_keeps_running_and_newest_terminal_sessions() -> None:
    sessions = {
        "completed-oldest": SelfCheckSession(
            id="completed-oldest",
            status="completed",
            updated_at="2026-01-01T00:00:00+00:00",
        ),
        "failed-old": SelfCheckSession(
            id="failed-old",
            status="failed",
            updated_at="2026-01-01T00:01:00+00:00",
        ),
        "running-new": SelfCheckSession(
            id="running-new",
            status="running",
            updated_at="2026-01-01T00:02:00+00:00",
        ),
        "completed-newest": SelfCheckSession(
            id="completed-newest",
            status="completed",
            updated_at="2026-01-01T00:03:00+00:00",
        ),
    }

    _prune_terminal_self_check_sessions(sessions, max_sessions=2)

    assert set(sessions.keys()) == {"running-new", "completed-newest"}


def test_self_check_build_steps_is_api_only() -> None:
    service = SelfCheckService(settings=get_settings(), event_bus=EventBus())
    step_ids = [item.id for item in service._build_steps()]  # type: ignore[attr-defined]
    assert "env" in step_ids
    assert "ffmpeg" in step_ids
    assert "gpu-driver" in step_ids
    assert "model-cache" in step_ids
    assert "llm-local-config" not in step_ids
