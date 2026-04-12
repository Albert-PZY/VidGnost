from __future__ import annotations

from pathlib import Path

from app.config import Settings
from app.services.runtime_config_store import RuntimeConfigStore
from app.services.whisper_gpu_runtime_service import WhisperGpuRuntimeService


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
