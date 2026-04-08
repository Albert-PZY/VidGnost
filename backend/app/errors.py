from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class AppError(Exception):
    """Structured application error for predictable API responses."""

    status_code: int
    message: str
    code: str = "APP_ERROR"
    detail: Any = None

    def __str__(self) -> str:
        return self.message

    @classmethod
    def bad_request(
        cls,
        message: str,
        *,
        code: str = "BAD_REQUEST",
        detail: Any = None,
    ) -> "AppError":
        return cls(status_code=400, message=message, code=code, detail=detail)

    @classmethod
    def not_found(
        cls,
        message: str,
        *,
        code: str = "NOT_FOUND",
        detail: Any = None,
    ) -> "AppError":
        return cls(status_code=404, message=message, code=code, detail=detail)

    @classmethod
    def conflict(
        cls,
        message: str,
        *,
        code: str = "CONFLICT",
        detail: Any = None,
    ) -> "AppError":
        return cls(status_code=409, message=message, code=code, detail=detail)

