from __future__ import annotations

import asyncio
import io
import mimetypes
import shutil
import tarfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import quote

import aiofiles
import orjson
from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from starlette.responses import StreamingResponse

from app.errors import AppError
from app.models import TaskRecord, TaskStatus
from app.schemas import (
    TaskArtifactsUpdateRequest,
    TaskBatchCreateResponse,
    TaskCreateFromPathRequest,
    TaskCreateFromUrlRequest,
    TaskCreateResponse,
    TaskDetailResponse,
    TaskListResponse,
    TaskRecentItem,
    TaskRecentResponse,
    TaskStatsResponse,
    TaskStepItem,
    TaskSummaryItem,
    TaskTitleUpdateRequest,
    TranscriptSegment,
    WorkflowType,
)
from app.services.events import EventBus
from app.services.exporters import render_markmap_html
from app.services.ingestion import ALLOWED_VIDEO_EXTENSIONS, sanitize_filename
from app.services.naming import generate_time_key
from app.services.task_artifact_index import build_task_artifact_index, parse_task_artifact_index
from app.services.task_preflight import TaskPreflightService
from app.services.task_runner import TaskSubmission, TaskRunner
from app.services.task_store import TaskStore

router = APIRouter(prefix="/tasks", tags=["tasks"])
StageKey = Literal["A", "B", "C", "D"]
STAGE_KEYS: tuple[StageKey, StageKey, StageKey, StageKey] = ("A", "B", "C", "D")
D_SUBSTAGE_KEYS: tuple[str, ...] = ("transcript_optimize", "fusion_delivery")


def get_runner(request: Request) -> TaskRunner:
    return request.app.state.task_runner


def get_event_bus(request: Request) -> EventBus:
    return request.app.state.event_bus


def get_task_store(request: Request) -> TaskStore:
    return request.app.state.task_store


def get_task_preflight_service(request: Request) -> TaskPreflightService:
    return request.app.state.task_preflight_service


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
    task_preflight_service: TaskPreflightService = Depends(get_task_preflight_service),
) -> TaskCreateResponse:
    workflow: WorkflowType = payload.workflow
    await task_preflight_service.assert_ready_for_analysis(workflow=workflow)
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
        workflow=workflow,
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
            workflow=workflow,
        )
    )
    return TaskCreateResponse(
        task_id=task_id,
        status=_to_public_status(TaskStatus.QUEUED.value),
        workflow=workflow,
        initial_steps=_build_initial_steps(workflow),
    )


@router.post("/path", response_model=TaskCreateResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_task_from_path(
    payload: TaskCreateFromPathRequest,
    task_store: TaskStore = Depends(get_task_store),
    runner: TaskRunner = Depends(get_runner),
    task_preflight_service: TaskPreflightService = Depends(get_task_preflight_service),
) -> TaskCreateResponse:
    local_path = Path(payload.local_path).expanduser()
    if not local_path.exists() or not local_path.is_file():
        raise AppError.bad_request(f"Local path not found: {local_path}", code="LOCAL_PATH_NOT_FOUND")
    _validate_video_extension(local_path.suffix.lower())

    workflow: WorkflowType = payload.workflow
    await task_preflight_service.assert_ready_for_analysis(workflow=workflow)
    task_id = _next_task_id(task_store)
    now = datetime.now(timezone.utc)
    record = TaskRecord(
        id=task_id,
        source_type="local_path",
        source_input=str(local_path),
        source_local_path=str(local_path),
        status=TaskStatus.QUEUED.value,
        progress=0,
        model_size=payload.model_size,
        language=payload.language,
        workflow=workflow,
        file_size_bytes=max(0, int(local_path.stat().st_size)),
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
            workflow=workflow,
        )
    )
    return TaskCreateResponse(
        task_id=task_id,
        status=_to_public_status(TaskStatus.QUEUED.value),
        workflow=workflow,
        initial_steps=_build_initial_steps(workflow),
    )


