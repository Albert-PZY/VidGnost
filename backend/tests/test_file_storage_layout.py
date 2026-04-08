from pathlib import Path

from app.config import get_settings
from app.services.task_store import TaskStore


def test_task_store_creates_expected_layout() -> None:
    settings = get_settings()
    store = TaskStore(settings.storage_dir)

    root = Path(settings.storage_dir) / "tasks"
    assert root.exists()
    assert (root / "records").exists()
    assert (root / "stage-metrics").exists()
    assert (root / "runtime-warnings").exists()
    assert (root / "analysis-results").exists()
    assert (root / "stage-artifacts").exists()

    assert store.list_all() == []
