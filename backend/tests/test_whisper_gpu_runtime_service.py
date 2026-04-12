from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.config import Settings
from app.services.runtime_config_store import RuntimeConfigStore
from app.services.whisper_gpu_runtime_service import WhisperGpuRuntimeService, _build_snapshot


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


def test_whisper_gpu_runtime_service_resolves_installer_script_from_repo_root(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    service = WhisperGpuRuntimeService(
        settings=settings,
        runtime_config_store=RuntimeConfigStore(settings),
    )

    expected_script = Path(__file__).resolve().parents[2] / "scripts" / "install-whisper-gpu-runtime.ps1"

    assert service._installer_script == expected_script  # type: ignore[attr-defined]
    assert service._installer_script.exists()  # type: ignore[attr-defined]


def test_whisper_gpu_runtime_service_restores_incomplete_install_as_paused(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    store = RuntimeConfigStore(settings)
    service = WhisperGpuRuntimeService(
        settings=settings,
        runtime_config_store=store,
    )
    install_dir = str((tmp_path / "gpu-runtime").resolve())
    asyncio.run(service.save_config(install_dir=install_dir, auto_configure_env=False))

    state_path = service._state_file_path(install_dir)  # type: ignore[attr-defined]
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(
            {
                "state": "installing",
                "message": "正在下载 libcublas ...",
                "current_package": "libcublas",
                "downloaded_bytes": 512,
                "total_bytes": 2048,
                "percent": 25.0,
                "speed_bps": 1024.0,
                "resumable": True,
            }
        ),
        encoding="utf-8",
    )

    status = asyncio.run(service.get_status())

    assert status["progress"]["state"] == "paused"
    assert status["progress"]["resumable"] is True
    assert status["status"] == "paused"


@pytest.mark.asyncio
async def test_whisper_gpu_runtime_service_pause_install_updates_snapshot(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    store = RuntimeConfigStore(settings)
    service = WhisperGpuRuntimeService(
        settings=settings,
        runtime_config_store=store,
    )
    install_dir = str((tmp_path / "gpu-runtime").resolve())

    async def fake_run_install(config) -> None:
        await service._set_snapshot(  # type: ignore[attr-defined]
            _build_snapshot(
                state="installing",
                message="正在下载 cuda_cudart ...",
                current_package="cuda_cudart",
                downloaded_bytes=256,
                total_bytes=4096,
                percent=6.25,
                speed_bps=2048.0,
                resumable=True,
            ),
            install_dir=config["install_dir"],
        )
        while not service._pause_requested:  # type: ignore[attr-defined]
            await asyncio.sleep(0.01)
        await service._set_snapshot(  # type: ignore[attr-defined]
            _build_snapshot(
                state="paused",
                message="下载已暂停，可随时继续。",
                current_package="cuda_cudart",
                downloaded_bytes=768,
                total_bytes=4096,
                percent=18.75,
                resumable=True,
            ),
            install_dir=config["install_dir"],
        )

    service._run_install = fake_run_install  # type: ignore[method-assign]

    await service.start_install(install_dir=install_dir, auto_configure_env=False)
    status = await service.pause_install()

    assert status["progress"]["state"] == "paused"
    assert status["progress"]["resumable"] is True
    assert status["status"] == "paused"