@router.post("/upload", response_model=TaskCreateResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_task_from_file(
    request: Request,
    file: UploadFile = File(...),
    model_size: str = Form(default="small"),
    language: str = Form(default="zh"),
    workflow: WorkflowType = Form(default="notes"),
    task_store: TaskStore = Depends(get_task_store),
    runner: TaskRunner = Depends(get_runner),
    task_preflight_service: TaskPreflightService = Depends(get_task_preflight_service),
) -> TaskCreateResponse:
    _ = model_size
    await task_preflight_service.assert_ready_for_analysis(workflow=workflow)
    task = await _create_task_from_uploaded_file(
        request=request,
        file=file,
        language=language,
        workflow=workflow,
        task_store=task_store,
        runner=runner,
    )
    return task


@router.post("/upload/batch", response_model=TaskBatchCreateResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_tasks_from_files(
    request: Request,
    files: list[UploadFile] = File(...),
    model_size: str = Form(default="small"),
    language: str = Form(default="zh"),
    workflow: WorkflowType = Form(default="notes"),
    strategy: Literal["single_task_per_file", "batch_task"] = Form(default="single_task_per_file"),
    task_store: TaskStore = Depends(get_task_store),
    runner: TaskRunner = Depends(get_runner),
    task_preflight_service: TaskPreflightService = Depends(get_task_preflight_service),
) -> TaskBatchCreateResponse:
    _ = model_size
    if not files:
        raise AppError.bad_request(
            "No files uploaded",
            code="UPLOAD_FILES_EMPTY",
            hint="请至少上传一个视频文件。",
        )
    if strategy != "single_task_per_file":
        raise AppError.bad_request(
            "Unsupported strategy",
            code="UPLOAD_STRATEGY_UNSUPPORTED",
            hint="当前版本支持 single_task_per_file。",
        )

    await task_preflight_service.assert_ready_for_analysis(workflow=workflow)
    tasks: list[TaskCreateResponse] = []
    for file in files:
        created = await _create_task_from_uploaded_file(
            request=request,
            file=file,
            language=language,
            workflow=workflow,
            task_store=task_store,
            runner=runner,
        )
        tasks.append(created)
    return TaskBatchCreateResponse(strategy=strategy, tasks=tasks)


@router.get("/stats", response_model=TaskStatsResponse)
def get_task_stats(task_store: TaskStore = Depends(get_task_store)) -> TaskStatsResponse:
    stats = task_store.stats()
    return TaskStatsResponse(total=stats.total, notes=stats.notes, vqa=stats.vqa, completed=stats.completed)


@router.get("/recent", response_model=TaskRecentResponse)
def get_recent_tasks(
    limit: int = Query(default=6, ge=1, le=20),
    task_store: TaskStore = Depends(get_task_store),
) -> TaskRecentResponse:
    rows = task_store.recent(limit=limit)
    return TaskRecentResponse(
        items=[
            TaskRecentItem(
                id=row.id,
                title=(row.title or row.source_input or row.id),
                workflow=_normalize_workflow(row.workflow),
                updated_at=row.updated_at,
            )
            for row in rows
        ]
    )


@router.get("", response_model=TaskListResponse)
def list_tasks(
    q: str | None = Query(default=None, description="title/source search"),
    workflow: WorkflowType | Literal["all"] = Query(default="all"),
    status_filter: str | None = Query(default=None, alias="status"),
    sort_by: Literal["date", "name", "size"] = Query(default="date"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    task_store: TaskStore = Depends(get_task_store),
) -> TaskListResponse:
    listing = task_store.list(
        q=q,
        workflow=None if workflow == "all" else workflow,
        status=status_filter,
        sort_by=sort_by,
        limit=limit,
        offset=offset,
    )
    return TaskListResponse(items=[_to_summary_item(row) for row in listing.items], total=listing.total)


@router.get("/{task_id}", response_model=TaskDetailResponse)
def get_task(task_id: str, task_store: TaskStore = Depends(get_task_store)) -> TaskDetailResponse:
    record = _require_task(task_store, task_id)
    return _to_detail(record)


@router.get("/{task_id}/source-media")
def get_task_source_media(task_id: str, task_store: TaskStore = Depends(get_task_store)):
    record = _require_task(task_store, task_id)
    target_path = _resolve_task_source_media_path(record)
    media_type = mimetypes.guess_type(str(target_path))[0] or "application/octet-stream"
    return FileResponse(target_path, media_type=media_type)


@router.get("/{task_id}/artifacts/file")
def get_task_artifact_file(
    task_id: str,
    request: Request,
    path: str = Query(..., min_length=1),
    task_store: TaskStore = Depends(get_task_store),
):
    _require_task(task_store, task_id)
    storage_dir = str(request.app.state.settings.storage_dir)
    target_path = _resolve_task_artifact_path(storage_dir=storage_dir, task_id=task_id, relative_path=path)
    if not target_path.exists() or not target_path.is_file():
        raise AppError.not_found("Task artifact not found", code="TASK_ARTIFACT_NOT_FOUND")
    media_type = mimetypes.guess_type(str(target_path))[0] or "application/octet-stream"
    return FileResponse(target_path, media_type=media_type)


@router.get("/{task_id}/open-location")
def open_task_location(task_id: str, task_store: TaskStore = Depends(get_task_store)) -> JSONResponse:
    record = _require_task(task_store, task_id)
    path_value = record.source_local_path or ""
    if not path_value:
        raise AppError.bad_request("Task has no local path", code="TASK_LOCAL_PATH_MISSING")
    path = Path(path_value)
    if path.is_file():
        path = path.parent
    return JSONResponse({"task_id": task_id, "path": str(path.resolve())})


@router.patch("/{task_id}/title", response_model=TaskSummaryItem)
def update_task_title(
    task_id: str,
    payload: TaskTitleUpdateRequest,
    task_store: TaskStore = Depends(get_task_store),
) -> TaskSummaryItem:
    _require_task(task_store, task_id)
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
    request: Request,
    task_id: str,
    task_store: TaskStore = Depends(get_task_store),
) -> Response:
    record = _require_task(task_store, task_id)
    if record.status not in {TaskStatus.COMPLETED.value, TaskStatus.FAILED.value, TaskStatus.CANCELLED.value}:
        raise AppError.conflict("Running task cannot be deleted", code="TASK_DELETE_FORBIDDEN")
    task_store.delete(task_id)
    settings = request.app.state.settings
    shutil.rmtree(Path(settings.temp_dir) / task_id, ignore_errors=True)
    for candidate in Path(settings.upload_dir).glob(f"{task_id}_*"):
        if candidate.is_dir():
            shutil.rmtree(candidate, ignore_errors=True)
        else:
            candidate.unlink(missing_ok=True)
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
    workflow = _normalize_workflow(record.workflow)
    return TaskCreateResponse(
        task_id=task_id,
        status=_to_public_status(TaskStatus.CANCELLED.value),
        workflow=workflow,
        initial_steps=_build_initial_steps(workflow),
    )


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
    workflow = _normalize_workflow(record.workflow)
    return TaskCreateResponse(
        task_id=task_id,
        status=TaskStatus.SUMMARIZING.value,
        workflow=workflow,
        initial_steps=_build_initial_steps(workflow),
    )


@router.get("/{task_id}/events")
async def stream_task_events(
    task_id: str,
    request: Request,
    event_bus: EventBus = Depends(get_event_bus),
    task_store: TaskStore = Depends(get_task_store),
) -> StreamingResponse:
    subscription = await event_bus.subscribe(task_id)
    workflow = "notes"
    record = task_store.get(task_id)
    if record is not None:
        workflow = _normalize_workflow(record.workflow)

    async def event_generator():
        try:
            for item in subscription.history:
                normalized = _normalize_stream_event(task_id=task_id, workflow=workflow, event=item)
                yield f"data: {orjson.dumps(normalized).decode('utf-8')}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(subscription.queue.get(), timeout=10)
                    normalized = _normalize_stream_event(task_id=task_id, workflow=workflow, event=event)
                    yield f"data: {orjson.dumps(normalized).decode('utf-8')}\n\n"
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
    request: Request,
    task_id: str,
    kind: str,
    archive: Literal["zip", "tar"] = Query(default="zip"),
    task_store: TaskStore = Depends(get_task_store),
):
    record = _require_task(task_store, task_id)
    if record.status != TaskStatus.COMPLETED.value:
        raise AppError.conflict("Task is not completed", code="TASK_NOT_COMPLETED")
    title = sanitize_filename(record.title or task_id)

    if kind == "transcript":
        return PlainTextResponse(
            record.transcript_text or "",
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": _build_content_disposition(f"{title}-transcript.txt")},
        )
    if kind == "notes":
        return PlainTextResponse(
            record.notes_markdown or "",
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": _build_content_disposition(f"{title}-notes.md")},
        )
    if kind == "mindmap":
        html = render_markmap_html(record.mindmap_markdown or "# Empty", title=record.title or task_id)
        return HTMLResponse(
            html,
            media_type="text/html; charset=utf-8",
            headers={"Content-Disposition": _build_content_disposition(f"{title}-mindmap.html")},
        )
    if kind == "srt":
        srt_text = _build_srt(_parse_transcript_segments(record.transcript_segments_json))
        return PlainTextResponse(
            srt_text,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": _build_content_disposition(f"{title}-subtitles.srt")},
        )
    if kind == "vtt":
        vtt_text = _build_vtt(_parse_transcript_segments(record.transcript_segments_json))
        return PlainTextResponse(
            vtt_text,
            media_type="text/vtt; charset=utf-8",
            headers={"Content-Disposition": _build_content_disposition(f"{title}-subtitles.vtt")},
        )
    if kind == "bundle":
        payload = _build_artifact_bundle(
            record=record,
            title=title,
            archive=archive,
            storage_dir=str(request.app.state.settings.storage_dir),
        )
        ext = "zip" if archive == "zip" else "tar"
        media_type = "application/zip" if archive == "zip" else "application/x-tar"
        return Response(
            content=payload,
            media_type=media_type,
            headers={"Content-Disposition": _build_content_disposition(f"{title}-artifacts.{ext}")},
        )
    raise AppError.bad_request("Unsupported export kind", code="INVALID_EXPORT_KIND")


async def _create_task_from_uploaded_file(
    *,
    request: Request,
    file: UploadFile,
    language: str,
    workflow: WorkflowType,
    task_store: TaskStore,
    runner: TaskRunner,
) -> TaskCreateResponse:
    normalized_model_size = "small"
    settings = request.app.state.settings
    file_name = file.filename or "uploaded-video"
    suffix = Path(file_name).suffix.lower()
    _validate_video_extension(suffix)

    task_id = _next_task_id(task_store)
    target_path = Path(settings.upload_dir) / f"{task_id}_{sanitize_filename(file_name)}"
    size = await _persist_uploaded_video(
        file=file,
        target_path=target_path,
        max_bytes=settings.max_upload_mb * 1024 * 1024,
        max_upload_mb=settings.max_upload_mb,
    )

    now = datetime.now(timezone.utc)
    record = TaskRecord(
        id=task_id,
        source_type="local_file",
        source_input=file_name,
        source_local_path=str(target_path),
        status=TaskStatus.QUEUED.value,
        progress=0,
        model_size=normalized_model_size,
        language=language,
        workflow=workflow,
        file_size_bytes=max(0, int(size)),
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
            workflow=workflow,
        )
    )
    return TaskCreateResponse(
        task_id=task_id,
        status=_to_public_status(TaskStatus.QUEUED.value),
        workflow=workflow,
        initial_steps=_build_initial_steps(workflow),
    )


