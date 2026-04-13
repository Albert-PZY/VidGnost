import asyncio

import pytest

from app.services.model_runtime_manager import ModelRuntimeManager


@pytest.mark.asyncio
async def test_runtime_manager_reports_active_snapshot_for_current_lease() -> None:
    manager = ModelRuntimeManager(max_cached_models_by_component={"asr": 1})

    async with manager.reserve(task_id="t1", stage="C", component="asr", model_id="faster-whisper:small") as lease:
        assert lease.wait_seconds >= 0
        snapshot = await manager.active_snapshot()
        assert snapshot is not None
        assert snapshot["task_id"] == "t1"
        assert snapshot["stage"] == "C"
        assert snapshot["component"] == "asr"
        assert snapshot["model_id"] == "faster-whisper:small"
        assert snapshot["lease_strategy"] == "exclusive_process"

    assert await manager.active_snapshot() is None


@pytest.mark.asyncio
async def test_runtime_manager_serializes_heavy_gpu_leases() -> None:
    manager = ModelRuntimeManager(max_cached_models_by_component={"asr": 1, "llm": 1})
    first_acquired = asyncio.Event()
    release_first = asyncio.Event()
    second_wait: dict[str, float] = {}

    async def hold_first() -> None:
        async with manager.reserve(task_id="t1", stage="C", component="asr", model_id="faster-whisper:small"):
            first_acquired.set()
            await release_first.wait()

    async def acquire_second() -> None:
        async with manager.reserve(task_id="t2", stage="D", component="llm", model_id="llm:qwen") as lease:
            second_wait["seconds"] = lease.wait_seconds

    first_task = asyncio.create_task(hold_first())
    await first_acquired.wait()

    second_task = asyncio.create_task(acquire_second())
    await asyncio.sleep(0.05)
    assert not second_task.done()

    release_first.set()
    await asyncio.gather(first_task, second_task)

    assert second_wait["seconds"] >= 0.04
