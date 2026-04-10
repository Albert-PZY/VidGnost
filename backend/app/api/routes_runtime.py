from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.schemas import RuntimeMetricsResponse
from app.services.runtime_metrics import RuntimeMetricsService

router = APIRouter(prefix="/runtime", tags=["runtime"])


def get_runtime_metrics_service(request: Request) -> RuntimeMetricsService:
    return request.app.state.runtime_metrics_service


@router.get("/metrics", response_model=RuntimeMetricsResponse)
def get_runtime_metrics(service: RuntimeMetricsService = Depends(get_runtime_metrics_service)) -> RuntimeMetricsResponse:
    return RuntimeMetricsResponse.model_validate(service.collect())