async def _persist_uploaded_video(
    *,
    file: UploadFile,
    target_path: Path,
    max_bytes: int,
    max_upload_mb: int,
) -> int:
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
                    message=f"File too large, max {max_upload_mb}MB",
                    code="UPLOAD_FILE_TOO_LARGE",
                    hint="请压缩视频或分片上传。",
                )
            await out.write(chunk)
    await file.close()
    return size


def _build_artifact_bundle(
    record: TaskRecord,
    title: str,
    archive: Literal["zip", "tar"],
    *,
    storage_dir: str,
) -> bytes:
    files = _build_artifact_files(record=record, title=title, storage_dir=storage_dir)
    if archive == "zip":
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
            for name, content in sorted(files.items()):
                zip_file.writestr(name, content)
        return buffer.getvalue()
    buffer = io.BytesIO()
    timestamp = int(datetime.now(timezone.utc).timestamp())
    with tarfile.open(fileobj=buffer, mode="w") as tar_file:
        for name, content in sorted(files.items()):
            info = tarfile.TarInfo(name=name)
            info.size = len(content)
            info.mtime = timestamp
            tar_file.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


def _build_artifact_files(record: TaskRecord, title: str, *, storage_dir: str) -> dict[str, bytes]:
    mindmap_html = render_markmap_html(record.mindmap_markdown or "# Empty", title=record.title or record.id)
    files = {
        f"{title}-transcript.txt": (record.transcript_text or "").encode("utf-8"),
        f"{title}-notes.md": (record.notes_markdown or "").encode("utf-8"),
        f"{title}-mindmap.md": (record.mindmap_markdown or "").encode("utf-8"),
        f"{title}-mindmap.html": mindmap_html.encode("utf-8"),
        f"{title}-subtitles.srt": _build_srt(_parse_transcript_segments(record.transcript_segments_json)).encode("utf-8"),
        f"{title}-subtitles.vtt": _build_vtt(_parse_transcript_segments(record.transcript_segments_json)).encode("utf-8"),
    }
    files.update(_load_notes_image_assets(task_id=record.id, storage_dir=storage_dir))
    return files


