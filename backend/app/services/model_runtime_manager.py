from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, Mapping


@dataclass(slots=True)
class RuntimeLease:
    task_id: str
    stage: str
    component: str
    model_id: str
    wait_seconds: float
    acquired_at: float


class ModelRuntimeManager:
    """Ensure only one heavy model workload owns the GPU execution lease at a time."""

    def __init__(
        self,
        *,
        max_cached_models_by_component: Mapping[str, int] | None = None,
    ) -> None:
        _ = max_cached_models_by_component
        self._gpu_lock = asyncio.Lock()
        self._state_lock = asyncio.Lock()
        self._active: RuntimeLease | None = None

    @asynccontextmanager
    async def reserve(
        self,
        *,
        task_id: str,
        stage: str,
        component: str,
        model_id: str,
    ) -> AsyncIterator[RuntimeLease]:
        loop = asyncio.get_running_loop()
        wait_started_at = loop.time()
        await self._gpu_lock.acquire()
        acquired_at = loop.time()
        async with self._state_lock:
            lease = RuntimeLease(
                task_id=task_id,
                stage=stage,
                component=component,
                model_id=model_id,
                wait_seconds=max(0.0, acquired_at - wait_started_at),
                acquired_at=acquired_at,
            )
            self._active = lease
        try:
            yield lease
        finally:
            async with self._state_lock:
                self._active = None
            self._gpu_lock.release()

    async def active_snapshot(self) -> dict[str, object] | None:
        async with self._state_lock:
            if self._active is None:
                return None
            return {
                "task_id": self._active.task_id,
                "stage": self._active.stage,
                "component": self._active.component,
                "model_id": self._active.model_id,
                "wait_seconds": round(self._active.wait_seconds, 3),
                "lease_strategy": "exclusive_process",
            }
