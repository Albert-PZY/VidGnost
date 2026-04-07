from __future__ import annotations

from datetime import datetime
from re import sub
from typing import Callable

_TIME_KEY_FORMAT = "%Y%m%d-%H%M%S"


def sanitize_key_prefix(raw: str) -> str:
    normalized = sub(r"[^a-zA-Z0-9_-]+", "-", str(raw).strip()).strip("-").lower()
    return normalized


def generate_time_key(
    prefix: str = "",
    *,
    exists: Callable[[str], bool] | None = None,
    now: datetime | None = None,
) -> str:
    dt = now or datetime.now()
    timestamp = dt.strftime(_TIME_KEY_FORMAT)
    normalized_prefix = sanitize_key_prefix(prefix)
    base = f"{normalized_prefix}-{timestamp}" if normalized_prefix else timestamp
    if exists is None:
        return base
    if not exists(base):
        return base
    for suffix in range(1, 1000):
        candidate = f"{base}-{suffix:02d}"
        if not exists(candidate):
            return candidate
    raise RuntimeError(f"Unable to allocate unique time key for prefix={normalized_prefix!r}")