def _load_notes_image_assets(*, task_id: str, storage_dir: str) -> dict[str, bytes]:
    notes_images_dir = (
        Path(storage_dir)
        / "tasks"
        / "stage-artifacts"
        / task_id
        / "D"
        / "fusion"
        / "notes-images"
    )
    if not notes_images_dir.exists() or not notes_images_dir.is_dir():
        return {}
    files: dict[str, bytes] = {}
    for image_path in sorted(notes_images_dir.rglob("*.png")):
        if not image_path.is_file():
            continue
        try:
            relative_path = image_path.relative_to(notes_images_dir).as_posix()
            files[f"notes-images/{relative_path}"] = image_path.read_bytes()
        except OSError:
            continue
    return files


def _build_content_disposition(filename: str) -> str:
    ascii_fallback = "".join(ch if 32 <= ord(ch) <= 126 and ch not in {'"', "\\", ";"} else "_" for ch in filename)
    ascii_fallback = ascii_fallback or "download.bin"
    encoded_filename = quote(filename, safe="")
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded_filename}"


def _resolve_task_source_media_path(record: TaskRecord) -> Path:
    path_value = (record.source_local_path or "").strip()
    if not path_value:
        raise AppError.bad_request("Task has no local source media", code="TASK_SOURCE_MEDIA_MISSING")
    target_path = Path(path_value).expanduser()
    if not target_path.exists() or not target_path.is_file():
        raise AppError.not_found("Task source media not found", code="TASK_SOURCE_MEDIA_NOT_FOUND")
    return target_path


