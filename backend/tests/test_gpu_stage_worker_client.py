from __future__ import annotations

import asyncio
import io
from pathlib import Path

from app.config import Settings
from app.services.gpu_stage_worker_client import GPUStageWorkerClient


class _FakePopen:
    def __init__(self, *args, **kwargs) -> None:
        _ = args
        _ = kwargs
        self.stdin = io.BytesIO()
        self.stdout = io.BytesIO(
            b'@@VIDGNOST_GPU_WORKER@@ {"type":"chunk_start","chunk_index":0}\n'
            b'@@VIDGNOST_GPU_WORKER@@ {"type":"completed","result":{"task_id":"task-1","chunk_count":1}}\n'
        )
        self.stderr = io.BytesIO(b"")
        self._returncode: int | None = None

    def poll(self) -> int | None:
        return self._returncode

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        self._returncode = 0
        return 0

    def terminate(self) -> None:
        self._returncode = 0

    def kill(self) -> None:
        self._returncode = -9


def _build_settings(tmp_path: Path) -> Settings:
    return Settings(
        storage_dir=str(tmp_path / "storage"),
        temp_dir=str(tmp_path / "storage" / "tmp"),
        upload_dir=str(tmp_path / "storage" / "uploads"),
        output_dir=str(tmp_path / "storage" / "outputs"),
        llm_config_path=str(tmp_path / "storage" / "model_config.json"),
        runtime_config_path=str(tmp_path / "storage" / "config.toml"),
    )


def test_gpu_stage_worker_client_runs_via_blocking_subprocess_bridge(tmp_path: Path, monkeypatch) -> None:
    settings = _build_settings(tmp_path)
    client = GPUStageWorkerClient(settings)
    seen_event_types: list[str] = []

    monkeypatch.setattr("app.services.gpu_stage_worker_client.subprocess.Popen", _FakePopen)

    async def run_client() -> dict[str, object]:
        return await client.run(
            {"operation": "fake", "payload": {"task_id": "task-1"}},
            on_event=lambda event: seen_event_types.append(str(event.get("type", ""))),
        )

    result = asyncio.run(run_client())

    assert seen_event_types == ["chunk_start", "completed"]
    assert result["task_id"] == "task-1"
    assert result["chunk_count"] == 1
