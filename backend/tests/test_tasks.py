import io
from pathlib import Path
import zipfile

import orjson
import pytest
from fastapi.testclient import TestClient

from app.api.routes_tasks import _normalize_stream_event
from app.errors import AppError
from app.main import app
from app.models import TaskStatus
from app.services.task_preflight import TaskPreflightService


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


def test_create_url_task() -> None:
    with TestClient(app) as client:
        captured: list[str] = []

        async def fake_submit(submission) -> None:  # type: ignore[no-untyped-def]
            captured.append(submission.task_id)

        client.app.state.task_runner.submit = fake_submit
        response = client.post(
            "/api/tasks/url",
            json={
                "url": "BV1xx411c7mD",
                "model_size": "small",
                "language": "zh",
            },
        )
        assert response.status_code == 202
        payload = response.json()
        assert "task_id" in payload
        assert payload["status"] == "queued"
        assert payload["task_id"] in captured

        detail_response = client.get(f"/api/tasks/{payload['task_id']}")
        assert detail_response.status_code == 200
        detail = detail_response.json()
        assert "stage_logs" in detail
        assert set(detail["stage_logs"].keys()) == {"A", "B", "C", "D"}
        assert "stage_metrics" in detail
        assert set(detail["stage_metrics"].keys()) == {"A", "B", "C", "D"}


