from __future__ import annotations

import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, Mapping


@dataclass(slots=True, frozen=True)
class RuntimeEviction:
    component: str
    model_id: str
    reason: str = "component_lru"


@dataclass(slots=True)
class RuntimeLease:
    task_id: str
    stage: str
    component: str
    model_id: str
    wait_seconds: float
    acquired_at: float
    evictions: tuple[RuntimeEviction, ...]


class ModelRuntimeManager:
    """Ensure only one heavy model workload owns GPU runtime at a time."""

    def __init__(
        self,
        *,
        max_cached_models_by_component: Mapping[str, int] | None = None,
    ) -> None:
        self._gpu_lock = asyncio.Lock()
        self._state_lock = asyncio.Lock()
        self._active: RuntimeLease | None = None
        self._active_models: set[tuple[str, str]] = set()
        self._model_usage: dict[str, OrderedDict[str, None]] = {}
        configured_limits = dict(max_cached_models_by_component or {})
        self._component_limits: dict[str, int] = {
            str(component).strip(): max(1, int(limit))
            for component, limit in configured_limits.items()
            if str(component).strip()
        }

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
            evictions = self._plan_evictions_locked(component=component, model_id=model_id)
            self._active_models.add((component, model_id))
            lease = RuntimeLease(
                task_id=task_id,
                stage=stage,
                component=component,
                model_id=model_id,
                wait_seconds=max(0.0, acquired_at - wait_started_at),
                acquired_at=acquired_at,
                evictions=tuple(evictions),
            )
            self._active = lease
        try:
            yield lease
        finally:
            async with self._state_lock:
                self._active_models.discard((component, model_id))
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
                "eviction_count": len(self._active.evictions),
            }

    def _plan_evictions_locked(self, *, component: str, model_id: str) -> list[RuntimeEviction]:
        evictions: list[RuntimeEviction] = []
        bucket = self._model_usage.setdefault(component, OrderedDict())
        if model_id in bucket:
            bucket.move_to_end(model_id)
        else:
            bucket[model_id] = None

        component_limit = self._component_limits.get(component, 1)
        if component_limit < 1:
            component_limit = 1
        while len(bucket) > component_limit:
            candidate_model_id, _ = bucket.popitem(last=False)
            if (component, candidate_model_id) in self._active_models or candidate_model_id == model_id:
                bucket[candidate_model_id] = None
                bucket.move_to_end(candidate_model_id)
                continue
            evictions.append(
                RuntimeEviction(component=component, model_id=candidate_model_id, reason="component_lru")
            )

        other_components = [item for item in self._model_usage.keys() if item != component]
        for other_component in other_components:
            other_bucket = self._model_usage.get(other_component)
            if not other_bucket:
                continue
            for candidate_model_id in list(other_bucket.keys()):
                if (other_component, candidate_model_id) in self._active_models:
                    continue
                other_bucket.pop(candidate_model_id, None)
                evictions.append(
                    RuntimeEviction(
                        component=other_component,
                        model_id=candidate_model_id,
                        reason="cross_component_lru",
                    )
                )
            if not other_bucket:
                self._model_usage.pop(other_component, None)
        return evictions
