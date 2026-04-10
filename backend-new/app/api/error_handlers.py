from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.errors import AppError

logger = logging.getLogger(__name__)


def _error_payload(
    *,
    code: str,
    message: str,
    hint: str | None = None,
    retryable: bool = False,
    detail: Any = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "hint": hint or "",
        "retryable": bool(retryable),
        "detail": detail,
    }


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(
                code=exc.code,
                message=exc.message,
                hint=exc.hint,
                retryable=exc.retryable,
                detail=exc.detail,
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict):
            code = str(detail.get("code") or f"HTTP_{exc.status_code}")
            message = str(detail.get("message") or "Request failed")
            payload_detail = detail.get("detail")
        else:
            code = f"HTTP_{exc.status_code}"
            message = str(detail) if detail else "Request failed"
            payload_detail = None
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(code=code, message=message, retryable=False, detail=payload_detail),
        )

    @app.exception_handler(RequestValidationError)
    async def _handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_error_payload(
                code="VALIDATION_ERROR",
                message="Request validation failed",
                hint="请检查请求字段与类型是否正确。",
                retryable=False,
                detail=exc.errors(),
            ),
        )

    @app.exception_handler(Exception)
    async def _handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        trace_id = uuid.uuid4().hex
        logger.exception(
            "Unhandled exception trace_id=%s method=%s path=%s",
            trace_id,
            request.method,
            request.url.path,
            exc_info=exc,
        )
        return JSONResponse(
            status_code=500,
            content=_error_payload(
                code="INTERNAL_SERVER_ERROR",
                message="Internal server error",
                hint="请稍后重试，如持续失败请检查服务日志并反馈 trace_id。",
                retryable=True,
                detail={"trace_id": trace_id},
            ),
        )
