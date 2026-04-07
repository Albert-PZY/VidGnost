import pytest

from app.services.model_runtime_manager import ModelRuntimeManager


@pytest.mark.asyncio
async def test_component_lru_eviction() -> None:
    manager = ModelRuntimeManager(max_cached_models_by_component={"llm": 1})

    async with manager.reserve(
        task_id="t1", stage="D", component="llm", model_id="llm:a"
    ) as lease_a:
        assert lease_a.evictions == ()

    async with manager.reserve(
        task_id="t2", stage="D", component="llm", model_id="llm:b"
    ) as lease_b:
        assert len(lease_b.evictions) == 1
        assert lease_b.evictions[0].component == "llm"
        assert lease_b.evictions[0].model_id == "llm:a"
        assert lease_b.evictions[0].reason == "component_lru"


@pytest.mark.asyncio
async def test_cross_component_eviction_when_switching_runtime() -> None:
    manager = ModelRuntimeManager(
        max_cached_models_by_component={
            "asr": 2,
            "llm": 1,
        }
    )

    async with manager.reserve(
        task_id="t1", stage="C", component="asr", model_id="faster-whisper:small"
    ) as asr_lease:
        assert asr_lease.evictions == ()

    async with manager.reserve(
        task_id="t2", stage="D", component="llm", model_id="llm:qwen"
    ) as llm_lease:
        assert len(llm_lease.evictions) == 1
        assert llm_lease.evictions[0].component == "asr"
        assert llm_lease.evictions[0].model_id == "faster-whisper:small"
        assert llm_lease.evictions[0].reason == "cross_component_lru"
