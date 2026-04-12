from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Request

from app.schemas import RuntimeMetricsResponse, RuntimePathsResponse
from app.services.runtime_metrics import RuntimeMetricsService

router = APIRouter(prefix="/runtime", tags=["runtime"])


def get_runtime_metrics_service(request: Request) -> RuntimeMetricsService:
    return request.app.state.runtime_metrics_service


def get_settings(request: Request):
    return request.app.state.settings


@router.get("/metrics", response_model=RuntimeMetricsResponse)
def get_runtime_metrics(service: RuntimeMetricsService = Depends(get_runtime_metrics_service)) -> RuntimeMetricsResponse:
    return RuntimeMetricsResponse.model_validate(service.collect())


@router.get("/paths", response_model=RuntimePathsResponse)
def get_runtime_paths(request: Request) -> RuntimePathsResponse:
    settings = get_settings(request)
    storage_dir = Path(settings.storage_dir).resolve()
    event_log_dir = storage_dir / "event-logs"
    trace_log_dir = event_log_dir / "traces"
    return RuntimePathsResponse(
        storage_dir=str(storage_dir),
        event_log_dir=str(event_log_dir),
        trace_log_dir=str(trace_log_dir),
    )
