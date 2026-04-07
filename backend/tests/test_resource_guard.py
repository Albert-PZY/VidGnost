from pathlib import Path

from app.config import Settings
from app.services.resource_guard import ResourceGuard


def _build_settings(tmp_path: Path) -> Settings:
    return Settings(
        storage_dir=str(tmp_path / "storage"),
        temp_dir=str(tmp_path / "storage" / "tmp"),
        upload_dir=str(tmp_path / "storage" / "uploads"),
        output_dir=str(tmp_path / "storage" / "outputs"),
        llm_config_path=str(tmp_path / "storage" / "model_config.json"),
        runtime_config_path=str(tmp_path / "storage" / "config.toml"),
    )


def test_ensure_runtime_capacity_does_not_emit_gpu_warnings(tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    guard = ResourceGuard(settings=settings)

    warnings = guard.ensure_runtime_capacity(
        whisper={
            "model_default": "small",
            "language": "zh",
            "device": "cpu",
            "compute_type": "int8",
            "model_load_profile": "balanced",
            "beam_size": 5,
            "vad_filter": True,
            "chunk_seconds": 180,
            "target_sample_rate": 16000,
            "target_channels": 1,
        },
        llm={
            "mode": "api",
            "load_profile": "balanced",
            "api_key": "x",
            "api_key_configured": True,
            "base_url": "https://example.com/v1",
            "model": "qwen3.5-omni-flash",
            "correction_mode": "strict",
            "correction_batch_size": 24,
            "correction_overlap": 3,
        },
    )
    assert all("GPU" not in warning for warning in warnings)
