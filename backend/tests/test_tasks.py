import io
from pathlib import Path
from fastapi.testclient import TestClient
import orjson
import zipfile

from app.main import app
from app.models import TaskStatus


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

        delete_response = client.delete(f"/api/tasks/{task_id}")
        assert delete_response.status_code == 204

        detail_response = client.get(f"/api/tasks/{task_id}")
        assert detail_response.status_code == 404
        assert not event_log_path.exists()
        assert not stage_artifact_file.exists()


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

