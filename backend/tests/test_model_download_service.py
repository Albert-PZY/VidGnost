from __future__ import annotations

import asyncio
from pathlib import Path

from app.config import Settings
from app.services.model_download_service import ModelDownloadService


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


class CompletingWhisperService:
    def __init__(self) -> None:
        self.force_redownload_values: list[bool] = []

    async def ensure_small_model_ready(self, on_progress=None, force_redownload: bool = False) -> None:
        self.force_redownload_values.append(force_redownload)
        if on_progress is not None:
            await on_progress(
                {
                    "status": "downloading",
                    "message": "Downloading Whisper small model...",
                    "current_file": "model.bin",
                    "downloaded_bytes": 32,
                    "total_bytes": 64,
                    "percent": 50.0,
                    "speed_bps": 128.0,
                }
            )
            await on_progress(
                {
                    "status": "completed",
                    "message": "Whisper small model downloaded and ready.",
                    "current_file": "",
                    "downloaded_bytes": 64,
                    "total_bytes": 64,
                    "percent": 100.0,
                    "speed_bps": 128.0,
                }
            )

    def shutdown(self) -> None:
        return None


class BlockingWhisperService:
    def __init__(self) -> None:
        self.cancelled = False

    async def ensure_small_model_ready(self, on_progress=None, force_redownload: bool = False) -> None:
        if on_progress is not None:
            await on_progress(
                {
                    "status": "downloading",
                    "message": "Downloading Whisper small model...",
                    "current_file": "model.bin",
                    "downloaded_bytes": 8,
                    "total_bytes": 64,
                    "percent": 12.5,
                    "speed_bps": 64.0,
                }
            )
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            self.cancelled = True
            raise

    def shutdown(self) -> None:
        return None


class CompletingOllamaClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def pull_model(
        self,
        *,
        model: str,
        on_progress=None,
    ) -> None:
        self.calls.append(
            {
                "model": model,
            }
        )
        if on_progress is not None:
            await on_progress(
                {
                    "status": "downloading",
                    "message": f"pulling {model}",
                    "current_file": model,
                    "downloaded_bytes": 64,
                    "total_bytes": 128,
                    "percent": 50.0,
                    "speed_bps": 256.0,
                }
            )
            await on_progress(
                {
                    "status": "completed",
                    "message": f"{model} ready.",
                    "current_file": "",
                    "downloaded_bytes": 128,
                    "total_bytes": 128,
                    "percent": 100.0,
                    "speed_bps": 256.0,
                }
            )


def test_model_download_service_tracks_completion_and_force_flag(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    whisper_service = CompletingWhisperService()
    service = ModelDownloadService(settings, whisper_service=whisper_service)  # type: ignore[arg-type]

    async def run() -> None:
        await service.start_download("whisper-default", force_redownload=True)
        for _ in range(20):
            snapshot = await service.get_snapshot("whisper-default")
            if snapshot["state"] == "completed":
                break
            await asyncio.sleep(0.01)
        snapshot = await service.get_snapshot("whisper-default")
        assert snapshot["state"] == "completed"
        assert snapshot["percent"] == 100.0
        assert whisper_service.force_redownload_values == [True]
        await service.shutdown()

    asyncio.run(run())


def test_model_download_service_cancels_running_download(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    whisper_service = BlockingWhisperService()
    service = ModelDownloadService(settings, whisper_service=whisper_service)  # type: ignore[arg-type]

    async def run() -> None:
        await service.start_download("whisper-default")
        await asyncio.sleep(0.02)
        snapshot = await service.cancel_download("whisper-default")
        assert snapshot["state"] == "cancelled"
        assert whisper_service.cancelled is True
        await service.shutdown()

    asyncio.run(run())


def test_model_download_service_uses_ollama_pull_for_non_whisper_models(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    whisper_service = CompletingWhisperService()
    ollama_client = CompletingOllamaClient()
    service = ModelDownloadService(
        settings,
        whisper_service=whisper_service,  # type: ignore[arg-type]
        ollama_client=ollama_client,  # type: ignore[arg-type]
    )

    async def run() -> None:
        await service.start_download("embedding-default", force_redownload=True)
        for _ in range(40):
            snapshot = await service.get_snapshot("embedding-default")
            if snapshot["state"] == "completed":
                break
            await asyncio.sleep(0.01)
        snapshot = await service.get_snapshot("embedding-default")
        assert snapshot["state"] == "completed"
        assert ollama_client.calls
        assert ollama_client.calls[0]["model"] == "bge-m3"
        assert whisper_service.force_redownload_values == []
        await service.shutdown()

    asyncio.run(run())
