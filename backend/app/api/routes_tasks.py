from __future__ import annotations

import asyncio
import io
import tarfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import quote

import aiofiles
import orjson
from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile, status
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from starlette.responses import StreamingResponse

from app.errors import AppError
from app.models import TaskRecord, TaskStatus
from app.schemas import (
    TaskArtifactsUpdateRequest,
    TaskCreateFromPathRequest,
    TaskCreateFromUrlRequest,
    TaskCreateResponse,
    TaskDetailResponse,
    TaskListResponse,
    TaskSummaryItem,
    TaskTitleUpdateRequest,
    TranscriptSegment,
)
from app.services.events import EventBus
from app.services.exporters import render_markmap_html
from app.services.ingestion import ALLOWED_VIDEO_EXTENSIONS, sanitize_filename
from app.services.naming import generate_time_key
from app.services.task_artifact_index import build_task_artifact_index, parse_task_artifact_index
from app.services.task_runner import TaskSubmission, TaskRunner
from app.services.task_store import TaskStore

router = APIRouter(prefix="/tasks", tags=["tasks"])
StageKey = Literal["A", "B", "C", "D"]
STAGE_KEYS: tuple[StageKey, StageKey, StageKey, StageKey] = ("A", "B", "C", "D")
VM_PHASE_KEYS: tuple[str, ...] = ("A", "B", "C", "transcript_optimize", "D")
D_SUBSTAGE_KEYS: tuple[str, ...] = ("transcript_optimize", "fusion_delivery")


def get_runner(request: Request) -> TaskRunner:
    return request.app.state.task_runner


def get_event_bus(request: Request) -> EventBus:
    return request.app.state.event_bus


def get_task_store(request: Request) -> TaskStore:
    return request.app.state.task_store


def _validate_video_extension(suffix: str) -> None:
    if suffix not in ALLOWED_VIDEO_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_VIDEO_EXTENSIONS))
        raise AppError.bad_request(
            f"Unsupported extension {suffix}. Allowed: {allowed}",
            code="UNSUPPORTED_VIDEO_EXTENSION",
        )


def _require_task(task_store: TaskStore, task_id: str) -> TaskRecord:
    record = task_store.get(task_id)
    if record is None:
        raise AppError.not_found("Task not found", code="TASK_NOT_FOUND")
    return record


def _next_task_id(task_store: TaskStore) -> str:
    return generate_time_key("task", exists=lambda candidate: task_store.get(candidate) is not None)


