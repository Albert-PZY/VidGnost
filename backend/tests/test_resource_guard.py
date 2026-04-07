import subprocess
from pathlib import Path

from app.config import Settings
from app.services.resource_guard import ResourceGuard, _parse_first_gpu_memory_row


def _build_settings(tmp_path: Path) -> Settings:
    return Settings(
        storage_dir=str(tmp_path / "storage"),
        temp_dir=str(tmp_path / "storage" / "tmp"),
        upload_dir=str(tmp_path / "storage" / "uploads"),
        output_dir=str(tmp_path / "storage" / "outputs"),
        llm_config_path=str(tmp_path / "storage" / "model_config.json"),
        runtime_config_path=str(tmp_path / "storage" / "config.toml"),
    )


def test_parse_first_gpu_memory_row() -> None:
    free_mb, total_mb = _parse_first_gpu_memory_row("4096, 8192\n")
    assert free_mb == 4096
    assert total_mb == 8192


def test_gpu_runtime_failure_when_nvidia_smi_missing(monkeypatch, tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    guard = ResourceGuard(settings=settings)
    monkeypatch.setattr("app.services.resource_guard.shutil.which", lambda _name: None)
    failure = guard.gpu_runtime_failure_reason()
    assert failure is not None
    assert "nvidia-smi" in failure


def test_gpu_runtime_failure_when_free_memory_too_low(monkeypatch, tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    guard = ResourceGuard(settings=settings)
    monkeypatch.setattr("app.services.resource_guard.shutil.which", lambda _name: "nvidia-smi")
    monkeypatch.setattr(
        "app.services.resource_guard.subprocess.run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=["nvidia-smi"],
            returncode=0,
            stdout="1024, 8192\n",
            stderr="",
        ),
    )
    failure = guard.gpu_runtime_failure_reason()
    assert failure is not None
    assert "可用显存不足" in failure


def test_gpu_runtime_ready_when_free_memory_sufficient(monkeypatch, tmp_path: Path) -> None:
    settings = _build_settings(tmp_path)
    guard = ResourceGuard(settings=settings)
    monkeypatch.setattr("app.services.resource_guard.shutil.which", lambda _name: "nvidia-smi")
    monkeypatch.setattr(
        "app.services.resource_guard.subprocess.run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=["nvidia-smi"],
            returncode=0,
            stdout="4096, 8192\n",
            stderr="",
        ),
    )
    assert guard.gpu_runtime_failure_reason() is None
