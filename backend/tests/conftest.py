from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from app.config import get_settings


@pytest.fixture(scope="session", autouse=True)
def restore_runtime_config_files() -> None:
    settings = get_settings()
    llm_config_path = Path(settings.llm_config_path)
    runtime_config_path = Path(settings.runtime_config_path)
    llm_config_backup = llm_config_path.read_bytes() if llm_config_path.exists() else None
    runtime_config_backup = runtime_config_path.read_bytes() if runtime_config_path.exists() else None

    yield

    llm_config_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_config_path.parent.mkdir(parents=True, exist_ok=True)
    if llm_config_backup is None:
        llm_config_path.unlink(missing_ok=True)
    else:
        llm_config_path.write_bytes(llm_config_backup)
    if runtime_config_backup is None:
        runtime_config_path.unlink(missing_ok=True)
    else:
        runtime_config_path.write_bytes(runtime_config_backup)


@pytest.fixture(autouse=True)
def reset_file_persistence() -> None:
    settings = get_settings()
    tasks_dir = Path(settings.storage_dir) / "tasks"
    prompts_dir = Path(settings.storage_dir) / "prompts"

    if tasks_dir.exists():
        shutil.rmtree(tasks_dir)
    if prompts_dir.exists():
        shutil.rmtree(prompts_dir)

    yield

    if tasks_dir.exists():
        shutil.rmtree(tasks_dir)
    if prompts_dir.exists():
        shutil.rmtree(prompts_dir)