def test_create_task_runs_preflight_before_submit(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as client:
        steps: list[str] = []

        async def fake_preflight(
            _self: TaskPreflightService,
            *,
            workflow: str,
            stage: str = "full_task",
        ) -> None:
            steps.append(f"preflight:{workflow}:{stage}")

        async def fake_submit(submission) -> None:  # type: ignore[no-untyped-def]
            steps.append(f"submit:{submission.task_id}")

        monkeypatch.setattr(TaskPreflightService, "assert_ready_for_analysis", fake_preflight)
        client.app.state.task_runner.submit = fake_submit

        response = client.post(
            "/api/tasks/url",
            json={
                "url": "BV1xx411c7mD",
                "model_size": "small",
                "language": "zh",
                "workflow": "notes",
            },
        )

        assert response.status_code == 202
        assert steps[0] == "preflight:notes:full_task"
        assert steps[1].startswith("submit:task-")


def test_create_task_rejects_when_preflight_fails_without_persisting_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with TestClient(app) as client:
        async def fake_preflight(
            _self: TaskPreflightService,
            *,
            workflow: str,
            stage: str = "full_task",
        ) -> None:
            raise AppError.conflict(
                "运行前检查失败：LLM 服务未就绪。",
                code="TASK_PRECHECK_FAILED",
                hint="请先修复模型服务后重试。",
            )

        async def fake_submit(_submission) -> None:  # type: ignore[no-untyped-def]
            pytest.fail("preflight 失败后不应继续提交任务。")

        monkeypatch.setattr(TaskPreflightService, "assert_ready_for_analysis", fake_preflight)
        client.app.state.task_runner.submit = fake_submit

        response = client.post(
            "/api/tasks/url",
            json={
                "url": "BV1xx411c7mD",
                "model_size": "small",
                "language": "zh",
                "workflow": "notes",
            },
        )

        assert response.status_code == 409
        payload = response.json()
        assert payload["code"] == "TASK_PRECHECK_FAILED"
        assert client.get("/api/tasks").json()["total"] == 0


def test_task_detail_includes_fusion_prompt_markdown() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        task_store = client.app.state.task_store
        task_store.update(task_id, fusion_prompt_markdown="## Fusion Prompt")

        detail_response = client.get(f"/api/tasks/{task_id}")
        assert detail_response.status_code == 200
        detail = detail_response.json()
        assert detail["fusion_prompt_markdown"] == "## Fusion Prompt"


def test_remove_analysis_results_by_prefix() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        task_store = client.app.state.task_store
        task_store.upsert_analysis_result(task_id, "A", {"status": "completed"})
        task_store.upsert_analysis_result(task_id, "D", {"status": "failed"})
        task_store.upsert_analysis_result(task_id, "D:transcript_optimize", {"status": "completed"})
        task_store.remove_analysis_results(task_id, prefixes=("D:", "D"))

        analysis_dir = Path(client.app.state.settings.storage_dir) / "tasks" / "analysis-results" / task_id
        assert analysis_dir.exists()
        files = {path.stem for path in analysis_dir.glob("*.json")}
        assert "A" in files
        assert "D" not in files
        assert "D%3Atranscript_optimize" not in files


def test_update_task_title() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        rename_response = client.patch(
            f"/api/tasks/{task_id}/title",
            json={"title": "周会要点整理"},
        )
        assert rename_response.status_code == 200
        renamed = rename_response.json()
        assert renamed["title"] == "周会要点整理"

        detail_response = client.get(f"/api/tasks/{task_id}")
        assert detail_response.status_code == 200
        assert detail_response.json()["title"] == "周会要点整理"


def test_task_detail_vm_phase_metrics_respects_failed_stage_status() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        stage_metrics = {
            "A": {
                "status": "failed",
                "reason": "precheck failed",
                "started_at": "2026-04-04T00:00:00+00:00",
                "completed_at": "2026-04-04T00:00:01+00:00",
                "elapsed_seconds": 1.0,
                "log_count": 3,
            },
            "B": {"status": "pending"},
            "C": {"status": "pending"},
            "D": {
                "status": "pending",
                "substage_metrics": {
                    "transcript_optimize": {"status": "pending"},
                    "fusion_delivery": {"status": "pending"},
                },
            },
        }
        task_store = client.app.state.task_store
        task_store.update(
            task_id,
            status=TaskStatus.FAILED.value,
            stage_metrics_json=orjson.dumps(stage_metrics).decode("utf-8"),
        )

        detail_response = client.get(f"/api/tasks/{task_id}")
        assert detail_response.status_code == 200
        detail = detail_response.json()
        assert detail["vm_phase_metrics"]["A"]["status"] == "failed"
        assert detail["vm_phase_metrics"]["A"]["reason"] == "precheck failed"


def test_task_detail_vm_phase_metrics_keep_h_pending_before_fusion_start() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        stage_metrics = {
            "A": {"status": "completed"},
            "B": {"status": "completed"},
            "C": {"status": "completed"},
            "D": {
                "status": "running",
                "started_at": "2026-04-04T00:00:00+00:00",
                "substage_metrics": {
                    "transcript_optimize": {"status": "completed"},
                    "fusion_delivery": {"status": "pending"},
                },
            },
        }
        task_store = client.app.state.task_store
        task_store.update(
            task_id,
            status=TaskStatus.SUMMARIZING.value,
            stage_metrics_json=orjson.dumps(stage_metrics).decode("utf-8"),
        )

        detail_response = client.get(f"/api/tasks/{task_id}")
        assert detail_response.status_code == 200
        detail = detail_response.json()
        assert detail["vm_phase_metrics"]["transcript_optimize"]["status"] == "completed"
        assert detail["vm_phase_metrics"]["D"]["status"] == "pending"


def test_delete_task_requires_terminal_status() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        delete_response = client.delete(f"/api/tasks/{task_id}")
        assert delete_response.status_code == 409


def test_delete_completed_task() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        task_store = client.app.state.task_store
        record = task_store.get(task_id)
        assert record is not None
        task_store.update(task_id, status=TaskStatus.COMPLETED.value)
        task_store.upsert_analysis_result(task_id, "A", {"status": "completed"})
        event_log_path = Path(client.app.state.settings.storage_dir) / "event-logs" / f"{task_id}.jsonl"
        event_log_path.parent.mkdir(parents=True, exist_ok=True)
        event_log_path.write_text('{"type":"test"}\n', encoding="utf-8")
        stage_artifact_file = (
            Path(client.app.state.settings.storage_dir)
            / "tasks"
            / "stage-artifacts"
            / task_id
            / "D"
            / "fusion"
            / "summary.md"
        )
        stage_artifact_file.parent.mkdir(parents=True, exist_ok=True)
        stage_artifact_file.write_text("# summary", encoding="utf-8")
        temp_artifact_file = Path(client.app.state.settings.temp_dir) / task_id / "retry-stage-d" / "cache.json"
        temp_artifact_file.parent.mkdir(parents=True, exist_ok=True)
        temp_artifact_file.write_text('{"ok":true}', encoding="utf-8")
        uploaded_shadow_file = Path(client.app.state.settings.upload_dir) / f"{task_id}_uploaded.mp4"
        uploaded_shadow_file.parent.mkdir(parents=True, exist_ok=True)
        uploaded_shadow_file.write_bytes(b"shadow")

        delete_response = client.delete(f"/api/tasks/{task_id}")
        assert delete_response.status_code == 204

        detail_response = client.get(f"/api/tasks/{task_id}")
        assert detail_response.status_code == 404
        assert not event_log_path.exists()
        assert not stage_artifact_file.exists()
        assert not temp_artifact_file.exists()
        assert not uploaded_shadow_file.exists()


def test_cancel_running_task() -> None:
    with TestClient(app) as client:
        async def fake_submit(_) -> None:  # type: ignore[no-untyped-def]
            return

        async def fake_cancel(_task_id: str) -> bool:
            return True

        client.app.state.task_runner.submit = fake_submit
        client.app.state.task_runner.cancel = fake_cancel
        create_response = client.post(
            "/api/tasks/url",
            json={
                "url": "BV1xx411c7mD",
                "model_size": "small",
                "language": "zh",
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        cancel_response = client.post(f"/api/tasks/{task_id}/cancel")
        assert cancel_response.status_code == 202
        payload = cancel_response.json()
        assert payload["task_id"] == task_id
        assert payload["status"] == TaskStatus.CANCELLED.value


def test_pause_running_task() -> None:
    with TestClient(app) as client:
        async def fake_submit(_) -> None:  # type: ignore[no-untyped-def]
            return

        async def fake_pause(_task_id: str) -> bool:
            return True

        client.app.state.task_runner.submit = fake_submit
        client.app.state.task_runner.pause = fake_pause
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

        pause_response = client.post(f"/api/tasks/{task_id}/pause")
        assert pause_response.status_code == 202
        payload = pause_response.json()
        assert payload["task_id"] == task_id
        assert payload["status"] == TaskStatus.PAUSED.value


def test_resume_paused_task() -> None:
    with TestClient(app) as client:
        async def fake_submit(_) -> None:  # type: ignore[no-untyped-def]
            return

        async def fake_resume(_task_id: str) -> bool:
            return True

        client.app.state.task_runner.submit = fake_submit
        client.app.state.task_runner.resume = fake_resume
        create_response = client.post(
            "/api/tasks/url",
            json={
                "url": "BV1xx411c7mD",
                "model_size": "small",
                "language": "zh",
                "workflow": "notes",
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        client.app.state.task_store.update(task_id, status=TaskStatus.PAUSED.value)
        resume_response = client.post(f"/api/tasks/{task_id}/resume")
        assert resume_response.status_code == 202
        payload = resume_response.json()
        assert payload["task_id"] == task_id
        assert payload["status"] == TaskStatus.QUEUED.value


def test_rerun_stage_d_for_terminal_task() -> None:
    with TestClient(app) as client:
        async def fake_submit(_) -> None:  # type: ignore[no-untyped-def]
            return

        async def fake_rerun(_task_id: str) -> bool:
            return True

        client.app.state.task_runner.submit = fake_submit
        client.app.state.task_runner.rerun_stage_d = fake_rerun

        create_response = client.post(
            "/api/tasks/url",
            json={
                "url": "BV1xx411c7mD",
                "model_size": "small",
                "language": "zh",
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        task_store = client.app.state.task_store
        task_store.update(
            task_id,
            status=TaskStatus.FAILED.value,
            transcript_text="hello",
            transcript_segments_json=orjson.dumps([{"start": 0.0, "end": 1.0, "text": "hello"}]).decode("utf-8"),
        )
        rerun_response = client.post(f"/api/tasks/{task_id}/rerun-stage-d")
        assert rerun_response.status_code == 202
        payload = rerun_response.json()
        assert payload["task_id"] == task_id
        assert payload["status"] == TaskStatus.SUMMARIZING.value


def test_rerun_stage_d_rejected_when_task_not_terminal() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        rerun_response = client.post(f"/api/tasks/{task_id}/rerun-stage-d")
        assert rerun_response.status_code == 409


def test_cancel_terminal_task_rejected() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        task_store = client.app.state.task_store
        record = task_store.get(task_id)
        assert record is not None
        task_store.update(task_id, status=TaskStatus.COMPLETED.value)

        cancel_response = client.post(f"/api/tasks/{task_id}/cancel")
        assert cancel_response.status_code == 409


def test_export_srt_and_vtt_with_timeline_fixups() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        segments = [
            {"start": 1.2, "end": 1.2, "text": "第一句"},
            {"start": 1.4, "end": 2.0, "text": "第二句"},
            {"start": 3.0, "end": 2.8, "text": "第三句"},
            {"start": 4.0, "end": 5.0, "text": "   "},
        ]

        task_store = client.app.state.task_store
        record = task_store.get(task_id)
        assert record is not None
        task_store.update(
            task_id,
            status=TaskStatus.COMPLETED.value,
            title="字幕导出验证",
            transcript_segments_json=orjson.dumps(segments).decode("utf-8"),
        )

        srt_response = client.get(f"/api/tasks/{task_id}/export/srt")
        assert srt_response.status_code == 200
        srt_text = srt_response.text
        assert "1\n00:00:01,200 --> 00:00:01,500\n第一句" in srt_text
        assert "2\n00:00:01,500 --> 00:00:02,000\n第二句" in srt_text
        assert "3\n00:00:03,000 --> 00:00:03,300\n第三句" in srt_text
        assert "00:00:04,000" not in srt_text

        vtt_response = client.get(f"/api/tasks/{task_id}/export/vtt")
        assert vtt_response.status_code == 200
        vtt_text = vtt_response.text
        assert vtt_text.startswith("WEBVTT\n\n")
        assert "00:00:01.200 --> 00:00:01.500\n第一句" in vtt_text
        assert "00:00:01.500 --> 00:00:02.000\n第二句" in vtt_text
        assert "00:00:03.000 --> 00:00:03.300\n第三句" in vtt_text


def test_bundle_contains_subtitle_files() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        segments = [
            {"start": 0.0, "end": 0.5, "text": "hello"},
        ]

        task_store = client.app.state.task_store
        record = task_store.get(task_id)
        assert record is not None
        task_store.update(
            task_id,
            status=TaskStatus.COMPLETED.value,
            title="bundle-subtitle",
            transcript_segments_json=orjson.dumps(segments).decode("utf-8"),
        )

        bundle_response = client.get(f"/api/tasks/{task_id}/export/bundle?archive=zip")
        assert bundle_response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(bundle_response.content), mode="r") as archive:
            names = set(archive.namelist())
            assert "bundle-subtitle-subtitles.srt" in names
            assert "bundle-subtitle-subtitles.vtt" in names
            assert "bundle-subtitle-notes.md" in names
            assert "bundle-subtitle-summary.md" not in names
            assert "bundle-subtitle-stage-logs.json" not in names
            assert "bundle-subtitle-meta.json" not in names


def test_update_task_artifacts_after_completion() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        task_store = client.app.state.task_store
        record = task_store.get(task_id)
        assert record is not None
        task_store.update(
            task_id,
            status=TaskStatus.COMPLETED.value,
            title="editable-artifacts",
            summary_markdown="old summary",
            notes_markdown="old notes",
            mindmap_markdown="# Old Mindmap",
        )

        patch_response = client.patch(
            f"/api/tasks/{task_id}/artifacts",
            json={
                "summary_markdown": "new summary",
                "notes_markdown": "new notes",
                "mindmap_markdown": "# New Mindmap",
            },
        )
        assert patch_response.status_code == 200
        patched = patch_response.json()
        assert patched["summary_markdown"] == "new summary"
        assert patched["notes_markdown"] == "new notes"
        assert patched["mindmap_markdown"] == "# New Mindmap"

        bundle_response = client.get(f"/api/tasks/{task_id}/export/bundle?archive=zip")
        assert bundle_response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(bundle_response.content), mode="r") as archive:
            notes = archive.read("editable-artifacts-notes.md").decode("utf-8")
            mindmap = archive.read("editable-artifacts-mindmap.md").decode("utf-8")
            assert notes == "new notes"
            assert mindmap == "# New Mindmap"


def test_update_task_artifacts_rejects_running_task() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        patch_response = client.patch(
            f"/api/tasks/{task_id}/artifacts",
            json={
                "notes_markdown": "edited notes",
            },
        )
        assert patch_response.status_code == 409


def test_upload_batch_creates_multiple_tasks() -> None:
    with TestClient(app) as client:
        submitted: list[str] = []

        async def fake_submit(submission) -> None:  # type: ignore[no-untyped-def]
            submitted.append(submission.task_id)

        client.app.state.task_runner.submit = fake_submit
        files = [
            ("files", ("video-a.mp4", b"dummy-a", "video/mp4")),
            ("files", ("video-b.mp4", b"dummy-b", "video/mp4")),
        ]
        response = client.post(
            "/api/tasks/upload/batch",
            data={"workflow": "notes", "strategy": "single_task_per_file"},
            files=files,
        )
        assert response.status_code == 202
        payload = response.json()
        assert payload["strategy"] == "single_task_per_file"
        assert len(payload["tasks"]) == 2
        assert len(submitted) == 2


def test_upload_rejects_unsupported_video_extension() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/tasks/upload",
            data={"workflow": "notes"},
            files={"file": ("video.webm", b"dummy", "video/webm")},
        )

    assert response.status_code == 400
    payload = response.json()
    assert payload["code"] == "UNSUPPORTED_VIDEO_EXTENSION"


def test_create_task_from_path_rejects_unsupported_video_extension(tmp_path: Path) -> None:
    local_path = tmp_path / "demo.webm"
    local_path.write_bytes(b"dummy")

    with TestClient(app) as client:
        response = client.post(
            "/api/tasks/path",
            json={"local_path": str(local_path), "workflow": "notes", "language": "zh"},
        )

    assert response.status_code == 400
    payload = response.json()
    assert payload["code"] == "UNSUPPORTED_VIDEO_EXTENSION"


def test_task_events_stream_maps_frontend_event_contract() -> None:
    event = _normalize_stream_event(
        task_id="task-demo",
        workflow="vqa",
        event={
            "type": "progress",
            "stage": "C",
            "overall_progress": 45,
        },
    )
    assert event["type"] == "step_updated"
    assert event["task_id"] == "task-demo"
    assert event["workflow"] == "vqa"
    assert event["timestamp"]


def test_running_task_has_eta_seconds() -> None:
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
            },
        )
        assert create_response.status_code == 202
        task_id = create_response.json()["task_id"]

        stage_metrics = {
            "A": {"status": "completed", "elapsed_seconds": 10},
            "B": {"status": "completed", "elapsed_seconds": 5},
            "C": {"status": "running", "elapsed_seconds": 15},
            "D": {"status": "pending"},
        }
        task_store = client.app.state.task_store
        task_store.update(
            task_id,
            status=TaskStatus.TRANSCRIBING.value,
            progress=50,
            stage_metrics_json=orjson.dumps(stage_metrics).decode("utf-8"),
        )

        detail_response = client.get(f"/api/tasks/{task_id}")
        assert detail_response.status_code == 200
        payload = detail_response.json()
        assert payload["status"] == "running"
        assert payload["eta_seconds"] is not None
        assert int(payload["eta_seconds"]) > 0

