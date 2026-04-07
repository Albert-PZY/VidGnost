from __future__ import annotations

import asyncio
import random
import threading
import time
from dataclasses import dataclass
from typing import Callable, TypeVar

T = TypeVar("T")


@dataclass(slots=True)
class RetryPolicy:
    max_attempts: int = 3
    base_delay_seconds: float = 0.7
    max_delay_seconds: float = 4.0
    jitter_seconds: float = 0.35


@dataclass(slots=True)
class CircuitPolicy:
    failure_threshold: int = 3
    open_seconds: float = 18.0


class OpenAICompatRuntime:
    def __init__(
        self,
        *,
        component: str,
        retry_policy: RetryPolicy | None = None,
        circuit_policy: CircuitPolicy | None = None,
    ) -> None:
        self._component = component
        self._retry_policy = retry_policy or RetryPolicy()
        self._circuit_policy = circuit_policy or CircuitPolicy()
        self._lock = threading.Lock()
        self._states: dict[str, tuple[int, float]] = {}

    async def call_async(
        self,
        *,
        key: str,
        request_factory: Callable[[], "asyncio.Future[T] | T"],
        on_retry: Callable[[int, float, Exception], None] | None = None,
    ) -> T:
        self._ensure_circuit_closed(key)
        policy = self._retry_policy
        for attempt in range(1, max(1, policy.max_attempts) + 1):
            try:
                result = request_factory()
                if asyncio.iscoroutine(result):
                    value = await result
                else:
                    value = result  # type: ignore[assignment]
                self._record_success(key)
                return value  # type: ignore[return-value]
            except Exception as exc:  # noqa: BLE001
                retryable = _is_retryable_openai_error(exc)
                self._record_failure(key, retryable=retryable)
                if (not retryable) or attempt >= policy.max_attempts:
                    raise
                delay = _compute_retry_delay(policy, attempt)
                if on_retry is not None:
                    on_retry(attempt, delay, exc)
                await asyncio.sleep(delay)
        raise RuntimeError(f"{self._component.upper()}_RUNTIME_RETRY_EXHAUSTED")

    def call_sync(
        self,
        *,
        key: str,
        request_factory: Callable[[], T],
        on_retry: Callable[[int, float, Exception], None] | None = None,
    ) -> T:
        self._ensure_circuit_closed(key)
        policy = self._retry_policy
        for attempt in range(1, max(1, policy.max_attempts) + 1):
            try:
                value = request_factory()
                self._record_success(key)
                return value
            except Exception as exc:  # noqa: BLE001
                retryable = _is_retryable_openai_error(exc)
                self._record_failure(key, retryable=retryable)
                if (not retryable) or attempt >= policy.max_attempts:
                    raise
                delay = _compute_retry_delay(policy, attempt)
                if on_retry is not None:
                    on_retry(attempt, delay, exc)
                time.sleep(delay)
        raise RuntimeError(f"{self._component.upper()}_RUNTIME_RETRY_EXHAUSTED")

    def _ensure_circuit_closed(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            failures, open_until = self._states.get(key, (0, 0.0))
            if open_until > now:
                wait_seconds = max(0.0, open_until - now)
                raise RuntimeError(
                    f"{self._component.upper()}_API_CIRCUIT_OPEN: endpoint temporarily unavailable, retry after {wait_seconds:.1f}s"
                )
            if open_until > 0 and open_until <= now:
                self._states[key] = (0, 0.0)

    def _record_success(self, key: str) -> None:
        with self._lock:
            self._states[key] = (0, 0.0)

    def _record_failure(self, key: str, *, retryable: bool) -> None:
        with self._lock:
            failures, _ = self._states.get(key, (0, 0.0))
            failures = failures + 1
            opened_until = 0.0
            if retryable and failures >= self._circuit_policy.failure_threshold:
                opened_until = time.monotonic() + max(1.0, self._circuit_policy.open_seconds)
            self._states[key] = (failures, opened_until)


def _compute_retry_delay(policy: RetryPolicy, attempt: int) -> float:
    exp_delay = min(
        policy.max_delay_seconds, policy.base_delay_seconds * (2 ** max(0, attempt - 1))
    )
    jitter = random.uniform(0.0, policy.jitter_seconds)
    return max(0.05, exp_delay + jitter)


def _is_retryable_openai_error(exc: Exception) -> bool:
    status_code = _extract_status_code(exc)
    if status_code is not None:
        if status_code in {408, 409, 429}:
            return True
        if status_code >= 500:
            return True
        return False
    lowered = str(exc).lower()
    return any(
        token in lowered
        for token in (
            "timeout",
            "timed out",
            "temporarily unavailable",
            "connection reset",
            "connection aborted",
            "connecterror",
            "rate limit",
            "too many requests",
            "server error",
            "service unavailable",
            "bad gateway",
            "gateway timeout",
        )
    )


def _extract_status_code(exc: Exception) -> int | None:
    for attr in ("status_code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    response = getattr(exc, "response", None)
    if response is not None:
        status = getattr(response, "status_code", None)
        if isinstance(status, int):
            return status
    return None
