from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import TypedDict

from app.config import Settings
from app.services.transcription import WhisperService


class ModelDownloadSnapshot(TypedDict):
    state: str
    message: str
    current_file: str
    downloaded_bytes: int
    total_bytes: int
    percent: float
    speed_bps: float
    updated_at: str


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_snapshot(
    *,
    state: str = "idle",
    message: str = "",
    current_file: str = "",
    downloaded_bytes: int = 0,
    total_bytes: int = 0,
    percent: float = 0.0,
    speed_bps: float = 0.0,
) -> ModelDownloadSnapshot:
    return {
        "state": state,
        "message": message,
        "current_file": current_file,
        "downloaded_bytes": max(0, int(downloaded_bytes)),
        "total_bytes": max(0, int(total_bytes)),
        "percent": max(0.0, min(100.0, float(percent))),
        "speed_bps": max(0.0, float(speed_bps)),
        "updated_at": _utc_now_iso(),
    }


class ModelDownloadService:
    MANAGED_MODEL_IDS = frozenset({"whisper-default"})

    def __init__(self, settings: Settings, whisper_service: WhisperService | None = None) -> None:
        self._settings = settings
        self._whisper_service = whisper_service or WhisperService(settings)
        self._lock = asyncio.Lock()
        self._states: dict[str, ModelDownloadSnapshot] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def supports_managed_download(self, model_id: str) -> bool:
        return model_id in self.MANAGED_MODEL_IDS

    async def list_snapshots(self) -> dict[str, ModelDownloadSnapshot]:
        async with self._lock:
            return {model_id: dict(snapshot) for model_id, snapshot in self._states.items()}

    async def get_snapshot(self, model_id: str) -> ModelDownloadSnapshot:
        async with self._lock:
            snapshot = self._states.get(model_id)
            if snapshot is None:
                return _build_snapshot()
            return dict(snapshot)

    async def start_download(self, model_id: str, *, force_redownload: bool = False) -> ModelDownloadSnapshot:
        self._ensure_supported(model_id)
        async with self._lock:
            task = self._tasks.get(model_id)
            if task is not None and not task.done():
                return dict(self._states.get(model_id, _build_snapshot()))

            self._states[model_id] = _build_snapshot(
                state="downloading",
                message="准备下载默认模型目录中的 Whisper Small 模型。",
            )
            self._tasks[model_id] = asyncio.create_task(
                self._run_whisper_download(model_id=model_id, force_redownload=force_redownload)
            )
            return dict(self._states[model_id])

    async def cancel_download(self, model_id: str) -> ModelDownloadSnapshot:
        self._ensure_supported(model_id)
        async with self._lock:
            task = self._tasks.get(model_id)

        if task is None or task.done():
            return await self.get_snapshot(model_id)

        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return await self.get_snapshot(model_id)

    async def shutdown(self) -> None:
        async with self._lock:
            tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except asyncio.CancelledError:
                continue
        self._whisper_service.shutdown()

    async def _run_whisper_download(self, *, model_id: str, force_redownload: bool) -> None:
        try:
            await self._whisper_service.ensure_small_model_ready(
                on_progress=lambda payload: self._handle_progress(model_id=model_id, payload=payload),
                force_redownload=force_redownload,
            )
            await self._set_snapshot(
                model_id,
                _build_snapshot(
                    state="completed",
                    message="模型已下载到默认目录并完成就绪。",
                    percent=100.0,
                ),
            )
        except asyncio.CancelledError:
            await self._set_snapshot(
                model_id,
                _build_snapshot(
                    state="cancelled",
                    message="模型下载已取消，临时文件已清理。",
                ),
            )
            raise
        except Exception as exc:  # noqa: BLE001
            await self._set_snapshot(
                model_id,
                _build_snapshot(
                    state="failed",
                    message=f"模型下载失败：{exc}",
                ),
            )
        finally:
            async with self._lock:
                task = self._tasks.get(model_id)
                if task is asyncio.current_task():
                    self._tasks.pop(model_id, None)

    async def _handle_progress(self, *, model_id: str, payload: dict[str, object]) -> None:
        status = str(payload.get("status", "")).strip().lower()
        message = str(payload.get("message", "")).strip()
        current_file = str(payload.get("current_file", "")).strip()
        downloaded_bytes = int(payload.get("downloaded_bytes", 0) or 0)
        total_bytes = int(payload.get("total_bytes", 0) or 0)
        percent = float(payload.get("percent", 0.0) or 0.0)
        speed_bps = float(payload.get("speed_bps", 0.0) or 0.0)

        state = "downloading"
        if status in {"completed", "cached"}:
            state = "completed"
        elif status == "checking":
            state = "downloading"

        await self._set_snapshot(
            model_id,
            _build_snapshot(
                state=state,
                message=message,
                current_file=current_file,
                downloaded_bytes=downloaded_bytes,
                total_bytes=total_bytes,
                percent=percent,
                speed_bps=speed_bps,
            ),
        )

    async def _set_snapshot(self, model_id: str, snapshot: ModelDownloadSnapshot) -> None:
        async with self._lock:
            self._states[model_id] = snapshot

    def _ensure_supported(self, model_id: str) -> None:
        if not self.supports_managed_download(model_id):
            raise ValueError("Only whisper-default supports managed downloads right now.")
