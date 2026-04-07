from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings
from app.schemas import HealthResponse

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(status="ok", app=settings.app_name, version="0.1.0")
