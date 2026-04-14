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


class FakeOllamaServiceManager:
    def __init__(
        self,
        *,
        recognized_by_service: bool = False,
        files_present_in_configured_dir: bool = False,
        reachable: bool = True,
        restart_required: bool = False,
        message: str = "",
    ) -> None:
        self.recognized_by_service = recognized_by_service
        self.files_present_in_configured_dir = files_present_in_configured_dir
        self.reachable = reachable
        self.restart_required = restart_required
        self.message = message
        self.inspect_calls: list[str] = []

    async def inspect_model(self, model_name: str) -> dict[str, object]:
        self.inspect_calls.append(model_name)
        return {
            "recognized_by_service": self.recognized_by_service,
            "files_present_in_configured_dir": self.files_present_in_configured_dir,
            "configured_storage_path": f"D:/models/{model_name}",
            "message": self.message,
            "service": {
                "reachable": self.reachable,
                "process_detected": True,
                "process_id": 9527,
                "executable_path": "D:/Ollama/ollama.exe",
                "configured_models_dir": "D:/models",
                "effective_models_dir": "D:/models",
                "models_dir_source": "env",
                "using_configured_models_dir": not self.restart_required,
                "restart_required": self.restart_required,
                "can_self_restart": True,
                "message": self.message,
            },
        }


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


def test_model_download_service_skips_pull_when_ollama_already_recognizes_model(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    ollama_client = CompletingOllamaClient()
    ollama_service_manager = FakeOllamaServiceManager(
        recognized_by_service=True,
        message="当前 Ollama 已识别该模型，无需重新安装。",
    )
    service = ModelDownloadService(
        settings,
        whisper_service=CompletingWhisperService(),  # type: ignore[arg-type]
        ollama_client=ollama_client,  # type: ignore[arg-type]
        ollama_service_manager=ollama_service_manager,  # type: ignore[arg-type]
    )

    async def run() -> None:
        snapshot = await service.start_download("embedding-default")
        assert snapshot["state"] == "completed"
        assert snapshot["message"] == "当前 Ollama 已识别该模型，无需重新安装。"
        assert snapshot["percent"] == 100.0
        assert ollama_service_manager.inspect_calls == ["bge-m3"]
        assert ollama_client.calls == []
        await service.shutdown()

    asyncio.run(run())


def test_model_download_service_blocks_pull_when_files_already_exist_but_service_not_switched(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    ollama_client = CompletingOllamaClient()
    ollama_service_manager = FakeOllamaServiceManager(
        files_present_in_configured_dir=True,
        reachable=False,
        restart_required=True,
        message="模型文件已存在于配置目录，但当前 Ollama 服务尚未从该目录加载模型，请先启动或重启 Ollama 服务后刷新检测。",
    )
    service = ModelDownloadService(
        settings,
        whisper_service=CompletingWhisperService(),  # type: ignore[arg-type]
        ollama_client=ollama_client,  # type: ignore[arg-type]
        ollama_service_manager=ollama_service_manager,  # type: ignore[arg-type]
    )

    async def run() -> None:
        snapshot = await service.start_download("embedding-default")
        assert snapshot["state"] == "failed"
        assert "模型文件已存在于配置目录" in snapshot["message"]
        assert ollama_service_manager.inspect_calls == ["bge-m3"]
        assert ollama_client.calls == []
        await service.shutdown()

    asyncio.run(run())
