from __future__ import annotations

import asyncio
from pathlib import Path

from app.config import Settings
from app.workers import gpu_stage_worker


class _StubResult:
    def __init__(self) -> None:
        self.segments = [
            {"start": 0.0, "end": 1.2, "text": "第一句"},
            {"start": 1.2, "end": 2.4, "text": "第二句"},
        ]
        self.language = "zh"


class _StubWhisperService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.shutdown_called = False

    async def transcribe(
        self,
        *,
        audio_path: Path,
        model_size: str,
        language: str | None,
        model_default: str,
        device: str,
        compute_type: str,
        beam_size: int,
        vad_filter: bool,
        model_load_profile: str,
        timestamp_offset_seconds: float,
        on_segment,
    ) -> _StubResult:
        assert audio_path.exists()
        assert model_size == "small"
        assert model_default == "small"
        assert device == "cuda"
        assert compute_type == "int8"
        assert beam_size == 5
        assert vad_filter is True
        assert model_load_profile == "balanced"
        assert language == "zh"
        on_segment({"start": 0.0 + timestamp_offset_seconds, "end": 1.2 + timestamp_offset_seconds, "text": "第一句"})
        return _StubResult()

    def shutdown(self) -> None:
        self.shutdown_called = True


def test_gpu_stage_worker_emits_segment_and_completion_events(tmp_path: Path, monkeypatch, capsys) -> None:
    chunk_path = tmp_path / "chunk-0001.wav"
    chunk_path.write_bytes(b"fake-audio")

    monkeypatch.setattr(gpu_stage_worker, "WhisperService", _StubWhisperService)
    monkeypatch.setattr(
        gpu_stage_worker,
        "get_settings",
        lambda: Settings(
            storage_dir=str(tmp_path / "storage"),
            temp_dir=str(tmp_path / "storage" / "tmp"),
            upload_dir=str(tmp_path / "storage" / "uploads"),
            output_dir=str(tmp_path / "storage" / "outputs"),
            llm_config_path=str(tmp_path / "storage" / "model_config.json"),
            runtime_config_path=str(tmp_path / "storage" / "config.toml"),
        ),
    )

    asyncio.run(
        gpu_stage_worker._run_whisper_transcribe_stage(
            {
                "task_id": "task-1",
                "selected_model": "small",
                "selected_language": "zh",
                "whisper_config": {
                    "model_default": "small",
                    "device": "cuda",
                    "compute_type": "int8",
                    "beam_size": 5,
                    "vad_filter": True,
                    "model_load_profile": "balanced",
                },
                "chunks": [
                    {
                        "chunk_index": 0,
                        "path": str(chunk_path),
                        "start_seconds": 0.0,
                        "duration_seconds": 2.4,
                    }
                ],
            }
        )
    )

    stdout = capsys.readouterr().out.splitlines()
    worker_lines = [line for line in stdout if line.startswith("@@VIDGNOST_GPU_WORKER@@ ")]
    assert any('"type":"segment"' in line for line in worker_lines)
    assert any('"type":"chunk_complete"' in line for line in worker_lines)
    assert any('"type":"completed"' in line for line in worker_lines)