def _resolve_task_artifact_path(*, storage_dir: str, task_id: str, relative_path: str) -> Path:
    normalized = relative_path.replace("\\", "/").strip().lstrip("/")
    if not normalized or ".." in Path(normalized).parts:
        raise AppError.bad_request("Invalid artifact path", code="TASK_ARTIFACT_PATH_INVALID")
    artifact_root = Path(storage_dir) / "tasks" / "stage-artifacts" / task_id / "D" / "fusion"
    target_path = (artifact_root / normalized).resolve()
    if artifact_root.resolve() not in target_path.parents and target_path != artifact_root.resolve():
        raise AppError.bad_request("Artifact path escaped task root", code="TASK_ARTIFACT_PATH_INVALID")
    return target_path


def _to_summary_item(record: TaskRecord) -> TaskSummaryItem:
    return TaskSummaryItem(
        id=record.id,
        title=record.title,
        workflow=_normalize_workflow(record.workflow),
        source_type=record.source_type,  # type: ignore[arg-type]
        source_input=record.source_input,
        status=_to_public_status(record.status),
        progress=max(0, min(100, int(record.progress))),
        file_size_bytes=max(0, int(record.file_size_bytes or 0)),
        duration_seconds=record.duration_seconds,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _to_detail(record: TaskRecord) -> TaskDetailResponse:
    workflow = _normalize_workflow(record.workflow)
    transcript_segments = _parse_transcript_segments(record.transcript_segments_json)
    stage_logs = _parse_stage_logs(record.stage_logs_json)
    stage_metrics = _parse_stage_metrics(record.stage_metrics_json)
    vm_phase_metrics = _build_vm_phase_metrics(stage_metrics)
    steps = _build_steps_for_workflow(workflow=workflow, stage_metrics=stage_metrics, overall_progress=record.progress)
    eta_seconds = _estimate_eta_seconds(
        status=_to_public_status(record.status),
        progress=max(0, min(100, int(record.progress))),
        stage_metrics=stage_metrics,
    )
    current_step_id = ""
    for step in steps:
        if step.status == "processing":
            current_step_id = step.id
            break
    if not current_step_id and steps:
        for step in steps:
            if step.status != "completed":
                current_step_id = step.id
                break

    return TaskDetailResponse(
        id=record.id,
        title=record.title,
        workflow=workflow,
        source_type=record.source_type,  # type: ignore[arg-type]
        source_input=record.source_input,
        source_local_path=record.source_local_path,
        language=record.language,
        model_size=record.model_size,
        status=_to_public_status(record.status),
        progress=max(0, min(100, int(record.progress))),
        overall_progress=max(0, min(100, int(record.progress))),
        eta_seconds=eta_seconds,
        current_step_id=current_step_id,
        steps=steps,
        error_message=record.error_message,
        duration_seconds=record.duration_seconds,
        transcript_text=record.transcript_text,
        transcript_segments=transcript_segments,
        summary_markdown=record.summary_markdown,
        mindmap_markdown=record.mindmap_markdown,
        notes_markdown=record.notes_markdown,
        fusion_prompt_markdown=record.fusion_prompt_markdown,
        stage_logs=stage_logs,
        stage_metrics=stage_metrics,
        vm_phase_metrics=vm_phase_metrics,
        artifact_total_bytes=max(0, int(record.artifact_total_bytes or 0)),
        artifact_index=parse_task_artifact_index(record.artifact_index_json),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _build_initial_steps(workflow: WorkflowType) -> list[TaskStepItem]:
    return [
        TaskStepItem(id=item["id"], name=item["name"], status="pending", progress=0, duration="", logs=[])
        for item in _workflow_step_blueprint(workflow)
    ]


def _build_steps_for_workflow(
    *,
    workflow: WorkflowType,
    stage_metrics: dict[str, dict[str, object]],
    overall_progress: int,
) -> list[TaskStepItem]:
    progress = max(0, min(100, int(overall_progress or 0)))
    steps: list[TaskStepItem] = []
    for item in _workflow_step_blueprint(workflow):
        metric = _resolve_metric_for_step(item["id"], stage_metrics)
        step_status = _metric_to_step_status(metric)
        step_progress = 100 if step_status == "completed" else (progress if step_status == "processing" else 0)
        elapsed_seconds = _to_optional_float(metric.get("elapsed_seconds")) if metric else None
        steps.append(
            TaskStepItem(
                id=item["id"],
                name=item["name"],
                status=step_status,
                progress=step_progress,
                duration=_format_duration(elapsed_seconds),
                logs=[],
            )
        )
    return steps


def _workflow_step_blueprint(workflow: WorkflowType) -> list[dict[str, str]]:
    if workflow == "vqa":
        return [
            {"id": "extract", "name": "音频提取"},
            {"id": "transcribe", "name": "语音转写"},
            {"id": "correct", "name": "文本纠错"},
            {"id": "embed", "name": "向量化入库"},
            {"id": "frames", "name": "帧画面分析"},
            {"id": "ready", "name": "问答就绪"},
        ]
    return [
        {"id": "extract", "name": "音频提取"},
        {"id": "transcribe", "name": "语音转写"},
        {"id": "correct", "name": "文本纠错"},
        {"id": "notes", "name": "笔记生成"},
    ]


def _resolve_metric_for_step(step_id: str, stage_metrics: dict[str, dict[str, object]]) -> dict[str, object]:
    a_metric = stage_metrics.get("A", {})
    b_metric = stage_metrics.get("B", {})
    c_metric = stage_metrics.get("C", {})
    d_metric = stage_metrics.get("D", {})
    sub = d_metric.get("substage_metrics", {}) if isinstance(d_metric, dict) else {}
    sub_metrics = sub if isinstance(sub, dict) else {}
    if step_id == "extract":
        return _merge_step_metrics(
            a_metric if isinstance(a_metric, dict) else {},
            b_metric if isinstance(b_metric, dict) else {},
        )
    if step_id == "transcribe":
        return c_metric if isinstance(c_metric, dict) else {}
    if step_id == "correct":
        metric = sub_metrics.get("transcript_optimize", {})
        return metric if isinstance(metric, dict) else {}
    metric = sub_metrics.get("fusion_delivery", d_metric)
    return metric if isinstance(metric, dict) else {}


def _merge_step_metrics(*metrics: dict[str, object]) -> dict[str, object]:
    valid_metrics = [metric for metric in metrics if isinstance(metric, dict) and metric]
    if not valid_metrics:
        return {}

    def status_rank(metric: dict[str, object]) -> tuple[int, int]:
        raw = str(metric.get("status", "") or "").strip().lower()
        if raw in {"failed", "error", "cancelled"}:
            return (4, 0)
        if raw in {"running", "processing"}:
            return (3, 0)
        if raw in {"completed", "done", "success", "skipped"}:
            return (2, 0)
        if str(metric.get("started_at", "") or "").strip():
            return (1, 0)
        return (0, 0)

    primary = max(valid_metrics, key=status_rank)
    started_candidates = [str(metric.get("started_at", "") or "").strip() for metric in valid_metrics if str(metric.get("started_at", "") or "").strip()]
    completed_candidates = [str(metric.get("completed_at", "") or "").strip() for metric in valid_metrics if str(metric.get("completed_at", "") or "").strip()]
    elapsed_total = sum(_to_optional_float(metric.get("elapsed_seconds")) or 0.0 for metric in valid_metrics)

    return {
        **primary,
        "started_at": min(started_candidates) if started_candidates else primary.get("started_at"),
        "completed_at": max(completed_candidates) if completed_candidates else primary.get("completed_at"),
        "elapsed_seconds": round(elapsed_total, 2) if elapsed_total > 0 else primary.get("elapsed_seconds"),
    }


def _metric_to_step_status(metric: dict[str, object]) -> Literal["pending", "processing", "completed", "error"]:
    if not metric:
        return "pending"
    raw = str(metric.get("status", "") or "").strip().lower()
    if raw in {"failed", "error", "cancelled"}:
        return "error"
    if raw in {"completed", "done", "success", "skipped"}:
        return "completed"
    if raw in {"running", "processing"}:
        return "processing"
    started_at = str(metric.get("started_at", "") or "").strip()
    completed_at = str(metric.get("completed_at", "") or "").strip()
    if completed_at:
        return "completed"
    if started_at:
        return "processing"
    return "pending"


def _to_public_status(raw_status: str) -> str:
    status_lower = str(raw_status or "").strip().lower()
    if status_lower in {"completed", "failed", "cancelled", "queued"}:
        return status_lower
    if status_lower in {"preparing", "transcribing", "summarizing", "running"}:
        return "running"
    return "queued"


def _normalize_workflow(raw: str) -> WorkflowType:
    value = str(raw or "").strip().lower()
    if value == "vqa":
        return "vqa"
    return "notes"


def _estimate_eta_seconds(
    *,
    status: str,
    progress: int,
    stage_metrics: dict[str, dict[str, object]],
) -> int | None:
    if status != "running":
        return None
    if progress <= 0 or progress >= 100:
        return None
    elapsed = 0.0
    for stage_key in STAGE_KEYS:
        metric = stage_metrics.get(stage_key, {})
        if not isinstance(metric, dict):
            continue
        elapsed_value = _to_optional_float(metric.get("elapsed_seconds"))
        if elapsed_value and elapsed_value > 0:
            elapsed += elapsed_value
    if elapsed <= 0:
        return None
    estimated_total = elapsed * (100.0 / progress)
    remaining = max(0.0, estimated_total - elapsed)
    return int(round(remaining))


def _normalize_stream_event(*, task_id: str, workflow: WorkflowType, event: dict[str, object]) -> dict[str, object]:
    normalized = dict(event)
    raw_type = str(event.get("type", "")).strip()
    mapped = raw_type
    if raw_type in {"progress", "stage_start", "stage_complete", "substage_start", "substage_complete", "log"}:
        mapped = "step_updated"
    elif raw_type == "transcript_delta":
        mapped = "transcript_chunk"
    elif raw_type in {"summary_delta", "mindmap_delta", "transcript_optimized_preview", "fusion_prompt_preview"}:
        mapped = "artifact_ready"
    elif raw_type == "task_complete":
        mapped = "task_completed"
    elif raw_type == "task_cancelled":
        mapped = "task_failed"

    normalized["type"] = mapped
    normalized["task_id"] = task_id
    normalized["workflow"] = workflow
    normalized["timestamp"] = str(event.get("timestamp") or datetime.now(timezone.utc).isoformat())
    if raw_type and raw_type != mapped:
        normalized["original_type"] = raw_type
    return normalized


def _format_duration(elapsed_seconds: float | None) -> str:
    if elapsed_seconds is None or elapsed_seconds <= 0:
        return ""
    total = int(round(elapsed_seconds))
    minutes = total // 60
    seconds = total % 60
    return f"{minutes}:{seconds:02d}"


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
            "optional": bool(metric.get("optional", True)),
            "reason": metric.get("reason"),
        }

    final_metric = substage_metrics.get("fusion_delivery", {})
    final_dict = final_metric if isinstance(final_metric, dict) else {}
    result["D"] = {
        "status": str(final_dict.get("status", to_status(d_metric))).strip().lower() or "pending",
        "started_at": final_dict.get("started_at", d_metric.get("started_at")),
        "completed_at": final_dict.get("completed_at", d_metric.get("completed_at")),
        "elapsed_seconds": final_dict.get("elapsed_seconds", d_metric.get("elapsed_seconds")),
        "optional": False,
        "reason": final_dict.get("reason"),
    }
    return result


def _to_optional_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


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
        normalized.append(TranscriptSegment(start=round(start, 3), end=round(end, 3), text=text))
    return normalized


def _format_subtitle_timestamp(seconds: float, separator: str) -> str:
    total_milliseconds = max(0, int(round(seconds * 1000)))
    hours = total_milliseconds // 3_600_000
    minutes = (total_milliseconds % 3_600_000) // 60_000
    secs = (total_milliseconds % 60_000) // 1_000
    milliseconds = total_milliseconds % 1_000
    return f"{hours:02}:{minutes:02}:{secs:02}{separator}{milliseconds:03}"


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
