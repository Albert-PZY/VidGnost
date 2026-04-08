from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from app.config import get_settings


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