@router.post("/url", response_model=TaskCreateResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_task_from_url(
    payload: TaskCreateFromUrlRequest,
    task_store: TaskStore = Depends(get_task_store),
    runner: TaskRunner = Depends(get_runner),
) -> TaskCreateResponse:
    task_id = _next_task_id(task_store)
    now = datetime.now(timezone.utc)
    record = TaskRecord(
        id=task_id,
        source_type="bilibili",
        source_input=str(payload.url),
        status=TaskStatus.QUEUED.value,
        progress=0,
        model_size=payload.model_size,
        language=payload.language,
        stage_logs_json=orjson.dumps(_empty_stage_logs()).decode("utf-8"),
        stage_metrics_json=orjson.dumps(_empty_stage_metrics()).decode("utf-8"),
        created_at=now,
        updated_at=now,
    )
    task_store.create(record)

    await runner.submit(
        TaskSubmission(
            task_id=task_id,
            source_type="bilibili",
            source_input=str(payload.url),
            source_local_path=None,
            model_size=payload.model_size,
            language=payload.language,
        )
    )
    return TaskCreateResponse(task_id=task_id, status=TaskStatus.QUEUED.value)


@router.post("/path", response_model=TaskCreateResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_task_from_path(
    payload: TaskCreateFromPathRequest,
    task_store: TaskStore = Depends(get_task_store),
    runner: TaskRunner = Depends(get_runner),
) -> TaskCreateResponse:
    local_path = Path(payload.local_path).expanduser()
    if not local_path.exists() or not local_path.is_file():
        raise AppError.bad_request(f"Local path not found: {local_path}", code="LOCAL_PATH_NOT_FOUND")
    _validate_video_extension(local_path.suffix.lower())

    task_id = _next_task_id(task_store)
    now = datetime.now(timezone.utc)
    record = TaskRecord(
        id=task_id,
        source_type="local_file",
        source_input=str(local_path),
        source_local_path=str(local_path),
        status=TaskStatus.QUEUED.value,
        progress=0,
        model_size=payload.model_size,
        language=payload.language,
        stage_logs_json=orjson.dumps(_empty_stage_logs()).decode("utf-8"),
        stage_metrics_json=orjson.dumps(_empty_stage_metrics()).decode("utf-8"),
        created_at=now,
        updated_at=now,
    )
    task_store.create(record)

    await runner.submit(
        TaskSubmission(
            task_id=task_id,
            source_type="local_path",
            source_input=str(local_path),
            source_local_path=str(local_path),
            model_size=payload.model_size,
            language=payload.language,
        )
    )
    return TaskCreateResponse(task_id=task_id, status=TaskStatus.QUEUED.value)


@router.post("/upload", response_model=TaskCreateResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_task_from_file(
    request: Request,
    file: UploadFile = File(...),
    model_size: str = Form(default="small"),
    language: str = Form(default="zh"),
    task_store: TaskStore = Depends(get_task_store),
    runner: TaskRunner = Depends(get_runner),
) -> TaskCreateResponse:
    _ = model_size
    normalized_model_size = "small"
    settings = request.app.state.settings
    suffix = Path(file.filename or "").suffix.lower()
    _validate_video_extension(suffix)

    task_id = _next_task_id(task_store)
    target_path = Path(settings.upload_dir) / f"{task_id}_{sanitize_filename(file.filename or 'upload')}"

    max_bytes = settings.max_upload_mb * 1024 * 1024
    size = 0
    async with aiofiles.open(target_path, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                await out.close()
                target_path.unlink(missing_ok=True)
                raise AppError(
                    status_code=413,
                    message=f"File too large, max {settings.max_upload_mb}MB",
                    code="UPLOAD_FILE_TOO_LARGE",
                )
            await out.write(chunk)
    await file.close()

    now = datetime.now(timezone.utc)
    record = TaskRecord(
        id=task_id,
        source_type="local_file",
        source_input=file.filename or "uploaded-video",
        source_local_path=str(target_path),
        status=TaskStatus.QUEUED.value,
        progress=0,
        model_size=normalized_model_size,
        language=language,
        stage_logs_json=orjson.dumps(_empty_stage_logs()).decode("utf-8"),
        stage_metrics_json=orjson.dumps(_empty_stage_metrics()).decode("utf-8"),
        created_at=now,
        updated_at=now,
    )
    task_store.create(record)

    await runner.submit(
        TaskSubmission(
            task_id=task_id,
            source_type="local_file",
            source_input=record.source_input,
            source_local_path=str(target_path),
            model_size=normalized_model_size,
            language=language,
        )
    )
    return TaskCreateResponse(task_id=task_id, status=TaskStatus.QUEUED.value)


@router.get("", response_model=TaskListResponse)
def list_tasks(
    q: str | None = Query(default=None, description="title/source search"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    task_store: TaskStore = Depends(get_task_store),
) -> TaskListResponse:
    listing = task_store.list(q=q, limit=limit, offset=offset)
    rows = listing.items
    total = listing.total
    return TaskListResponse(items=[_to_summary_item(row) for row in rows], total=total)


@router.get("/{task_id}", response_model=TaskDetailResponse)
def get_task(task_id: str, task_store: TaskStore = Depends(get_task_store)) -> TaskDetailResponse:
    record = _require_task(task_store, task_id)
    return _to_detail(record)


@router.patch("/{task_id}/title", response_model=TaskSummaryItem)
def update_task_title(
    task_id: str,
    payload: TaskTitleUpdateRequest,
    task_store: TaskStore = Depends(get_task_store),
) -> TaskSummaryItem:
    record = _require_task(task_store, task_id)
    next_title = payload.title.strip()
    if not next_title:
        raise AppError.bad_request("title cannot be empty", code="EMPTY_TASK_TITLE")
    record = task_store.update(task_id, title=next_title)
    return _to_summary_item(record)


@router.patch("/{task_id}/artifacts", response_model=TaskDetailResponse)
def update_task_artifacts(
    task_id: str,
    payload: TaskArtifactsUpdateRequest,
    task_store: TaskStore = Depends(get_task_store),
) -> TaskDetailResponse:
    record = _require_task(task_store, task_id)
    if record.status not in {TaskStatus.COMPLETED.value, TaskStatus.FAILED.value, TaskStatus.CANCELLED.value}:
        raise AppError.conflict(
            "Task artifacts can only be edited after task finished",
            code="TASK_ARTIFACT_EDIT_FORBIDDEN",
        )

    if payload.summary_markdown is None and payload.notes_markdown is None and payload.mindmap_markdown is None:
        return _to_detail(record)

    if payload.summary_markdown is not None:
        record.summary_markdown = payload.summary_markdown
    if payload.notes_markdown is not None:
        record.notes_markdown = payload.notes_markdown
    if payload.mindmap_markdown is not None:
        record.mindmap_markdown = payload.mindmap_markdown
    artifact_index_json, artifact_total_bytes = build_task_artifact_index(
        task_id=record.id,
        transcript_text=record.transcript_text,
        transcript_segments_json=record.transcript_segments_json,
        summary_markdown=record.summary_markdown,
        notes_markdown=record.notes_markdown,
        mindmap_markdown=record.mindmap_markdown,
    )
    record.artifact_index_json = artifact_index_json
    record.artifact_total_bytes = artifact_total_bytes
    record.updated_at = datetime.now(timezone.utc)
    task_store.replace(record)
    return _to_detail(record)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: str,
    task_store: TaskStore = Depends(get_task_store),
) -> Response:
    record = _require_task(task_store, task_id)
    if record.status not in {TaskStatus.COMPLETED.value, TaskStatus.FAILED.value, TaskStatus.CANCELLED.value}:
        raise AppError.conflict("Running task cannot be deleted", code="TASK_DELETE_FORBIDDEN")
    task_store.delete(task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{task_id}/cancel", response_model=TaskCreateResponse, status_code=status.HTTP_202_ACCEPTED)
async def cancel_task(
    task_id: str,
    task_store: TaskStore = Depends(get_task_store),
    runner: TaskRunner = Depends(get_runner),
) -> TaskCreateResponse:
    record = _require_task(task_store, task_id)
    if record.status in {TaskStatus.COMPLETED.value, TaskStatus.FAILED.value, TaskStatus.CANCELLED.value}:
        raise AppError.conflict("Task is already finished", code="TASK_ALREADY_FINISHED")

    cancelled = await runner.cancel(task_id)
    if not cancelled:
        raise AppError.conflict("Task is already finished", code="TASK_ALREADY_FINISHED")
    return TaskCreateResponse(task_id=task_id, status=TaskStatus.CANCELLED.value)


@router.post("/{task_id}/rerun-stage-d", response_model=TaskCreateResponse, status_code=status.HTTP_202_ACCEPTED)
async def rerun_task_stage_d(
    task_id: str,
    task_store: TaskStore = Depends(get_task_store),
    runner: TaskRunner = Depends(get_runner),
) -> TaskCreateResponse:
    record = _require_task(task_store, task_id)
    if record.status not in {TaskStatus.COMPLETED.value, TaskStatus.FAILED.value, TaskStatus.CANCELLED.value}:
        raise AppError.conflict("Only terminal tasks can rerun stage D", code="TASK_NOT_TERMINAL")
    if not (record.transcript_text or "").strip() and not (record.transcript_segments_json or "").strip():
        raise AppError.bad_request("Task has no persisted transcript artifacts", code="TASK_TRANSCRIPT_MISSING")
    try:
        started = await runner.rerun_stage_d(task_id)
    except ValueError as exc:
        raise AppError.bad_request(str(exc), code="TASK_RERUN_INVALID") from exc
    if not started:
        raise AppError.conflict("Task is already running", code="TASK_ALREADY_RUNNING")
    return TaskCreateResponse(task_id=task_id, status=TaskStatus.SUMMARIZING.value)


@router.get("/{task_id}/events")
async def stream_task_events(
    task_id: str,
    request: Request,
    event_bus: EventBus = Depends(get_event_bus),
) -> StreamingResponse:
    subscription = await event_bus.subscribe(task_id)

    async def event_generator():
        try:
            for item in subscription.history:
                yield f"data: {orjson.dumps(item).decode('utf-8')}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(subscription.queue.get(), timeout=10)
                    yield f"data: {orjson.dumps(event).decode('utf-8')}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            await event_bus.unsubscribe(task_id, subscription.queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{task_id}/export/{kind}")
def export_task(
    task_id: str,
    kind: str,
    archive: Literal["zip", "tar"] = Query(default="zip", description="bundle archive format"),
    task_store: TaskStore = Depends(get_task_store),
):
    record = _require_task(task_store, task_id)
    if record.status != TaskStatus.COMPLETED.value:
        raise AppError.conflict("Task is not completed", code="TASK_NOT_COMPLETED")

    title = sanitize_filename(record.title or task_id)
    if kind == "transcript":
        _require_export_text(record.transcript_text, label="transcript", code="EXPORT_TRANSCRIPT_EMPTY")
        return PlainTextResponse(
            record.transcript_text or "",
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": _build_content_disposition(f"{title}-transcript.txt")},
        )
    if kind == "notes":
        _require_export_text(record.notes_markdown, label="notes", code="EXPORT_NOTES_EMPTY")
        return PlainTextResponse(
            record.notes_markdown or "",
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": _build_content_disposition(f"{title}-notes.md")},
        )
    if kind == "mindmap":
        _require_export_text(record.mindmap_markdown, label="mindmap", code="EXPORT_MINDMAP_EMPTY")
        html = render_markmap_html(record.mindmap_markdown or "# Empty", title=record.title or task_id)
        return HTMLResponse(
            html,
            media_type="text/html; charset=utf-8",
            headers={"Content-Disposition": _build_content_disposition(f"{title}-mindmap.html")},
        )
    if kind == "srt":
        segments = _parse_transcript_segments(record.transcript_segments_json)
        _require_export_segments(segments, code="EXPORT_SUBTITLE_EMPTY")
        srt_text = _build_srt(segments)
        return PlainTextResponse(
            srt_text,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": _build_content_disposition(f"{title}-subtitles.srt")},
        )
    if kind == "vtt":
        segments = _parse_transcript_segments(record.transcript_segments_json)
        _require_export_segments(segments, code="EXPORT_SUBTITLE_EMPTY")
        vtt_text = _build_vtt(segments)
        return PlainTextResponse(
            vtt_text,
            media_type="text/vtt; charset=utf-8",
            headers={"Content-Disposition": _build_content_disposition(f"{title}-subtitles.vtt")},
        )
    if kind == "bundle":
        _validate_bundle_export_ready(record)
        payload = _build_artifact_bundle(record=record, title=title, archive=archive)
        ext = "zip" if archive == "zip" else "tar"
        media_type = "application/zip" if archive == "zip" else "application/x-tar"
        return Response(
            content=payload,
            media_type=media_type,
            headers={"Content-Disposition": _build_content_disposition(f"{title}-artifacts.{ext}")},
        )
    raise AppError.bad_request(
        "kind must be one of: transcript|notes|mindmap|srt|vtt|bundle",
        code="INVALID_EXPORT_KIND",
    )


def _require_export_text(value: str | None, *, label: str, code: str) -> None:
    if str(value or "").strip():
        return
    raise AppError.conflict(
        f"Cannot export {label}: artifact is empty",
        code=code,
    )


def _require_export_segments(segments: list[TranscriptSegment], *, code: str) -> None:
    normalized = _normalize_subtitle_segments(segments)
    if normalized:
        return
    raise AppError.conflict(
        "Cannot export subtitles: transcript segments are empty",
        code=code,
    )


def _validate_bundle_export_ready(record: TaskRecord) -> None:
    _require_export_text(record.transcript_text, label="transcript", code="EXPORT_TRANSCRIPT_EMPTY")
    _require_export_text(record.notes_markdown, label="notes", code="EXPORT_NOTES_EMPTY")
    _require_export_text(record.mindmap_markdown, label="mindmap", code="EXPORT_MINDMAP_EMPTY")
    _require_export_segments(_parse_transcript_segments(record.transcript_segments_json), code="EXPORT_SUBTITLE_EMPTY")


def _build_artifact_bundle(record: TaskRecord, title: str, archive: Literal["zip", "tar"]) -> bytes:
    files = _build_artifact_files(record=record, title=title)
    if archive == "zip":
        return _pack_zip(files)
    return _pack_tar(files)


def _build_artifact_files(record: TaskRecord, title: str) -> dict[str, bytes]:
    mindmap_html = render_markmap_html(record.mindmap_markdown or "# Empty", title=record.title or record.id)
    segments = _parse_transcript_segments(record.transcript_segments_json)
    srt_text = _build_srt(segments)
    vtt_text = _build_vtt(segments)
    return {
        f"{title}-transcript.txt": (record.transcript_text or "").encode("utf-8"),
        f"{title}-notes.md": (record.notes_markdown or "").encode("utf-8"),
        f"{title}-mindmap.md": (record.mindmap_markdown or "").encode("utf-8"),
        f"{title}-mindmap.html": mindmap_html.encode("utf-8"),
        f"{title}-subtitles.srt": srt_text.encode("utf-8"),
        f"{title}-subtitles.vtt": vtt_text.encode("utf-8"),
    }


def _build_content_disposition(filename: str) -> str:
    ascii_fallback = "".join(ch if 32 <= ord(ch) <= 126 and ch not in {'"', "\\", ";"} else "_" for ch in filename)
    ascii_fallback = ascii_fallback or "download.bin"
    encoded_filename = quote(filename, safe="")
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded_filename}"


def _pack_zip(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(files.items()):
            archive.writestr(name, content)
    return buffer.getvalue()


def _pack_tar(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    timestamp = int(datetime.now(timezone.utc).timestamp())
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for name, content in sorted(files.items()):
            info = tarfile.TarInfo(name=name)
            info.size = len(content)
            info.mtime = timestamp
            archive.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


def _to_summary_item(record: TaskRecord) -> TaskSummaryItem:
    return TaskSummaryItem(
        id=record.id,
        title=record.title,
        source_type=record.source_type,  # type: ignore[arg-type]
        source_input=record.source_input,
        status=record.status,
        progress=record.progress,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _to_detail(record: TaskRecord) -> TaskDetailResponse:
    segments = _parse_transcript_segments(record.transcript_segments_json)
    stage_logs = _parse_stage_logs(record.stage_logs_json)
    stage_metrics = _parse_stage_metrics(record.stage_metrics_json)
    vm_phase_metrics = _build_vm_phase_metrics(stage_metrics)
    artifact_index = parse_task_artifact_index(record.artifact_index_json)

    return TaskDetailResponse(
        id=record.id,
        title=record.title,
        source_type=record.source_type,  # type: ignore[arg-type]
        source_input=record.source_input,
        language=record.language,
        model_size=record.model_size,
        status=record.status,
        progress=record.progress,
        error_message=record.error_message,
        duration_seconds=record.duration_seconds,
        transcript_text=record.transcript_text,
        transcript_segments=segments,
        summary_markdown=record.summary_markdown,
        mindmap_markdown=record.mindmap_markdown,
        notes_markdown=record.notes_markdown,
        fusion_prompt_markdown=record.fusion_prompt_markdown,
        stage_logs=stage_logs,
        stage_metrics=stage_metrics,
        vm_phase_metrics=vm_phase_metrics,
        artifact_total_bytes=max(0, int(record.artifact_total_bytes or 0)),
        artifact_index=artifact_index,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _empty_stage_logs() -> dict[str, list[str]]:
    return {stage: [] for stage in STAGE_KEYS}


def _empty_stage_metrics() -> dict[str, dict[str, object]]:
    metrics = {
        stage: {
            "started_at": None,
            "completed_at": None,
            "elapsed_seconds": None,
            "status": "pending",
            "reason": None,
            "log_count": 0,
        }
        for stage in STAGE_KEYS
    }
    metrics["D"]["substage_metrics"] = {
        substage: {
            "status": "pending",
            "started_at": None,
            "completed_at": None,
            "elapsed_seconds": None,
            "optional": substage in {"transcript_optimize"},
            "reason": None,
        }
        for substage in D_SUBSTAGE_KEYS
    }
    return metrics


def _parse_transcript_segments(raw: str | None) -> list[TranscriptSegment]:
    if not raw:
        return []
    try:
        payload = orjson.loads(raw)
        if not isinstance(payload, list):
            return []
        return [TranscriptSegment.model_validate(item) for item in payload]
    except (orjson.JSONDecodeError, ValueError, TypeError):
        return []


def _normalize_subtitle_segments(
    segments: list[TranscriptSegment],
    *,
    min_duration_seconds: float = 0.3,
) -> list[TranscriptSegment]:
    normalized: list[TranscriptSegment] = []
    previous_end = 0.0
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        start = max(0.0, float(segment.start))
        end = max(0.0, float(segment.end))
        if start < previous_end:
            start = previous_end
        if end <= start:
            end = start + min_duration_seconds
        previous_end = end
        normalized.append(
            TranscriptSegment(
                start=round(start, 3),
                end=round(end, 3),
                text=text,
            )
        )
    return normalized


def _format_subtitle_timestamp(seconds: float, millisecond_separator: str) -> str:
    total_milliseconds = max(0, int(round(seconds * 1000)))
    hours = total_milliseconds // 3_600_000
    minutes = (total_milliseconds % 3_600_000) // 60_000
    secs = (total_milliseconds % 60_000) // 1_000
    milliseconds = total_milliseconds % 1_000
    return f"{hours:02}:{minutes:02}:{secs:02}{millisecond_separator}{milliseconds:03}"


def _build_srt(segments: list[TranscriptSegment]) -> str:
    lines: list[str] = []
    normalized = _normalize_subtitle_segments(segments)
    for index, segment in enumerate(normalized, start=1):
        start = _format_subtitle_timestamp(segment.start, ",")
        end = _format_subtitle_timestamp(segment.end, ",")
        lines.append(str(index))
        lines.append(f"{start} --> {end}")
        lines.append(segment.text)
        lines.append("")
    return "\n".join(lines).rstrip()


def _build_vtt(segments: list[TranscriptSegment]) -> str:
    normalized = _normalize_subtitle_segments(segments)
    lines = ["WEBVTT", ""]
    for segment in normalized:
        start = _format_subtitle_timestamp(segment.start, ".")
        end = _format_subtitle_timestamp(segment.end, ".")
        lines.append(f"{start} --> {end}")
        lines.append(segment.text)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _parse_stage_logs(raw: str | None) -> dict[str, list[str]]:
    if not raw:
        return _empty_stage_logs()
    try:
        payload = orjson.loads(raw)
        if not isinstance(payload, dict):
            return _empty_stage_logs()
        normalized = _empty_stage_logs()
        for stage in STAGE_KEYS:
            value = payload.get(stage, [])
            if isinstance(value, list):
                normalized[stage] = [str(item) for item in value]
        return normalized
    except orjson.JSONDecodeError:
        return _empty_stage_logs()


def _parse_stage_metrics(raw: str | None) -> dict[str, dict[str, object]]:
    if not raw:
        return _empty_stage_metrics()
    try:
        payload = orjson.loads(raw)
        if not isinstance(payload, dict):
            return _empty_stage_metrics()
        normalized = _empty_stage_metrics()
        for stage in STAGE_KEYS:
            item = payload.get(stage)
            if not isinstance(item, dict):
                continue
            merged = dict(normalized[stage])
            merged.update(item)
            normalized[stage] = merged
        return normalized
    except orjson.JSONDecodeError:
        return _empty_stage_metrics()


def _build_vm_phase_metrics(stage_metrics: dict[str, dict[str, object]]) -> dict[str, dict[str, object]]:
    def to_status(metric: dict[str, object]) -> str:
        explicit_status = str(metric.get("status", "") or "").strip().lower()
        if explicit_status == "cancelled":
            return "failed"
        if explicit_status in {"pending", "running", "completed", "failed", "skipped"}:
            return explicit_status
        completed_at = str(metric.get("completed_at", "") or "").strip()
        started_at = str(metric.get("started_at", "") or "").strip()
        if completed_at:
            return "completed"
        if started_at:
            return "running"
        return "pending"

    result: dict[str, dict[str, object]] = {}
    for stage in ("A", "B", "C"):
        metric = stage_metrics.get(stage, {})
        if not isinstance(metric, dict):
            metric = {}
        result[stage] = {
            "status": to_status(metric),
            "started_at": metric.get("started_at"),
            "completed_at": metric.get("completed_at"),
            "elapsed_seconds": metric.get("elapsed_seconds"),
            "optional": False,
            "reason": metric.get("reason"),
        }

    d_metric = stage_metrics.get("D", {})
    if not isinstance(d_metric, dict):
        d_metric = {}
    substage_metrics = d_metric.get("substage_metrics", {})
    if not isinstance(substage_metrics, dict):
        substage_metrics = {}

    for substage in ("transcript_optimize",):
        raw = substage_metrics.get(substage, {})
        metric = raw if isinstance(raw, dict) else {}
        status = str(metric.get("status", "pending")).strip().lower() or "pending"
        if status == "cancelled":
            status = "failed"
        result[substage] = {
            "status": status,
            "started_at": metric.get("started_at"),
            "completed_at": metric.get("completed_at"),
            "elapsed_seconds": metric.get("elapsed_seconds"),
            "optional": bool(metric.get("optional", substage in {"transcript_optimize"})),
            "reason": metric.get("reason"),
        }

    final_metric = substage_metrics.get("fusion_delivery", {})
    final_dict = final_metric if isinstance(final_metric, dict) else {}
    final_status = str(final_dict.get("status", "")).strip().lower()
    if final_status == "cancelled":
        final_status = "failed"
    if not final_status:
        final_started_at = str(final_dict.get("started_at", "") or "").strip()
        final_completed_at = str(final_dict.get("completed_at", "") or "").strip()
        if final_completed_at:
            final_status = "completed"
        elif final_started_at:
            final_status = "running"
        else:
            # Before fusion starts, keep H pending instead of inheriting full stage-D running state.
            d_status = to_status(d_metric)
            if d_status in {"completed", "failed", "skipped"}:
                final_status = d_status
            else:
                final_status = "pending"
    result["D"] = {
        "status": final_status or "pending",
        "started_at": final_dict.get("started_at", d_metric.get("started_at")),
        "completed_at": final_dict.get("completed_at", d_metric.get("completed_at")),
        "elapsed_seconds": final_dict.get("elapsed_seconds", d_metric.get("elapsed_seconds")),
        "optional": False,
        "reason": final_dict.get("reason"),
    }
    return result
