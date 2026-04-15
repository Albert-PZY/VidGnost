from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from typing import TypeVar

T = TypeVar("T")
R = TypeVar("R")


async def gather_limited(
    items: Sequence[T],
    *,
    limit: int,
    worker: Callable[[T], Awaitable[R]],
) -> list[R]:
    normalized_items = list(items)
    if not normalized_items:
        return []

    safe_limit = max(1, int(limit or 1))
    if safe_limit == 1 or len(normalized_items) == 1:
        return [await worker(item) for item in normalized_items]

    semaphore = asyncio.Semaphore(safe_limit)
    results: dict[int, R] = {}

    async def run(index: int, item: T) -> None:
        async with semaphore:
            results[index] = await worker(item)

    await asyncio.gather(*(run(index, item) for index, item in enumerate(normalized_items)))
    return [results[index] for index in range(len(normalized_items))]
