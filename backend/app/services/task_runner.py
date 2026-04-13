from __future__ import annotations

import asyncio
import logging
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import orjson

from app.config import Settings
from app.models import TaskStatus
from app.services.events import EventBus
from app.services.gpu_stage_worker_client import GPUStageWorkerClient
from app.services.ingestion import (
    AudioChunk,
    IngestionResult,
    download_bilibili_video,
    extract_audio_wav,
    prepare_local_video,
    split_audio_wav,
)
from app.services.llm_config_store import LLMConfigStore
from app.services.model_runtime_manager import ModelRuntimeManager
from app.services.prompt_template_store import PromptTemplateStore
from app.services.resource_guard import ResourceGuard
from app.services.runtime_config_store import RuntimeConfigStore
from app.services.stage_artifact_store import StageArtifactStore
from app.services.summarizer import LLMService, NotesImageAsset
from app.services.task_artifact_index import build_task_artifact_index
from app.services.task_preflight import TaskPreflightService
from app.services.task_store import TaskStore
from app.services.transcription import WhisperService

SourceType = Literal["bilibili", "local_file", "local_path"]
StageType = Literal["A", "B", "C", "D"]
DSubstageType = Literal["transcript_optimize", "fusion_delivery"]
ExecutionMode = Literal["api"]

_STAGE_KEYS: tuple[StageType, StageType, StageType, StageType] = ("A", "B", "C", "D")
_RESOURCE_GUARD_WARNING_CODE = "RESOURCE_GUARD_WARNING"
_RESOURCE_GUARD_WARNING_ACTION = "review_runtime_config"
_D_SUBSTAGE_KEYS: tuple[DSubstageType, ...] = (
    "transcript_optimize",
    "fusion_delivery",
)
_D_SUBSTAGE_TITLES: dict[DSubstageType, str] = {
    "transcript_optimize": "转录文本优化",
    "fusion_delivery": "融合生成与交付",
}
_PROGRESS_STAGE_A_START = 2
_PROGRESS_STAGE_A_DONE = 10
_PROGRESS_STAGE_B_START = 12
_PROGRESS_STAGE_B_DONE = 22
_PROGRESS_STAGE_C_START = 24
_PROGRESS_STAGE_C_DONE = 46
_PROGRESS_STAGE_D_START = 48
_PROGRESS_TRANSCRIPT_DONE = 60
_PROGRESS_FUSION_START = 75
_PROGRESS_FUSION_DONE = 99
_PROGRESS_TASK_DONE = 100

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class TaskSubmission:
    task_id: str
    source_type: SourceType
    source_input: str
    source_local_path: str | None
    model_size: str
    language: str
    workflow: str = "notes"


class TaskRunner:
    def __init__(
        self,
        settings: Settings,
        event_bus: EventBus,
        llm_config_store: LLMConfigStore,
        prompt_template_store: PromptTemplateStore,
        runtime_config_store: RuntimeConfigStore,
        resource_guard: ResourceGuard,
        model_runtime_manager: ModelRuntimeManager,
        task_store: TaskStore,
        task_preflight_service: TaskPreflightService,
    ) -> None:
        self._settings = settings
        self._event_bus = event_bus
        self._llm_config_store = llm_config_store
        self._resource_guard = resource_guard
        self._runtime_config_store = runtime_config_store
        self._model_runtime_manager = model_runtime_manager
        self._task_store = task_store
        self._task_preflight_service = task_preflight_service
        self._transcriber = WhisperService(settings)
        self._summarizer = LLMService(
            settings,
            llm_config_store=llm_config_store,
            prompt_template_store=prompt_template_store,
        )
        self._gpu_stage_worker_client = GPUStageWorkerClient(settings)
        self._stage_artifact_store = StageArtifactStore(settings.storage_dir)
        self._jobs: dict[str, asyncio.Task[None]] = {}
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_jobs)
        self._api_mode_semaphore = asyncio.Semaphore(max(1, settings.max_api_mode_jobs))
        self._task_stage_started: dict[str, dict[StageType, float]] = {}
        self._task_stage_metrics: dict[str, dict[StageType, dict[str, object]]] = {}
        self._pause_requests: set[str] = set()

    async def submit(self, submission: TaskSubmission) -> None:
        job = asyncio.create_task(self._run_pipeline(submission))
        self._jobs[submission.task_id] = job
        job.add_done_callback(lambda _: self._jobs.pop(submission.task_id, None))

    async def resume_incomplete_tasks(self) -> list[str]:
        recovered_task_ids: list[str] = []
        records = await asyncio.to_thread(self._task_store.list_all)
        for record in sorted(records, key=lambda item: item.updated_at):
            status = str(record.status or "").strip().lower()
            if status not in {
                TaskStatus.QUEUED.value,
                TaskStatus.PREPARING.value,
                TaskStatus.TRANSCRIBING.value,
                TaskStatus.SUMMARIZING.value,
            }:
                continue
            if record.id in self._jobs and not self._jobs[record.id].done():
                continue
            try:
                if self._should_resume_stage_d(record):
                    await asyncio.to_thread(self._prepare_stage_d_record, record.id, False)
                    await self._event_bus.reset_task(record.id)
                    job = asyncio.create_task(self._run_stage_d_retry(record.id))
                    self._jobs[record.id] = job
                    job.add_done_callback(lambda _, task_id=record.id: self._jobs.pop(task_id, None))
                else:
                    await self.submit(self._build_submission_from_record(record))
                recovered_task_ids.append(record.id)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Failed to recover unfinished task %s: %s", record.id, exc)
        return recovered_task_ids

    async def rerun_stage_d(self, task_id: str) -> bool:
        existing = self._jobs.get(task_id)
        if existing is not None and not existing.done():
            return False

        await asyncio.to_thread(self._prepare_stage_d_record, task_id, True)
        await self._event_bus.reset_task(task_id)
        job = asyncio.create_task(self._run_stage_d_retry(task_id))
        self._jobs[task_id] = job
        job.add_done_callback(lambda _: self._jobs.pop(task_id, None))
        return True

    async def cancel(self, task_id: str) -> bool:
        job = self._jobs.get(task_id)
        if job is not None and not job.done():
            job.cancel()
            # If cancellation happens before semaphore acquisition, pipeline-level handlers won't run.
            # In that case, reconcile task state here after yielding once to the event loop.
            await asyncio.sleep(0)
            if job.done():
                await self._mark_cancelled(task_id, emit_event=True, cleanup_media_dir=True)
            return True

        return await self._mark_cancelled(task_id, emit_event=True, cleanup_media_dir=True)

    async def pause(self, task_id: str) -> bool:
        job = self._jobs.get(task_id)
        if job is not None and not job.done():
            self._pause_requests.add(task_id)
            job.cancel()
            await asyncio.sleep(0)
            if job.done():
                await self._mark_paused(task_id, emit_event=True)
            return True

        return await self._mark_paused(task_id, emit_event=True)

    async def resume(self, task_id: str) -> bool:
        existing = self._jobs.get(task_id)
        if existing is not None and not existing.done():
            return False

        record = await asyncio.to_thread(self._task_store.get, task_id)
        if record is None:
            raise ValueError(f"Task not found: {task_id}")
        if record.status != TaskStatus.PAUSED.value:
            return False

        self._pause_requests.discard(task_id)
        await self._event_bus.reset_task(task_id)
        if self._should_resume_stage_d(record):
            await asyncio.to_thread(self._prepare_stage_d_record, task_id, False)
            job = asyncio.create_task(self._run_stage_d_retry(task_id))
        else:
            await asyncio.to_thread(
                self._task_store.update,
                task_id,
                status=TaskStatus.QUEUED.value,
                error_message=None,
            )
            job = asyncio.create_task(self._run_pipeline(self._build_submission_from_record(record)))
        self._jobs[task_id] = job
        job.add_done_callback(lambda _, resumed_task_id=task_id: self._jobs.pop(resumed_task_id, None))
        return True

    async def shutdown(self) -> None:
        running_jobs = list(self._jobs.values())
        for job in running_jobs:
            if not job.done():
                job.cancel()
        if running_jobs:
            await asyncio.gather(*running_jobs, return_exceptions=True)
        self._transcriber.shutdown()

    def _prepare_stage_d_record(self, task_id: str, require_terminal: bool) -> None:
        record = self._task_store.get(task_id)
        if record is None:
            raise ValueError(f"Task not found: {task_id}")
        if require_terminal and record.status not in {
            TaskStatus.FAILED.value,
            TaskStatus.CANCELLED.value,
            TaskStatus.COMPLETED.value,
        }:
            raise ValueError("Only terminal tasks can rerun stage D.")
        has_transcript = bool((record.transcript_text or "").strip())
        has_segments = bool((record.transcript_segments_json or "").strip())
        if not has_transcript and not has_segments:
            raise ValueError("Task has no persisted transcript artifacts for stage-D rerun.")
        stage_logs = _decode_stage_logs(record.stage_logs_json)
        stage_logs["D"] = []
        stage_metrics = _decode_stage_metrics(record.stage_metrics_json)
        stage_metrics["D"] = _empty_stage_metrics()["D"]
        self._task_store.remove_analysis_results(task_id, prefixes=("D:", "D"))
        self._stage_artifact_store.reset_stage(task_id, "D")
        self._task_store.update(
            task_id,
            status=TaskStatus.SUMMARIZING.value,
            progress=_PROGRESS_STAGE_D_START,
            error_message=None,
            summary_markdown=None,
            notes_markdown=None,
            mindmap_markdown=None,
            fusion_prompt_markdown=None,
            artifact_index_json=None,
            artifact_total_bytes=0,
            stage_logs_json=_encode_stage_logs(stage_logs),
            stage_metrics_json=_encode_stage_metrics(stage_metrics),
        )

    def _should_resume_stage_d(self, record) -> bool:
        has_transcript = bool((record.transcript_text or "").strip())
        has_segments = bool((record.transcript_segments_json or "").strip())
        if not has_transcript and not has_segments:
            return False
        status = str(record.status or "").strip().lower()
        if status == TaskStatus.SUMMARIZING.value:
            return True
        stage_metrics = _decode_stage_metrics(record.stage_metrics_json)
        c_status = str(stage_metrics.get("C", {}).get("status", "") or "").strip().lower()
        d_status = str(stage_metrics.get("D", {}).get("status", "") or "").strip().lower()
        return c_status == "completed" and d_status != "completed"

    @staticmethod
    def _build_submission_from_record(record) -> TaskSubmission:
        return TaskSubmission(
            task_id=record.id,
            source_type=record.source_type,  # type: ignore[arg-type]
            source_input=record.source_input,
            source_local_path=record.source_local_path,
            model_size=str(record.model_size or "small"),
            language=str(record.language or "zh"),
            workflow=str(record.workflow or "notes"),
        )

    async def _run_pipeline(self, submission: TaskSubmission) -> None:
        async with self._semaphore:
            task_id = submission.task_id
            media_dir = Path(self._settings.temp_dir) / task_id
            audio_path = media_dir / "audio.wav"
            chunks_dir = media_dir / "chunks"
            stage_logs = _empty_stage_logs()
            stage_metrics = _empty_stage_metrics()
            active_stage: StageType = "A"
            media_dir.mkdir(parents=True, exist_ok=True)
            event_loop = asyncio.get_running_loop()
            whisper_config = await self._runtime_config_store.get_whisper()
            llm_runtime_config = await self._llm_config_store.get()
            execution_mode = _resolve_execution_mode(llm_runtime_config=llm_runtime_config)
            mode_semaphore = self._select_mode_semaphore(execution_mode)
            mode_wait_started_at = event_loop.time()
            await mode_semaphore.acquire()
            mode_wait_seconds = max(0.0, event_loop.time() - mode_wait_started_at)

            runtime_warnings: list[str] = []
            whisper_guard = self._resource_guard.guard_whisper_config(whisper_config)
            if whisper_guard["rollback_applied"]:
                whisper_config = whisper_guard["config"]  # type: ignore[assignment]
            runtime_warnings.extend(whisper_guard["warnings"])
            llm_guard = self._resource_guard.guard_llm_config(llm_runtime_config)
            if llm_guard["rollback_applied"]:
                llm_runtime_config = llm_guard["config"]  # type: ignore[assignment]
            runtime_warnings.extend(llm_guard["warnings"])
            runtime_warnings.extend(self._resource_guard.ensure_runtime_capacity(whisper=whisper_config, llm=llm_runtime_config))

            selected_model = "small"
            selected_language = submission.language.strip() or whisper_config["language"]
            self._task_stage_started[task_id] = {}
            self._task_stage_metrics[task_id] = stage_metrics

            try:
                await self._stage_start(
                    task_id,
                    "A",
                    "Source Ingestion",
                    stage_logs=stage_logs,
                    status=TaskStatus.PREPARING.value,
                    progress=_PROGRESS_STAGE_A_START,
                )
                self._set_stage_metric_values(
                    task_id,
                    "A",
                    {
                        "scheduler_mode": execution_mode,
                        "scheduler_wait_seconds": round(mode_wait_seconds, 2),
                    },
                )
                if mode_wait_seconds > 0:
                    await self._emit_log(
                        task_id,
                        "A",
                        f"Waiting for {execution_mode} execution slot: {mode_wait_seconds:.2f}s",
                        stage_logs,
                        substage="scheduler",
                    )
                await self._task_preflight_service.assert_ready_for_analysis(
                    workflow=submission.workflow,
                    stage="full_task",
                )
                for runtime_warning in runtime_warnings:
                    await self._emit_runtime_warning(
                        task_id,
                        "A",
                        runtime_warning,
                        stage_logs,
                        code=_RESOURCE_GUARD_WARNING_CODE,
                        component="resource_guard",
                        action=_RESOURCE_GUARD_WARNING_ACTION,
                        substage="resource",
                    )
                await self._emit_log(
                    task_id,
                    "A",
                    "Checking local Whisper small model cache...",
                    stage_logs,
                    substage="asr_model",
                )
                prepare_progress_last_logged = -1
                prepare_progress_last_overall = _PROGRESS_STAGE_A_START
                prepare_progress_last_emit_at = event_loop.time()

                async def on_model_prepare_progress(payload: dict[str, object]) -> None:
                    nonlocal prepare_progress_last_logged
                    nonlocal prepare_progress_last_overall
                    nonlocal prepare_progress_last_emit_at
                    status = str(payload.get("status", "") or "").strip().lower()
                    message = str(payload.get("message", "") or "").strip()
                    current_file = str(payload.get("current_file", "") or "").strip()
                    downloaded_bytes = int(payload.get("downloaded_bytes", 0) or 0)
                    total_bytes = int(payload.get("total_bytes", 0) or 0)
                    percent = float(payload.get("percent", 0.0) or 0.0)
                    safe_percent = max(0.0, min(100.0, percent))

                    if status in {"checking", "cached", "completed"}:
                        if message:
                            await self._emit_log(task_id, "A", message, stage_logs, substage="asr_model")
                        return

                    if status != "downloading":
                        return

                    now = event_loop.time()
                    normalized_percent = int(safe_percent)
                    should_emit_log = (
                        normalized_percent >= 100
                        or normalized_percent - prepare_progress_last_logged >= 5
                        or now - prepare_progress_last_emit_at >= 2.0
                    )
                    if should_emit_log:
                        if total_bytes > 0:
                            ratio = f"{_format_size_mb(downloaded_bytes)} / {_format_size_mb(total_bytes)}"
                            await self._emit_log(
                                task_id,
                                "A",
                                f"Downloading Whisper small model {normalized_percent}% ({ratio})"
                                + (f" · {current_file}" if current_file else ""),
                                stage_logs,
                                substage="asr_model",
                            )
                        else:
                            await self._emit_log(
                                task_id,
                                "A",
                                f"Downloading Whisper small model {normalized_percent}%"
                                + (f" · {current_file}" if current_file else ""),
                                stage_logs,
                                substage="asr_model",
                            )
                        prepare_progress_last_logged = normalized_percent
                        prepare_progress_last_emit_at = now

                    next_overall = _interpolate_progress(
                        _PROGRESS_STAGE_A_START,
                        _PROGRESS_STAGE_A_DONE - 1,
                        safe_percent / 100.0,
                    )
                    if next_overall > prepare_progress_last_overall:
                        prepare_progress_last_overall = next_overall
                        await self._event_bus.publish(
                            task_id,
                            {
                                "type": "progress",
                                "stage": "A",
                                "overall_progress": next_overall,
                                "stage_progress": normalized_percent,
                            },
                        )
                        await self._update_task(
                            task_id,
                            progress=next_overall,
                            stage_logs_json=_encode_stage_logs(stage_logs),
                        )

                await self._transcriber.ensure_small_model_ready(on_progress=on_model_prepare_progress)
                await self._emit_log(task_id, "A", f"Source type: {submission.source_type}", stage_logs)
                ingestion_result = await asyncio.to_thread(self._ingest_source, submission, media_dir)
                await self._emit_log(task_id, "A", f"Video ready: {ingestion_result.media_path.name}", stage_logs)
                await self._persist_stage_artifact_json(
                    task_id,
                    "A",
                    "ingestion.json",
                    {
                        "task_id": task_id,
                        "source_type": submission.source_type,
                        "source_input": submission.source_input,
                        "source_local_path": str(ingestion_result.media_path),
                        "title": ingestion_result.title,
                        "duration_seconds": ingestion_result.duration_seconds,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                await self._update_task(
                    task_id,
                    title=ingestion_result.title,
                    duration_seconds=ingestion_result.duration_seconds,
                    source_local_path=submission.source_local_path or str(ingestion_result.media_path),
                    progress=_PROGRESS_STAGE_A_DONE,
                    language=selected_language,
                    model_size=selected_model,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._stage_complete(task_id, "A", progress=_PROGRESS_STAGE_A_DONE, stage_logs=stage_logs)
                active_stage = "B"

                await self._stage_start(
                    task_id,
                    "B",
                    "Audio Preprocessing and Chunking",
                    stage_logs=stage_logs,
                    progress=_PROGRESS_STAGE_B_START,
                )
                await self._emit_log(
                    task_id,
                    "B",
                    (
                        "Converting audio to WAV "
                        f"({whisper_config['target_channels']} channel, {whisper_config['target_sample_rate']}Hz)..."
                    ),
                    stage_logs,
                )
                await asyncio.to_thread(
                    extract_audio_wav,
                    ingestion_result.media_path,
                    audio_path,
                    whisper_config["target_channels"],
                    whisper_config["target_sample_rate"],
                )
                await self._emit_log(task_id, "B", f"Audio conversion completed: {audio_path.name}", stage_logs)
                await self._emit_log(
                    task_id,
                    "B",
                    f"Splitting audio into chunks ({whisper_config['chunk_seconds']}s each)...",
                    stage_logs,
                )
                audio_chunks = await asyncio.to_thread(split_audio_wav, audio_path, chunks_dir, whisper_config["chunk_seconds"])
                if not audio_chunks:
                    audio_chunks = [AudioChunk(path=audio_path, start_seconds=0.0, duration_seconds=0.0)]
                for index, chunk in enumerate(audio_chunks, start=1):
                    await self._emit_log(
                        task_id,
                        "B",
                        (
                            f"Chunk {index}/{len(audio_chunks)}: {chunk.path.name}, "
                            f"start {chunk.start_seconds:.2f}s, duration {chunk.duration_seconds:.2f}s"
                        ),
                        stage_logs,
                    )
                await self._persist_stage_artifact_json(
                    task_id,
                    "B",
                    "audio-chunks.json",
                    {
                        "task_id": task_id,
                        "chunk_count": len(audio_chunks),
                        "chunks": [
                            {
                                "index": index,
                                "file_name": chunk.path.name,
                                "start_seconds": round(chunk.start_seconds, 2),
                                "duration_seconds": round(chunk.duration_seconds, 2),
                                "end_seconds": round(chunk.start_seconds + max(0.0, chunk.duration_seconds), 2),
                            }
                            for index, chunk in enumerate(audio_chunks, start=1)
                        ],
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                await self._update_task(task_id, progress=_PROGRESS_STAGE_B_DONE, stage_logs_json=_encode_stage_logs(stage_logs))
                await self._stage_complete(task_id, "B", progress=_PROGRESS_STAGE_B_DONE, stage_logs=stage_logs)
                active_stage = "C"

                await self._stage_start(
                    task_id,
                    "C",
                    "Speech Transcription",
                    stage_logs=stage_logs,
                    status=TaskStatus.TRANSCRIBING.value,
                    progress=_PROGRESS_STAGE_C_START,
                )
                total_chunks = max(1, len(audio_chunks))
                transcript_chunks_by_index = self._load_transcript_chunk_checkpoints(task_id=task_id, audio_chunks=audio_chunks)
                recovered_chunk_indexes = sorted(transcript_chunks_by_index.keys())
                if recovered_chunk_indexes:
                    await self._emit_log(
                        task_id,
                        "C",
                        (
                            f"Recovered {len(recovered_chunk_indexes)}/{total_chunks} transcript checkpoints, "
                            "continuing from persisted chunk state."
                        ),
                        stage_logs,
                    )
                    recovered_progress = _interpolate_progress(
                        _PROGRESS_STAGE_C_START,
                        _PROGRESS_STAGE_C_DONE,
                        len(recovered_chunk_indexes) / total_chunks,
                    )
                    await self._persist_transcript_progress(
                        task_id=task_id,
                        stage_logs=stage_logs,
                        audio_chunks=audio_chunks,
                        transcript_chunks_by_index=transcript_chunks_by_index,
                        progress=recovered_progress,
                    )

                if len(recovered_chunk_indexes) < total_chunks:
                    async with self._model_runtime_manager.reserve(
                        task_id=task_id,
                        stage="C",
                        component="asr",
                        model_id=(
                            f"faster-whisper:{selected_model}"
                            f"|{whisper_config['device']}|{whisper_config['compute_type']}"
                        ),
                    ) as asr_lease:
                        self._record_runtime_lease(task_id, "C", asr_lease.wait_seconds)
                        if asr_lease.wait_seconds > 0:
                            await self._emit_log(
                                task_id,
                                "C",
                                f"Waiting for model runtime lock: {asr_lease.wait_seconds:.2f}s",
                                stage_logs,
                                substage="runtime",
                            )
                        await self._emit_log(
                            task_id,
                            "C",
                            "Starting isolated Whisper worker process for remaining transcript chunks...",
                            stage_logs,
                            substage="runtime",
                        )
                        await self._run_whisper_stage_worker(
                            task_id=task_id,
                            stage_logs=stage_logs,
                            audio_chunks=audio_chunks,
                            transcript_chunks_by_index=transcript_chunks_by_index,
                            selected_model=selected_model,
                            selected_language=selected_language,
                            whisper_config=whisper_config,
                        )
                        await self._emit_log(
                            task_id,
                            "C",
                            "Whisper worker process exited and released runtime resources.",
                            stage_logs,
                            substage="runtime",
                        )

                all_segments = self._flatten_transcript_chunk_segments(
                    transcript_chunks_by_index=transcript_chunks_by_index,
                    total_chunks=total_chunks,
                )
                transcript_text = _join_transcript_segment_texts(all_segments)
                await self._persist_transcript_progress(
                    task_id=task_id,
                    stage_logs=stage_logs,
                    audio_chunks=audio_chunks,
                    transcript_chunks_by_index=transcript_chunks_by_index,
                    progress=_PROGRESS_STAGE_C_DONE,
                )
                await self._stage_complete(task_id, "C", progress=_PROGRESS_STAGE_C_DONE, stage_logs=stage_logs)
                active_stage = "D"

                await self._stage_start(
                    task_id,
                    "D",
                    "Detailed Notes and Mindmap Generation",
                    stage_logs=stage_logs,
                    status=TaskStatus.SUMMARIZING.value,
                    progress=_PROGRESS_STAGE_D_START,
                )
                llm_model_id = str(llm_runtime_config.get("model", self._settings.llm_model)).strip() or self._settings.llm_model
                llm_requires_runtime_lock = _llm_requires_runtime_lock(llm_runtime_config)
                correction_mode = str(llm_runtime_config.get("correction_mode", "strict")).strip().lower()
                correction = None
                preview_streamed = False
                await self._reset_transcript_optimized_preview(task_id)

                async def emit_correction_preview(delta: str, stream_mode: str) -> None:
                    nonlocal preview_streamed
                    if not delta:
                        return
                    preview_streamed = True
                    await self._append_transcript_optimized_preview(task_id, delta, stream_mode=stream_mode)

                async def emit_correction_preview_segment(segment: dict[str, float | str], stream_mode: str) -> None:
                    nonlocal preview_streamed
                    text = str(segment.get("text", "")).strip()
                    if not text:
                        return
                    preview_streamed = True
                    await self._append_transcript_optimized_preview(
                        task_id,
                        text,
                        stream_mode=stream_mode,
                        start=_to_float(segment.get("start")),
                        end=_to_float(segment.get("end")),
                    )

                if correction_mode == "off":
                    await self._emit_log(
                        task_id,
                        "D",
                        "Transcript optimization skipped because correction mode is off.",
                        stage_logs,
                        substage="transcript_optimize",
                    )
                    await self._d_substage_complete(
                        task_id,
                        "transcript_optimize",
                        status="skipped",
                        message="Correction mode is off.",
                        progress=_PROGRESS_TRANSCRIPT_DONE,
                    )
                    correction = await self._summarizer.correct_transcript(
                        title=ingestion_result.title,
                        transcript_text=transcript_text,
                        segments=all_segments,
                        llm_config_override=llm_runtime_config,
                        on_preview_delta=emit_correction_preview,
                        on_preview_segment=emit_correction_preview_segment,
                    )
                else:
                    await self._d_substage_start(task_id, "transcript_optimize", progress=_PROGRESS_STAGE_D_START)
                    await self._emit_log(
                        task_id,
                        "D",
                        "Running transcript correction strategy...",
                        stage_logs,
                        substage="transcript_optimize",
                    )
                    try:
                        if llm_requires_runtime_lock:
                            async with self._model_runtime_manager.reserve(
                                task_id=task_id,
                                stage="D",
                                component="llm",
                                model_id=f"llm:{llm_model_id}",
                            ) as llm_correction_lease:
                                self._record_runtime_lease(task_id, "D", llm_correction_lease.wait_seconds)
                                if llm_correction_lease.wait_seconds > 0:
                                    await self._emit_log(
                                        task_id,
                                        "D",
                                        f"Waiting for model runtime lock: {llm_correction_lease.wait_seconds:.2f}s",
                                        stage_logs,
                                        substage="runtime",
                                    )
                                correction = await self._summarizer.correct_transcript(
                                    title=ingestion_result.title,
                                    transcript_text=transcript_text,
                                    segments=all_segments,
                                    llm_config_override=llm_runtime_config,
                                    on_preview_delta=emit_correction_preview,
                                    on_preview_segment=emit_correction_preview_segment,
                                )
                        else:
                            correction = await self._summarizer.correct_transcript(
                                title=ingestion_result.title,
                                transcript_text=transcript_text,
                                segments=all_segments,
                                llm_config_override=llm_runtime_config,
                                on_preview_delta=emit_correction_preview,
                                on_preview_segment=emit_correction_preview_segment,
                            )
                        await self._d_substage_complete(
                            task_id,
                            "transcript_optimize",
                            status="completed",
                            message=str(correction.message or "Transcript optimization completed."),
                            progress=_PROGRESS_TRANSCRIPT_DONE,
                        )
                    except Exception as correction_exc:  # noqa: BLE001
                        await self._d_substage_complete(
                            task_id,
                            "transcript_optimize",
                            status="failed",
                            message=f"{type(correction_exc).__name__}: {correction_exc}",
                            progress=_PROGRESS_TRANSCRIPT_DONE,
                        )
                        raise

                summary_source_text = correction.summary_input_text
                if correction.mode == "strict" and not correction.fallback_used:
                    transcript_text = correction.transcript_text
                    all_segments = correction.segments
                    await self._update_task(
                        task_id,
                        transcript_text=transcript_text,
                        transcript_segments_json=orjson.dumps(all_segments).decode("utf-8"),
                        stage_logs_json=_encode_stage_logs(stage_logs),
                    )
                await self._emit_log(task_id, "D", correction.message, stage_logs)
                if not preview_streamed:
                    if correction.mode == "strict" and correction.segments:
                        for segment in correction.segments:
                            text = str(segment.get("text", "")).strip()
                            if not text:
                                continue
                            await self._append_transcript_optimized_preview(
                                task_id,
                                text,
                                stream_mode="compat",
                                start=_to_float(segment.get("start")),
                                end=_to_float(segment.get("end")),
                            )
                    else:
                        await self._append_transcript_optimized_preview(task_id, summary_source_text, stream_mode="compat")
                await self._complete_transcript_optimized_preview(task_id)
                await self._persist_transcript_optimization_artifacts(
                    task_id=task_id,
                    correction_mode=correction.mode,
                    fallback_used=correction.fallback_used,
                    summary_source_text=summary_source_text,
                    optimized_segments=correction.segments,
                    chunk_windows=self._build_audio_chunk_windows(audio_chunks),
                )

                await self._update_task(
                    task_id,
                    progress=_PROGRESS_TRANSCRIPT_DONE,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._d_substage_start(task_id, "fusion_delivery", progress=_PROGRESS_FUSION_START)
                await self._emit_log(
                    task_id,
                    "D",
                    "Generating detailed notes and mindmap in parallel...",
                    stage_logs,
                    substage="fusion_delivery",
                )

                try:
                    async def summary_delta(delta: str, stream_mode: str) -> None:
                        await self._event_bus.publish(
                            task_id,
                            {"type": "summary_delta", "stage": "D", "text": delta, "stream_mode": stream_mode},
                        )

                    async def mindmap_delta(delta: str, stream_mode: str) -> None:
                        await self._event_bus.publish(
                            task_id,
                            {"type": "mindmap_delta", "stage": "D", "text": delta, "stream_mode": stream_mode},
                        )

                    async def publish_fusion_prompt_preview(markdown: str) -> None:
                        await self._publish_fusion_prompt_preview(task_id, markdown)

                    if llm_requires_runtime_lock:
                        async with self._model_runtime_manager.reserve(
                            task_id=task_id,
                            stage="D",
                            component="llm",
                            model_id=f"llm:{llm_model_id}",
                        ) as llm_generate_lease:
                            self._record_runtime_lease(task_id, "D", llm_generate_lease.wait_seconds)
                            if llm_generate_lease.wait_seconds > 0:
                                await self._emit_log(
                                    task_id,
                                    "D",
                                    f"Waiting for model runtime lock: {llm_generate_lease.wait_seconds:.2f}s",
                                    stage_logs,
                                    substage="runtime",
                                )
                            bundle = await self._summarizer.generate(
                                title=ingestion_result.title,
                                transcript_text=summary_source_text,
                                on_summary_delta=summary_delta,
                                on_mindmap_delta=mindmap_delta,
                                on_fusion_prompt_preview=publish_fusion_prompt_preview,
                                llm_config_override=llm_runtime_config,
                            )
                    else:
                        bundle = await self._summarizer.generate(
                            title=ingestion_result.title,
                            transcript_text=summary_source_text,
                            on_summary_delta=summary_delta,
                            on_mindmap_delta=mindmap_delta,
                            on_fusion_prompt_preview=publish_fusion_prompt_preview,
                            llm_config_override=llm_runtime_config,
                        )
                    await self._persist_delivery_artifacts(
                        task_id,
                        bundle.summary_markdown,
                        bundle.notes_markdown,
                        bundle.mindmap_markdown,
                        bundle.notes_image_assets,
                    )
                    await self._d_substage_complete(
                        task_id,
                        "fusion_delivery",
                        status="completed",
                        message="详细笔记与导图生成完成。",
                        progress=_PROGRESS_FUSION_DONE,
                    )
                except Exception as generate_exc:  # noqa: BLE001
                    await self._d_substage_complete(
                        task_id,
                        "fusion_delivery",
                        status="failed",
                        message=f"{type(generate_exc).__name__}: {generate_exc}",
                        progress=_PROGRESS_FUSION_DONE,
                    )
                    raise

                await self._emit_log(task_id, "D", "Detailed notes and mindmap persisted to local storage", stage_logs)
                artifact_index_json, artifact_total_bytes = build_task_artifact_index(
                    task_id=task_id,
                    transcript_text=transcript_text,
                    transcript_segments_json=orjson.dumps(all_segments).decode("utf-8"),
                    summary_markdown=bundle.summary_markdown,
                    notes_markdown=bundle.notes_markdown,
                    mindmap_markdown=bundle.mindmap_markdown,
                )
                await self._update_task(
                    task_id,
                    status=TaskStatus.COMPLETED.value,
                    progress=_PROGRESS_TASK_DONE,
                    summary_markdown=bundle.summary_markdown,
                    mindmap_markdown=bundle.mindmap_markdown,
                    notes_markdown=bundle.notes_markdown,
                    artifact_index_json=artifact_index_json,
                    artifact_total_bytes=artifact_total_bytes,
                    language=selected_language,
                    model_size=selected_model,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._stage_complete(task_id, "D", progress=_PROGRESS_TASK_DONE, stage_logs=stage_logs)
                await self._event_bus.publish(task_id, {"type": "task_complete", "overall_progress": _PROGRESS_TASK_DONE})
            except asyncio.CancelledError:
                pause_requested = self._consume_pause_request(task_id)
                interruption_message = "Task paused by user." if pause_requested else "Task cancelled by user."
                await self._emit_log(task_id, active_stage, "Task paused" if pause_requested else "Task cancelled", stage_logs)
                if pause_requested:
                    self._mark_stage_paused(task_id, active_stage, interruption_message)
                else:
                    self._mark_stage_failed(task_id, active_stage, interruption_message)
                await self._persist_stage_metric(task_id, active_stage)
                await self._persist_analysis_result(
                    task_id,
                    active_stage,
                    status="paused" if pause_requested else "cancelled",
                    progress=100,
                    reason=interruption_message,
                )
                await self._update_task(
                    task_id,
                    status=TaskStatus.PAUSED.value if pause_requested else TaskStatus.CANCELLED.value,
                    error_message=interruption_message,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._event_bus.publish(
                    task_id,
                    {"type": "task_paused" if pause_requested else "task_cancelled", "error": interruption_message},
                )
                raise
            except Exception as exc:  # noqa: BLE001
                await self._emit_log(task_id, active_stage, f"Task failed: {type(exc).__name__}: {exc}", stage_logs)
                reason = f"{type(exc).__name__}: {exc}"
                self._mark_stage_failed(task_id, active_stage, reason)
                await self._persist_stage_metric(task_id, active_stage)
                await self._persist_analysis_result(
                    task_id,
                    active_stage,
                    status="failed",
                    progress=100,
                    reason=reason,
                )
                await self._update_task(
                    task_id,
                    status=TaskStatus.FAILED.value,
                    progress=100,
                    error_message=reason,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._event_bus.publish(
                    task_id,
                    {"type": "task_failed", "error": reason},
                )
            finally:
                mode_semaphore.release()
                await asyncio.to_thread(shutil.rmtree, media_dir, True)
                self._task_stage_started.pop(task_id, None)
                self._task_stage_metrics.pop(task_id, None)

    async def _run_stage_d_retry(self, task_id: str) -> None:
        async with self._semaphore:
            media_dir = Path(self._settings.temp_dir) / task_id / "retry-stage-d"
            media_dir.mkdir(parents=True, exist_ok=True)
            stage_logs = _empty_stage_logs()
            stage_metrics = _empty_stage_metrics()
            active_stage: StageType = "D"
            event_loop = asyncio.get_running_loop()
            whisper_config = await self._runtime_config_store.get_whisper()
            llm_runtime_config = await self._llm_config_store.get()
            execution_mode = _resolve_execution_mode(llm_runtime_config=llm_runtime_config)
            mode_semaphore = self._select_mode_semaphore(execution_mode)
            mode_wait_started_at = event_loop.time()
            await mode_semaphore.acquire()
            mode_wait_seconds = max(0.0, event_loop.time() - mode_wait_started_at)

            try:
                record = await asyncio.to_thread(self._task_store.get, task_id)
                if record is None:
                    raise ValueError(f"Task not found: {task_id}")
                stage_logs = _decode_stage_logs(record.stage_logs_json)
                stage_metrics = _decode_stage_metrics(record.stage_metrics_json)
                stage_logs["D"] = []
                stage_metrics["D"] = _empty_stage_metrics()["D"]
                self._task_stage_started[task_id] = {}
                self._task_stage_metrics[task_id] = stage_metrics
                transcript_segments = _decode_transcript_segments(record.transcript_segments_json)
                transcript_text = (record.transcript_text or "").strip() or _join_transcript_segment_texts(transcript_segments)
                if not transcript_text:
                    raise ValueError("Task has no persisted transcript artifacts for stage-D rerun.")

                task_title = str(record.title or "").strip() or str(record.source_input or "").strip() or f"Task-{task_id}"

                runtime_warnings: list[str] = []
                whisper_guard = self._resource_guard.guard_whisper_config(whisper_config)
                if whisper_guard["rollback_applied"]:
                    whisper_config = whisper_guard["config"]  # type: ignore[assignment]
                runtime_warnings.extend(whisper_guard["warnings"])
                llm_guard = self._resource_guard.guard_llm_config(llm_runtime_config)
                if llm_guard["rollback_applied"]:
                    llm_runtime_config = llm_guard["config"]  # type: ignore[assignment]
                runtime_warnings.extend(llm_guard["warnings"])
                runtime_warnings.extend(self._resource_guard.ensure_runtime_capacity(whisper=whisper_config, llm=llm_runtime_config))

                await self._stage_start(
                    task_id,
                    "D",
                    "Detailed Notes and Mindmap Generation (Retry)",
                    stage_logs=stage_logs,
                    status=TaskStatus.SUMMARIZING.value,
                    progress=_PROGRESS_STAGE_D_START,
                )
                self._set_stage_metric_values(
                    task_id,
                    "D",
                    {
                        "scheduler_mode": execution_mode,
                        "scheduler_wait_seconds": round(mode_wait_seconds, 2),
                        "retry_stage_d": True,
                    },
                )
                if mode_wait_seconds > 0:
                    await self._emit_log(
                        task_id,
                        "D",
                        f"Waiting for {execution_mode} execution slot: {mode_wait_seconds:.2f}s",
                        stage_logs,
                        substage="scheduler",
                    )
                await self._task_preflight_service.assert_ready_for_analysis(
                    workflow="notes",
                    stage="stage_d_retry",
                )
                for warning in runtime_warnings:
                    await self._emit_runtime_warning(
                        task_id,
                        "D",
                        warning,
                        stage_logs,
                        code=_RESOURCE_GUARD_WARNING_CODE,
                        component="resource_guard",
                        action=_RESOURCE_GUARD_WARNING_ACTION,
                        substage="resource",
                    )

                llm_model_id = str(llm_runtime_config.get("model", self._settings.llm_model)).strip() or self._settings.llm_model
                llm_requires_runtime_lock = _llm_requires_runtime_lock(llm_runtime_config)
                correction_mode = str(llm_runtime_config.get("correction_mode", "strict")).strip().lower()
                correction = None
                preview_streamed = False
                await self._reset_transcript_optimized_preview(task_id)

                async def emit_correction_preview(delta: str, stream_mode: str) -> None:
                    nonlocal preview_streamed
                    if not delta:
                        return
                    preview_streamed = True
                    await self._append_transcript_optimized_preview(task_id, delta, stream_mode=stream_mode)

                async def emit_correction_preview_segment(segment: dict[str, float | str], stream_mode: str) -> None:
                    nonlocal preview_streamed
                    text = str(segment.get("text", "")).strip()
                    if not text:
                        return
                    preview_streamed = True
                    await self._append_transcript_optimized_preview(
                        task_id,
                        text,
                        stream_mode=stream_mode,
                        start=_to_float(segment.get("start")),
                        end=_to_float(segment.get("end")),
                    )

                if correction_mode == "off":
                    await self._emit_log(
                        task_id,
                        "D",
                        "Transcript optimization skipped because correction mode is off.",
                        stage_logs,
                        substage="transcript_optimize",
                    )
                    await self._d_substage_complete(
                        task_id,
                        "transcript_optimize",
                        status="skipped",
                        message="Correction mode is off.",
                        progress=_PROGRESS_TRANSCRIPT_DONE,
                    )
                    correction = await self._summarizer.correct_transcript(
                        title=task_title,
                        transcript_text=transcript_text,
                        segments=transcript_segments,
                        llm_config_override=llm_runtime_config,
                        on_preview_delta=emit_correction_preview,
                        on_preview_segment=emit_correction_preview_segment,
                    )
                else:
                    await self._d_substage_start(task_id, "transcript_optimize", progress=_PROGRESS_STAGE_D_START)
                    await self._emit_log(
                        task_id,
                        "D",
                        "Running transcript correction strategy...",
                        stage_logs,
                        substage="transcript_optimize",
                    )
                    try:
                        if llm_requires_runtime_lock:
                            async with self._model_runtime_manager.reserve(
                                task_id=task_id,
                                stage="D",
                                component="llm",
                                model_id=f"llm:{llm_model_id}",
                            ) as llm_correction_lease:
                                self._record_runtime_lease(task_id, "D", llm_correction_lease.wait_seconds)
                                if llm_correction_lease.wait_seconds > 0:
                                    await self._emit_log(
                                        task_id,
                                        "D",
                                        f"Waiting for model runtime lock: {llm_correction_lease.wait_seconds:.2f}s",
                                        stage_logs,
                                        substage="runtime",
                                    )
                                correction = await self._summarizer.correct_transcript(
                                    title=task_title,
                                    transcript_text=transcript_text,
                                    segments=transcript_segments,
                                    llm_config_override=llm_runtime_config,
                                    on_preview_delta=emit_correction_preview,
                                    on_preview_segment=emit_correction_preview_segment,
                                )
                        else:
                            correction = await self._summarizer.correct_transcript(
                                title=task_title,
                                transcript_text=transcript_text,
                                segments=transcript_segments,
                                llm_config_override=llm_runtime_config,
                                on_preview_delta=emit_correction_preview,
                                on_preview_segment=emit_correction_preview_segment,
                            )
                        await self._d_substage_complete(
                            task_id,
                            "transcript_optimize",
                            status="completed",
                            message=str(correction.message or "Transcript optimization completed."),
                            progress=_PROGRESS_TRANSCRIPT_DONE,
                        )
                    except Exception as correction_exc:  # noqa: BLE001
                        await self._d_substage_complete(
                            task_id,
                            "transcript_optimize",
                            status="failed",
                            message=f"{type(correction_exc).__name__}: {correction_exc}",
                            progress=_PROGRESS_TRANSCRIPT_DONE,
                        )
                        raise

                summary_source_text = correction.summary_input_text
                if correction.mode == "strict" and not correction.fallback_used:
                    transcript_text = correction.transcript_text
                    transcript_segments = correction.segments
                await self._update_task(
                    task_id,
                    transcript_text=transcript_text,
                    transcript_segments_json=orjson.dumps(transcript_segments).decode("utf-8"),
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._emit_log(task_id, "D", correction.message, stage_logs, substage="transcript_optimize")
                if not preview_streamed:
                    if correction.mode == "strict" and correction.segments:
                        for segment in correction.segments:
                            text = str(segment.get("text", "")).strip()
                            if not text:
                                continue
                            await self._append_transcript_optimized_preview(
                                task_id,
                                text,
                                stream_mode="compat",
                                start=_to_float(segment.get("start")),
                                end=_to_float(segment.get("end")),
                            )
                    else:
                        await self._append_transcript_optimized_preview(task_id, summary_source_text, stream_mode="compat")
                await self._complete_transcript_optimized_preview(task_id)
                await self._persist_transcript_optimization_artifacts(
                    task_id=task_id,
                    correction_mode=correction.mode,
                    fallback_used=correction.fallback_used,
                    summary_source_text=summary_source_text,
                    optimized_segments=correction.segments,
                    chunk_windows=self._load_audio_chunk_windows_for_task(
                        task_id=task_id,
                        transcript_segments=transcript_segments,
                    ),
                )

                await self._update_task(
                    task_id,
                    progress=_PROGRESS_TRANSCRIPT_DONE,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )

                await self._d_substage_start(task_id, "fusion_delivery", progress=_PROGRESS_FUSION_START)
                await self._emit_log(task_id, "D", "Generating detailed notes and mindmap in parallel...", stage_logs, substage="fusion_delivery")
                try:
                    async def summary_delta(delta: str, stream_mode: str) -> None:
                        await self._event_bus.publish(
                            task_id,
                            {"type": "summary_delta", "stage": "D", "text": delta, "stream_mode": stream_mode},
                        )

                    async def mindmap_delta(delta: str, stream_mode: str) -> None:
                        await self._event_bus.publish(
                            task_id,
                            {"type": "mindmap_delta", "stage": "D", "text": delta, "stream_mode": stream_mode},
                        )

                    async def publish_fusion_prompt_preview(markdown: str) -> None:
                        await self._publish_fusion_prompt_preview(task_id, markdown)

                    if llm_requires_runtime_lock:
                        async with self._model_runtime_manager.reserve(
                            task_id=task_id,
                            stage="D",
                            component="llm",
                            model_id=f"llm:{llm_model_id}",
                        ) as llm_generate_lease:
                            self._record_runtime_lease(task_id, "D", llm_generate_lease.wait_seconds)
                            if llm_generate_lease.wait_seconds > 0:
                                await self._emit_log(
                                    task_id,
                                    "D",
                                    f"Waiting for model runtime lock: {llm_generate_lease.wait_seconds:.2f}s",
                                    stage_logs,
                                    substage="runtime",
                                )
                            bundle = await self._summarizer.generate(
                                title=task_title,
                                transcript_text=summary_source_text,
                                on_summary_delta=summary_delta,
                                on_mindmap_delta=mindmap_delta,
                                on_fusion_prompt_preview=publish_fusion_prompt_preview,
                                llm_config_override=llm_runtime_config,
                            )
                    else:
                        bundle = await self._summarizer.generate(
                            title=task_title,
                            transcript_text=summary_source_text,
                            on_summary_delta=summary_delta,
                            on_mindmap_delta=mindmap_delta,
                            on_fusion_prompt_preview=publish_fusion_prompt_preview,
                            llm_config_override=llm_runtime_config,
                        )
                    await self._persist_delivery_artifacts(
                        task_id,
                        bundle.summary_markdown,
                        bundle.notes_markdown,
                        bundle.mindmap_markdown,
                        bundle.notes_image_assets,
                    )
                    await self._d_substage_complete(task_id, "fusion_delivery", status="completed", message="详细笔记与导图生成完成。", progress=_PROGRESS_FUSION_DONE)
                except Exception as generate_exc:  # noqa: BLE001
                    await self._d_substage_complete(task_id, "fusion_delivery", status="failed", message=f"{type(generate_exc).__name__}: {generate_exc}", progress=_PROGRESS_FUSION_DONE)
                    raise

                artifact_index_json, artifact_total_bytes = build_task_artifact_index(
                    task_id=task_id,
                    transcript_text=transcript_text,
                    transcript_segments_json=orjson.dumps(transcript_segments).decode("utf-8"),
                    summary_markdown=bundle.summary_markdown,
                    notes_markdown=bundle.notes_markdown,
                    mindmap_markdown=bundle.mindmap_markdown,
                )
                await self._update_task(
                    task_id,
                    status=TaskStatus.COMPLETED.value,
                    progress=_PROGRESS_TASK_DONE,
                    error_message=None,
                    summary_markdown=bundle.summary_markdown,
                    mindmap_markdown=bundle.mindmap_markdown,
                    notes_markdown=bundle.notes_markdown,
                    artifact_index_json=artifact_index_json,
                    artifact_total_bytes=artifact_total_bytes,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._stage_complete(task_id, "D", progress=_PROGRESS_TASK_DONE, stage_logs=stage_logs)
                await self._event_bus.publish(task_id, {"type": "task_complete", "overall_progress": _PROGRESS_TASK_DONE})
            except asyncio.CancelledError:
                pause_requested = self._consume_pause_request(task_id)
                interruption_message = "Task paused by user." if pause_requested else "Task cancelled by user."
                await self._emit_log(task_id, active_stage, "Task paused" if pause_requested else "Task cancelled", stage_logs)
                if pause_requested:
                    self._mark_stage_paused(task_id, active_stage, interruption_message)
                else:
                    self._mark_stage_failed(task_id, active_stage, interruption_message)
                await self._persist_stage_metric(task_id, active_stage)
                await self._persist_analysis_result(
                    task_id,
                    active_stage,
                    status="paused" if pause_requested else "cancelled",
                    progress=100,
                    reason=interruption_message,
                )
                await self._update_task(
                    task_id,
                    status=TaskStatus.PAUSED.value if pause_requested else TaskStatus.CANCELLED.value,
                    error_message=interruption_message,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._event_bus.publish(
                    task_id,
                    {"type": "task_paused" if pause_requested else "task_cancelled", "error": interruption_message},
                )
                raise
            except Exception as exc:  # noqa: BLE001
                await self._emit_log(task_id, active_stage, f"Task failed: {type(exc).__name__}: {exc}", stage_logs)
                reason = f"{type(exc).__name__}: {exc}"
                self._mark_stage_failed(task_id, active_stage, reason)
                await self._persist_stage_metric(task_id, active_stage)
                await self._persist_analysis_result(
                    task_id,
                    active_stage,
                    status="failed",
                    progress=100,
                    reason=reason,
                )
                await self._update_task(
                    task_id,
                    status=TaskStatus.FAILED.value,
                    progress=100,
                    error_message=reason,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._event_bus.publish(task_id, {"type": "task_failed", "error": reason})
            finally:
                mode_semaphore.release()
                await asyncio.to_thread(shutil.rmtree, media_dir, True)
                self._task_stage_started.pop(task_id, None)
                self._task_stage_metrics.pop(task_id, None)

    def _ingest_source(self, submission: TaskSubmission, media_dir: Path) -> IngestionResult:
        if submission.source_type == "bilibili":
            return download_bilibili_video(submission.task_id, submission.source_input, media_dir)

        if not submission.source_local_path:
            raise ValueError("Missing local file path for local source")
        local_path = Path(submission.source_local_path)
        if not local_path.exists():
            raise FileNotFoundError(f"Local source missing: {local_path}")
        return prepare_local_video(submission.task_id, local_path, media_dir)

    async def _stage_start(
        self,
        task_id: str,
        stage: StageType,
        title: str,
        stage_logs: dict[str, list[str]],
        status: str | None = None,
        progress: int | None = None,
    ) -> None:
        payload: dict[str, str | int] = {"type": "stage_start", "stage": stage, "title": title}
        if progress is not None:
            payload["overall_progress"] = progress
        if status:
            payload["status"] = status
        await self._event_bus.publish(task_id, payload)
        self._task_stage_started.setdefault(task_id, {})[stage] = asyncio.get_running_loop().time()
        self._mark_stage_started(task_id, stage)
        await self._emit_log(task_id, stage, f"Stage {stage} started: {title}", stage_logs)
        fields: dict[str, str | int] = {"stage_logs_json": _encode_stage_logs(stage_logs)}
        if status:
            fields["status"] = status
        if progress is not None:
            fields["progress"] = progress
        await self._update_task(task_id, **fields)

    async def _stage_complete(
        self,
        task_id: str,
        stage: StageType,
        progress: int,
        stage_logs: dict[str, list[str]],
    ) -> None:
        await self._event_bus.publish(
            task_id,
            {"type": "stage_complete", "stage": stage, "overall_progress": progress, "stage_progress": 100},
        )
        await self._event_bus.publish(
            task_id,
            {"type": "progress", "stage": stage, "overall_progress": progress, "stage_progress": 100},
        )
        self._mark_stage_completed(task_id, stage)
        await self._persist_stage_metric(task_id, stage)
        await self._persist_analysis_result(task_id, stage, status="completed", progress=progress)
        await self._emit_log(task_id, stage, f"Stage {stage} completed", stage_logs)
        await self._update_task(task_id, progress=progress, stage_logs_json=_encode_stage_logs(stage_logs))

    async def _d_substage_start(
        self,
        task_id: str,
        substage: DSubstageType,
        *,
        progress: int | None = None,
    ) -> None:
        self._mark_d_substage_started(task_id, substage)
        payload: dict[str, object] = {
            "type": "substage_start",
            "stage": "D",
            "substage": substage,
            "title": _D_SUBSTAGE_TITLES[substage],
            "status": "running",
        }
        if progress is not None:
            payload["overall_progress"] = max(0, min(100, int(progress)))
        await self._event_bus.publish(task_id, payload)
        await self._persist_stage_metric(task_id, "D")

    async def _d_substage_complete(
        self,
        task_id: str,
        substage: DSubstageType,
        *,
        status: Literal["completed", "skipped", "failed"] = "completed",
        message: str = "",
        progress: int | None = None,
    ) -> None:
        if status == "completed":
            self._mark_d_substage_completed(task_id, substage)
        elif status == "skipped":
            self._mark_d_substage_skipped(task_id, substage, message)
        else:
            self._mark_d_substage_failed(task_id, substage, message)
        payload: dict[str, object] = {
            "type": "substage_complete",
            "stage": "D",
            "substage": substage,
            "title": _D_SUBSTAGE_TITLES[substage],
            "status": status,
            "message": message,
        }
        if progress is not None:
            payload["overall_progress"] = max(0, min(100, int(progress)))
        await self._event_bus.publish(task_id, payload)
        await asyncio.to_thread(
            self._task_store.upsert_analysis_result,
            task_id,
            f"D:{substage}",
            {
                "stage": "D",
                "substage": substage,
                "status": status,
                "message": message,
                "progress": progress,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await self._persist_stage_artifact_json(
            task_id,
            "D",
            f"substage/{substage}.json",
            {
                "task_id": task_id,
                "stage": "D",
                "substage": substage,
                "status": status,
                "message": message,
                "progress": progress,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await self._persist_stage_metric(task_id, "D")

    async def _emit_log(
        self,
        task_id: str,
        stage: StageType,
        message: str,
        stage_logs: dict[str, list[str]],
        substage: str | None = None,
    ) -> None:
        elapsed_seconds = self._stage_elapsed_seconds(task_id, stage)
        payload: dict[str, str | float] = {"type": "log", "stage": stage, "message": message}
        if substage:
            payload["substage"] = substage
        if elapsed_seconds is not None:
            payload["elapsed_seconds"] = round(elapsed_seconds, 2)
        await self._event_bus.publish(task_id, payload)
        stage_bucket = stage_logs.setdefault(stage, [])
        stage_bucket.append(_format_stage_log_line(message, substage=substage, elapsed_seconds=elapsed_seconds))
        stage_logs[stage] = stage_bucket[-1000:]
        self._increment_stage_log_count(task_id, stage)

    async def _emit_runtime_warning(
        self,
        task_id: str,
        stage: StageType,
        message: str,
        stage_logs: dict[str, list[str]],
        *,
        code: str,
        component: str,
        action: str,
        substage: str | None = None,
    ) -> None:
        await self._emit_log(task_id, stage, message, stage_logs, substage=substage)
        payload: dict[str, str | float] = {
            "type": "runtime_warning",
            "stage": stage,
            "message": message,
            "code": code,
            "component": component,
            "action": action,
        }
        if substage:
            payload["substage"] = substage
        elapsed_seconds = self._stage_elapsed_seconds(task_id, stage)
        if elapsed_seconds is not None:
            payload["elapsed_seconds"] = round(elapsed_seconds, 2)
        await self._event_bus.publish(task_id, payload)
        await self._persist_runtime_warning(
            task_id=task_id,
            stage=stage,
            code=code,
            component=component,
            action=action,
            substage=substage,
            message=message,
            elapsed_seconds=elapsed_seconds,
        )

    def _stage_elapsed_seconds(self, task_id: str, stage: StageType) -> float | None:
        stage_started = self._task_stage_started.get(task_id, {}).get(stage)
        if stage_started is None:
            return None
        return max(0.0, asyncio.get_running_loop().time() - stage_started)

    def _mark_stage_started(self, task_id: str, stage: StageType) -> None:
        stage_entry = self._ensure_task_stage_metric_entry(task_id, stage)
        now_iso = datetime.now(timezone.utc).isoformat()
        stage_entry["status"] = "running"
        stage_entry["started_at"] = now_iso
        stage_entry["completed_at"] = None
        stage_entry["elapsed_seconds"] = None
        stage_entry["reason"] = None

    def _mark_stage_completed(self, task_id: str, stage: StageType) -> None:
        stage_entry = self._ensure_task_stage_metric_entry(task_id, stage)
        now_iso = datetime.now(timezone.utc).isoformat()
        stage_entry["status"] = "completed"
        stage_entry["completed_at"] = now_iso
        elapsed_seconds = self._stage_elapsed_seconds(task_id, stage)
        stage_entry["elapsed_seconds"] = round(elapsed_seconds, 2) if elapsed_seconds is not None else None
        stage_entry["reason"] = None

    def _mark_stage_failed(self, task_id: str, stage: StageType, reason: str) -> None:
        stage_entry = self._ensure_task_stage_metric_entry(task_id, stage)
        now_iso = datetime.now(timezone.utc).isoformat()
        stage_entry["status"] = "failed"
        stage_entry["completed_at"] = now_iso
        elapsed_seconds = self._stage_elapsed_seconds(task_id, stage)
        stage_entry["elapsed_seconds"] = round(elapsed_seconds, 2) if elapsed_seconds is not None else None
        stage_entry["reason"] = reason

    def _mark_stage_paused(self, task_id: str, stage: StageType, reason: str) -> None:
        stage_entry = self._ensure_task_stage_metric_entry(task_id, stage)
        now_iso = datetime.now(timezone.utc).isoformat()
        stage_entry["status"] = "paused"
        stage_entry["completed_at"] = now_iso
        elapsed_seconds = self._stage_elapsed_seconds(task_id, stage)
        stage_entry["elapsed_seconds"] = round(elapsed_seconds, 2) if elapsed_seconds is not None else None
        stage_entry["reason"] = reason

    def _ensure_d_substage_metric_entry(self, task_id: str, substage: DSubstageType) -> dict[str, object]:
        stage_entry = self._ensure_task_stage_metric_entry(task_id, "D")
        raw_metrics = stage_entry.setdefault("substage_metrics", {})
        if not isinstance(raw_metrics, dict):
            raw_metrics = {}
            stage_entry["substage_metrics"] = raw_metrics
        metric = raw_metrics.get(substage)
        if not isinstance(metric, dict):
            metric = {
                "title": _D_SUBSTAGE_TITLES[substage],
                "status": "pending",
                "started_at": None,
                "completed_at": None,
                "elapsed_seconds": None,
                "optional": substage in {"transcript_optimize"},
            }
            raw_metrics[substage] = metric
        return metric

    def _mark_d_substage_started(self, task_id: str, substage: DSubstageType) -> None:
        metric = self._ensure_d_substage_metric_entry(task_id, substage)
        metric["status"] = "running"
        metric["started_at"] = datetime.now(timezone.utc).isoformat()
        metric["completed_at"] = None
        metric["elapsed_seconds"] = None

    def _mark_d_substage_completed(self, task_id: str, substage: DSubstageType) -> None:
        metric = self._ensure_d_substage_metric_entry(task_id, substage)
        started_at = str(metric.get("started_at", "") or "").strip()
        started_seconds: float | None = None
        if started_at:
            try:
                started_seconds = datetime.fromisoformat(started_at).timestamp()
            except ValueError:
                started_seconds = None
        now_dt = datetime.now(timezone.utc)
        metric["status"] = "completed"
        metric["completed_at"] = now_dt.isoformat()
        if started_seconds is None:
            metric["elapsed_seconds"] = None
        else:
            metric["elapsed_seconds"] = round(max(0.0, now_dt.timestamp() - started_seconds), 2)

    def _mark_d_substage_skipped(self, task_id: str, substage: DSubstageType, reason: str = "") -> None:
        metric = self._ensure_d_substage_metric_entry(task_id, substage)
        now_iso = datetime.now(timezone.utc).isoformat()
        metric["status"] = "skipped"
        metric["started_at"] = now_iso
        metric["completed_at"] = now_iso
        metric["elapsed_seconds"] = 0.0
        if reason:
            metric["reason"] = reason

    def _mark_d_substage_failed(self, task_id: str, substage: DSubstageType, reason: str) -> None:
        metric = self._ensure_d_substage_metric_entry(task_id, substage)
        now_iso = datetime.now(timezone.utc).isoformat()
        metric["status"] = "failed"
        metric["completed_at"] = now_iso
        if reason:
            metric["reason"] = reason

    def _increment_stage_log_count(self, task_id: str, stage: StageType) -> None:
        stage_entry = self._ensure_task_stage_metric_entry(task_id, stage)
        current = int(stage_entry.get("log_count", 0))
        stage_entry["log_count"] = current + 1

    def _set_stage_metric_values(self, task_id: str, stage: StageType, values: dict[str, object]) -> None:
        stage_entry = self._ensure_task_stage_metric_entry(task_id, stage)
        stage_entry.update(values)

    def _record_runtime_lease(self, task_id: str, stage: StageType, wait_seconds: float) -> None:
        stage_entry = self._ensure_task_stage_metric_entry(task_id, stage)
        current_wait = float(stage_entry.get("runtime_wait_seconds", 0.0) or 0.0)
        stage_entry["runtime_wait_seconds"] = round(max(0.0, current_wait + max(0.0, wait_seconds)), 2)
        current_lock_count = int(stage_entry.get("runtime_lock_count", 0) or 0)
        stage_entry["runtime_lock_count"] = current_lock_count + 1

    async def _run_whisper_stage_worker(
        self,
        *,
        task_id: str,
        stage_logs: dict[str, list[str]],
        audio_chunks: list[AudioChunk],
        transcript_chunks_by_index: dict[int, list[dict[str, float | str]]],
        selected_model: str,
        selected_language: str,
        whisper_config: dict[str, object],
    ) -> None:
        pending_chunks = [
            (chunk_index, chunk)
            for chunk_index, chunk in enumerate(audio_chunks)
            if chunk_index not in transcript_chunks_by_index
        ]
        if not pending_chunks:
            return

        total_chunks = max(1, len(audio_chunks))
        last_overall_progress = -1

        async def on_worker_event(event: dict[str, object]) -> None:
            nonlocal last_overall_progress
            event_type = str(event.get("type", "") or "").strip().lower()

            if event_type == "chunk_start":
                chunk_index = int(event.get("chunk_index", 0) or 0)
                chunk = audio_chunks[chunk_index]
                await self._emit_log(
                    task_id,
                    "C",
                    f"Transcribing chunk {chunk_index + 1}/{total_chunks}: {chunk.path.name}",
                    stage_logs,
                )
                return

            if event_type == "segment":
                chunk_index = int(event.get("chunk_index", 0) or 0)
                if chunk_index < 0 or chunk_index >= len(audio_chunks):
                    return
                chunk = audio_chunks[chunk_index]
                raw_segment = event.get("segment")
                if not isinstance(raw_segment, dict):
                    return
                segment = {
                    "start": round(_to_float(raw_segment.get("start")), 2),
                    "end": round(max(_to_float(raw_segment.get("start")), _to_float(raw_segment.get("end"))), 2),
                    "text": str(raw_segment.get("text", "") or "").strip(),
                }
                if not str(segment["text"]).strip():
                    return
                await self._event_bus.publish(task_id, {"type": "transcript_delta", "stage": "C", **segment})
                relative_end = max(0.0, _to_float(segment["end"]) - chunk.start_seconds)
                progress_ratio = (
                    (chunk_index + min(relative_end / max(chunk.duration_seconds, 1.0), 1.0))
                    / total_chunks
                )
                overall_progress = _interpolate_progress(
                    _PROGRESS_STAGE_C_START,
                    _PROGRESS_STAGE_C_DONE,
                    progress_ratio,
                )
                if overall_progress != last_overall_progress:
                    last_overall_progress = overall_progress
                    await self._event_bus.publish(
                        task_id,
                        {
                            "type": "progress",
                            "stage": "C",
                            "stage_progress": max(0, min(100, int(progress_ratio * 100))),
                            "overall_progress": max(
                                _PROGRESS_STAGE_C_START,
                                min(_PROGRESS_STAGE_C_DONE, overall_progress),
                            ),
                        },
                    )
                return

            if event_type != "chunk_complete":
                return

            chunk_index = int(event.get("chunk_index", 0) or 0)
            if chunk_index < 0 or chunk_index >= len(audio_chunks):
                return
            chunk = audio_chunks[chunk_index]
            segments = _normalize_transcript_segments_payload(event.get("segments"))
            transcript_chunks_by_index[chunk_index] = segments
            await self._persist_stage_artifact_chunk_json(
                task_id,
                "C",
                "transcript",
                chunk_index,
                {
                    "task_id": task_id,
                    "chunk_index": chunk_index + 1,
                    "chunk_total": total_chunks,
                    "file_name": chunk.path.name,
                    "start_seconds": round(chunk.start_seconds, 2),
                    "duration_seconds": round(chunk.duration_seconds, 2),
                    "end_seconds": round(chunk.start_seconds + max(0.0, chunk.duration_seconds), 2),
                    "segment_count": len(segments),
                    "segments": segments,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            chunk_progress = _interpolate_progress(
                _PROGRESS_STAGE_C_START,
                _PROGRESS_STAGE_C_DONE,
                len(transcript_chunks_by_index) / total_chunks,
            )
            await self._emit_log(
                task_id,
                "C",
                f"Chunk {chunk_index + 1}/{total_chunks} transcription completed",
                stage_logs,
            )
            await self._persist_transcript_progress(
                task_id=task_id,
                stage_logs=stage_logs,
                audio_chunks=audio_chunks,
                transcript_chunks_by_index=transcript_chunks_by_index,
                progress=chunk_progress,
            )

        await self._gpu_stage_worker_client.run(
            {
                "operation": "whisper_transcribe_stage",
                "payload": {
                    "task_id": task_id,
                    "selected_model": selected_model,
                    "selected_language": selected_language,
                    "whisper_config": whisper_config,
                    "chunks": [
                        {
                            "chunk_index": chunk_index,
                            "path": str(chunk.path),
                            "file_name": chunk.path.name,
                            "start_seconds": round(chunk.start_seconds, 2),
                            "duration_seconds": round(chunk.duration_seconds, 2),
                        }
                        for chunk_index, chunk in pending_chunks
                    ],
                },
            },
            on_event=on_worker_event,
        )

    def _select_mode_semaphore(self, mode: ExecutionMode) -> asyncio.Semaphore:
        _ = mode
        return self._api_mode_semaphore

    def _ensure_task_stage_metric_entry(self, task_id: str, stage: StageType) -> dict[str, object]:
        stage_metrics = self._task_stage_metrics.setdefault(task_id, _empty_stage_metrics())
        return stage_metrics.setdefault(
            stage,
            {
                "started_at": None,
                "completed_at": None,
                "elapsed_seconds": None,
                "status": "pending",
                "reason": None,
                "log_count": 0,
                "scheduler_mode": "",
                "scheduler_wait_seconds": 0.0,
                "runtime_wait_seconds": 0.0,
                "runtime_lock_count": 0,
            },
        )

    async def _persist_stage_metric(self, task_id: str, stage: StageType) -> None:
        stage_metrics = self._task_stage_metrics.get(task_id)
        if not stage_metrics:
            return
        stage_entry = dict(stage_metrics.get(stage) or {})
        metric_payload = {
            "task_id": task_id,
            "stage": stage,
            "started_at": str(stage_entry.get("started_at") or "").strip() or None,
            "completed_at": str(stage_entry.get("completed_at") or "").strip() or None,
            "elapsed_seconds": _to_optional_float(stage_entry.get("elapsed_seconds")),
            "log_count": int(stage_entry.get("log_count", 0) or 0),
            "scheduler_mode": str(stage_entry.get("scheduler_mode", "") or ""),
            "scheduler_wait_seconds": float(stage_entry.get("scheduler_wait_seconds", 0.0) or 0.0),
            "runtime_wait_seconds": float(stage_entry.get("runtime_wait_seconds", 0.0) or 0.0),
            "runtime_lock_count": int(stage_entry.get("runtime_lock_count", 0) or 0),
            "metrics_json": orjson.dumps(stage_entry).decode("utf-8"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        def _write_stage_metric() -> None:
            self._task_store.upsert_stage_metric(task_id=task_id, stage=stage, payload=metric_payload)

        await asyncio.to_thread(_write_stage_metric)

    async def _persist_analysis_result(
        self,
        task_id: str,
        stage: StageType,
        *,
        status: str,
        progress: int,
        reason: str | None = None,
    ) -> None:
        stage_snapshot = dict(self._task_stage_metrics.get(task_id, {}).get(stage, {}))
        payload: dict[str, object] = {
            "stage": stage,
            "status": status,
            "progress": progress,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "metrics": stage_snapshot,
        }
        if reason:
            payload["reason"] = reason
        await asyncio.to_thread(self._task_store.upsert_analysis_result, task_id, stage, payload)

    async def _persist_runtime_warning(
        self,
        *,
        task_id: str,
        stage: StageType,
        code: str,
        component: str,
        action: str,
        substage: str | None,
        message: str,
        elapsed_seconds: float | None,
    ) -> None:
        payload = {
            "task_id": task_id,
            "stage": stage,
            "code": code,
            "component": component,
            "action": action,
            "substage": substage,
            "message": message,
            "elapsed_seconds": round(elapsed_seconds, 2) if elapsed_seconds is not None else None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        def _write_runtime_warning() -> None:
            self._task_store.append_runtime_warning(task_id=task_id, payload=payload)

        await asyncio.to_thread(_write_runtime_warning)

    def _load_transcript_chunk_checkpoints(
        self,
        *,
        task_id: str,
        audio_chunks: list[AudioChunk],
    ) -> dict[int, list[dict[str, float | str]]]:
        checkpoints: dict[int, list[dict[str, float | str]]] = {}
        for chunk_index, chunk in enumerate(audio_chunks):
            payload = self._stage_artifact_store.read_json(
                task_id,
                "C",
                f"transcript/chunk-{chunk_index + 1:04d}.json",
                default={},
            )
            if not isinstance(payload, dict):
                continue
            normalized_segments = _normalize_transcript_segments_payload(payload.get("segments"))
            if not normalized_segments:
                continue
            file_name = str(payload.get("file_name", "") or "").strip()
            if file_name and file_name != chunk.path.name:
                continue
            checkpoints[chunk_index] = normalized_segments
        return checkpoints

    @staticmethod
    def _flatten_transcript_chunk_segments(
        *,
        transcript_chunks_by_index: dict[int, list[dict[str, float | str]]],
        total_chunks: int,
    ) -> list[dict[str, float | str]]:
        flattened: list[dict[str, float | str]] = []
        for chunk_index in range(max(0, total_chunks)):
            flattened.extend(transcript_chunks_by_index.get(chunk_index, []))
        return flattened

    async def _persist_transcript_progress(
        self,
        *,
        task_id: str,
        stage_logs: dict[str, list[str]],
        audio_chunks: list[AudioChunk],
        transcript_chunks_by_index: dict[int, list[dict[str, float | str]]],
        progress: int,
    ) -> tuple[list[dict[str, float | str]], str]:
        total_chunks = max(1, len(audio_chunks))
        all_segments = self._flatten_transcript_chunk_segments(
            transcript_chunks_by_index=transcript_chunks_by_index,
            total_chunks=total_chunks,
        )
        transcript_text = _join_transcript_segment_texts(all_segments)
        chunk_manifest: list[dict[str, object]] = []
        for index, chunk in enumerate(audio_chunks, start=1):
            segments = transcript_chunks_by_index.get(index - 1, [])
            chunk_manifest.append(
                {
                    "index": index,
                    "file_name": chunk.path.name,
                    "start_seconds": round(chunk.start_seconds, 2),
                    "duration_seconds": round(chunk.duration_seconds, 2),
                    "end_seconds": round(chunk.start_seconds + max(0.0, chunk.duration_seconds), 2),
                    "relative_path": f"transcript/chunk-{index:04d}.json",
                    "segment_count": len(segments),
                    "completed": bool(segments),
                }
            )
        await self._persist_stage_artifact_json(
            task_id,
            "C",
            "transcript/index.json",
            {
                "task_id": task_id,
                "chunk_count": len(audio_chunks),
                "completed_chunk_count": len(transcript_chunks_by_index),
                "segment_count": len(all_segments),
                "chunks": chunk_manifest,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await self._persist_stage_artifact_text(task_id, "C", "transcript/full.txt", transcript_text)
        transcript_segments_json = orjson.dumps(all_segments).decode("utf-8")
        artifact_index_json, artifact_total_bytes = build_task_artifact_index(
            task_id=task_id,
            transcript_text=transcript_text,
            transcript_segments_json=transcript_segments_json,
            summary_markdown=None,
            notes_markdown=None,
            mindmap_markdown=None,
        )
        await self._update_task(
            task_id,
            progress=progress,
            transcript_text=transcript_text,
            transcript_segments_json=transcript_segments_json,
            artifact_index_json=artifact_index_json,
            artifact_total_bytes=artifact_total_bytes,
            stage_logs_json=_encode_stage_logs(stage_logs),
        )
        return all_segments, transcript_text

    async def _persist_stage_artifact_json(
        self,
        task_id: str,
        stage: str,
        relative_path: str,
        payload: object,
    ) -> None:
        await asyncio.to_thread(
            self._stage_artifact_store.write_json,
            task_id,
            stage,
            relative_path,
            payload,
        )

    async def _persist_stage_artifact_text(
        self,
        task_id: str,
        stage: str,
        relative_path: str,
        text: str,
    ) -> None:
        await asyncio.to_thread(
            self._stage_artifact_store.write_text,
            task_id,
            stage,
            relative_path,
            text,
        )

    async def _persist_stage_artifact_bytes(
        self,
        task_id: str,
        stage: str,
        relative_path: str,
        payload: bytes,
    ) -> None:
        await asyncio.to_thread(
            self._stage_artifact_store.write_bytes,
            task_id,
            stage,
            relative_path,
            payload,
        )

    async def _persist_stage_artifact_chunk_json(
        self,
        task_id: str,
        stage: str,
        chunk_group: str,
        chunk_index: int,
        payload: object,
    ) -> str:
        return await asyncio.to_thread(
            self._stage_artifact_store.write_chunk_json,
            task_id,
            stage,
            chunk_group,
            chunk_index,
            payload,
        )

    async def _persist_transcript_optimization_artifacts(
        self,
        *,
        task_id: str,
        correction_mode: str,
        fallback_used: bool,
        summary_source_text: str,
        optimized_segments: list[dict[str, float | str]],
        chunk_windows: list[dict[str, object]],
    ) -> None:
        normalized_segments = [
            {
                "start": round(_to_float(segment.get("start")), 2),
                "end": round(max(_to_float(segment.get("start")), _to_float(segment.get("end"))), 2),
                "text": str(segment.get("text", "")).strip(),
            }
            for segment in optimized_segments
            if isinstance(segment, dict)
        ]
        grouped_chunks = self._split_segments_by_chunk_windows(normalized_segments, chunk_windows)
        chunk_manifest: list[dict[str, object]] = []
        for chunk_index, group in enumerate(grouped_chunks):
            segments = list(group.get("segments", []))
            payload = {
                "task_id": task_id,
                "chunk_index": int(group.get("chunk_index", chunk_index + 1)),
                "chunk_total": len(grouped_chunks),
                "start_seconds": group.get("start_seconds"),
                "end_seconds": group.get("end_seconds"),
                "segment_count": len(segments),
                "segments": segments,
                "text": _join_transcript_segment_texts(segments),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            relative_path = await self._persist_stage_artifact_chunk_json(
                task_id,
                "D",
                "transcript-optimize",
                chunk_index,
                payload,
            )
            chunk_manifest.append(
                {
                    "chunk_index": payload["chunk_index"],
                    "relative_path": relative_path,
                    "segment_count": payload["segment_count"],
                    "start_seconds": payload["start_seconds"],
                    "end_seconds": payload["end_seconds"],
                }
            )
        await self._persist_stage_artifact_text(
            task_id,
            "D",
            "transcript-optimize/full.txt",
            (summary_source_text or "").strip(),
        )
        await self._persist_stage_artifact_json(
            task_id,
            "D",
            "transcript-optimize/index.json",
            {
                "task_id": task_id,
                "mode": correction_mode,
                "fallback_used": fallback_used,
                "chunk_count": len(grouped_chunks),
                "segment_count": len(normalized_segments),
                "chunks": chunk_manifest,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    async def _persist_delivery_artifacts(
        self,
        task_id: str,
        summary_markdown: str,
        notes_markdown: str,
        mindmap_markdown: str,
        notes_image_assets: list[NotesImageAsset],
    ) -> None:
        await self._persist_stage_artifact_text(task_id, "D", "fusion/summary.md", summary_markdown or "")
        await self._persist_stage_artifact_text(task_id, "D", "fusion/notes.md", notes_markdown or "")
        await self._persist_stage_artifact_text(task_id, "D", "fusion/mindmap.md", mindmap_markdown or "")
        notes_image_paths: list[str] = []
        for asset in notes_image_assets:
            relative_path = _normalize_notes_image_relative_path(asset.relative_path)
            await self._persist_stage_artifact_bytes(
                task_id,
                "D",
                f"fusion/{relative_path}",
                asset.content,
            )
            notes_image_paths.append(relative_path)
        await self._persist_stage_artifact_json(
            task_id,
            "D",
            "fusion/index.json",
            {
                "task_id": task_id,
                "summary_chars": len(summary_markdown or ""),
                "notes_chars": len(notes_markdown or ""),
                "mindmap_chars": len(mindmap_markdown or ""),
                "notes_image_count": len(notes_image_paths),
                "notes_image_paths": notes_image_paths,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    @staticmethod
    def _build_audio_chunk_windows(audio_chunks: list[AudioChunk]) -> list[dict[str, object]]:
        windows: list[dict[str, object]] = []
        for index, chunk in enumerate(audio_chunks, start=1):
            start_seconds = round(max(0.0, float(chunk.start_seconds)), 2)
            end_seconds = round(start_seconds + max(0.0, float(chunk.duration_seconds)), 2)
            windows.append(
                {
                    "chunk_index": index,
                    "start_seconds": start_seconds,
                    "end_seconds": end_seconds,
                }
            )
        return windows

    def _load_audio_chunk_windows_for_task(
        self,
        *,
        task_id: str,
        transcript_segments: list[dict[str, float | str]],
    ) -> list[dict[str, object]]:
        payload = self._stage_artifact_store.read_json(task_id, "C", "transcript/index.json", default={})
        if isinstance(payload, dict):
            chunks_payload = payload.get("chunks")
            if isinstance(chunks_payload, list):
                windows: list[dict[str, object]] = []
                for item in chunks_payload:
                    if not isinstance(item, dict):
                        continue
                    windows.append(
                        {
                            "chunk_index": int(item.get("index", len(windows) + 1) or (len(windows) + 1)),
                            "start_seconds": round(_to_float(item.get("start_seconds")), 2),
                            "end_seconds": round(_to_float(item.get("end_seconds")), 2),
                        }
                    )
                if windows:
                    return windows
        if not transcript_segments:
            return [{"chunk_index": 1, "start_seconds": 0.0, "end_seconds": 0.0}]
        start_seconds = round(min(_to_float(item.get("start")) for item in transcript_segments), 2)
        end_seconds = round(max(_to_float(item.get("end")) for item in transcript_segments), 2)
        return [{"chunk_index": 1, "start_seconds": start_seconds, "end_seconds": max(start_seconds, end_seconds)}]

    @staticmethod
    def _split_segments_by_chunk_windows(
        segments: list[dict[str, float | str]],
        chunk_windows: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        windows = [window for window in chunk_windows if isinstance(window, dict)]
        if not windows:
            windows = [{"chunk_index": 1, "start_seconds": 0.0, "end_seconds": 0.0}]
        windows.sort(key=lambda item: (int(item.get("chunk_index", 0) or 0), _to_float(item.get("start_seconds"))))
        grouped: list[dict[str, object]] = [
            {
                "chunk_index": int(window.get("chunk_index", index + 1) or (index + 1)),
                "start_seconds": round(_to_float(window.get("start_seconds")), 2),
                "end_seconds": round(max(_to_float(window.get("start_seconds")), _to_float(window.get("end_seconds"))), 2),
                "segments": [],
            }
            for index, window in enumerate(windows)
        ]
        if not segments:
            return grouped
        for segment in segments:
            if not isinstance(segment, dict):
                continue
            normalized = {
                "start": round(_to_float(segment.get("start")), 2),
                "end": round(max(_to_float(segment.get("start")), _to_float(segment.get("end"))), 2),
                "text": str(segment.get("text", "")).strip(),
            }
            target_index = len(grouped) - 1
            segment_start = _to_float(normalized.get("start"))
            for index, group in enumerate(grouped):
                group_end = _to_float(group.get("end_seconds"))
                if segment_start <= group_end or index == len(grouped) - 1:
                    target_index = index
                    break
            target_segments = grouped[target_index].setdefault("segments", [])
            if isinstance(target_segments, list):
                target_segments.append(normalized)
        return grouped

    async def _publish_transcript_optimized_preview(self, task_id: str, text: str) -> None:
        await self._reset_transcript_optimized_preview(task_id)
        await self._append_transcript_optimized_preview(task_id, text, stream_mode="compat")
        await self._complete_transcript_optimized_preview(task_id)

    async def _reset_transcript_optimized_preview(self, task_id: str) -> None:
        await self._event_bus.publish(
            task_id,
            {
                "type": "transcript_optimized_preview",
                "stage": "D",
                "reset": True,
                "text": "",
            },
        )

    async def _append_transcript_optimized_preview(
        self,
        task_id: str,
        text: str,
        *,
        stream_mode: str = "realtime",
        start: float | None = None,
        end: float | None = None,
    ) -> None:
        if not text and start is None and end is None:
            return
        payload: dict[str, object] = {
            "type": "transcript_optimized_preview",
            "stage": "D",
            "text": text,
            "stream_mode": stream_mode,
        }
        if isinstance(start, (int, float)):
            payload["start"] = round(float(start), 2)
        if isinstance(end, (int, float)):
            payload["end"] = round(float(end), 2)
        await self._event_bus.publish(task_id, payload)

    async def _complete_transcript_optimized_preview(self, task_id: str) -> None:
        await self._event_bus.publish(
            task_id,
            {
                "type": "transcript_optimized_preview",
                "stage": "D",
                "done": True,
            },
        )

    async def _publish_fusion_prompt_preview(self, task_id: str, prompt_text: str) -> None:
        normalized_text = (prompt_text or "").strip()
        await self._update_task(task_id, fusion_prompt_markdown=normalized_text)
        await self._persist_stage_artifact_text(task_id, "D", "fusion/fusion-prompt.md", normalized_text)
        await self._event_bus.publish(
            task_id,
            {
                "type": "fusion_prompt_preview",
                "stage": "D",
                "text": normalized_text,
            },
        )

    async def _update_task(self, task_id: str, **fields) -> None:
        if task_id in self._task_stage_metrics and "stage_metrics_json" not in fields:
            fields["stage_metrics_json"] = _encode_stage_metrics(self._task_stage_metrics[task_id])

        def _write() -> None:
            self._task_store.update(task_id, **fields)

        await asyncio.to_thread(_write)

    def _consume_pause_request(self, task_id: str) -> bool:
        if task_id not in self._pause_requests:
            return False
        self._pause_requests.discard(task_id)
        return True

    async def _mark_paused(self, task_id: str, *, emit_event: bool) -> bool:
        def _write_paused() -> bool:
            task = self._task_store.get(task_id)
            if task is None:
                raise ValueError(f"Task not found: {task_id}")
            if task.status in {
                TaskStatus.COMPLETED.value,
                TaskStatus.FAILED.value,
                TaskStatus.CANCELLED.value,
                TaskStatus.PAUSED.value,
            }:
                return False
            self._task_store.update(
                task_id,
                status=TaskStatus.PAUSED.value,
                error_message="Task paused by user.",
            )
            return True

        changed = await asyncio.to_thread(_write_paused)
        if changed and emit_event:
            await self._event_bus.publish(task_id, {"type": "task_paused", "error": "Task paused by user."})
        return changed

    async def _mark_cancelled(self, task_id: str, *, emit_event: bool, cleanup_media_dir: bool) -> bool:
        def _write_cancelled() -> bool:
            task = self._task_store.get(task_id)
            if task is None:
                raise ValueError(f"Task not found: {task_id}")
            if task.status in {
                TaskStatus.COMPLETED.value,
                TaskStatus.FAILED.value,
                TaskStatus.CANCELLED.value,
            }:
                return False
            self._task_store.update(
                task_id,
                status=TaskStatus.CANCELLED.value,
                error_message="Task cancelled by user.",
            )
            return True

        changed = await asyncio.to_thread(_write_cancelled)
        self._pause_requests.discard(task_id)
        if changed and emit_event:
            await self._event_bus.publish(task_id, {"type": "task_cancelled", "error": "Task cancelled by user."})
        if cleanup_media_dir:
            media_dir = Path(self._settings.temp_dir) / task_id
            await asyncio.to_thread(shutil.rmtree, media_dir, True)
        return changed


def _empty_stage_logs() -> dict[str, list[str]]:
    return {stage: [] for stage in _STAGE_KEYS}


def _decode_stage_logs(raw: str | None) -> dict[str, list[str]]:
    decoded = _empty_stage_logs()
    if not raw:
        return decoded
    try:
        payload = orjson.loads(raw)
    except orjson.JSONDecodeError:
        return decoded
    if not isinstance(payload, dict):
        return decoded
    for stage in _STAGE_KEYS:
        value = payload.get(stage)
        if isinstance(value, list):
            decoded[stage] = [str(item) for item in value]
    return decoded


def _decode_stage_metrics(raw: str | None) -> dict[StageType, dict[str, object]]:
    decoded = _empty_stage_metrics()
    if not raw:
        return decoded
    try:
        payload = orjson.loads(raw)
    except orjson.JSONDecodeError:
        return decoded
    if not isinstance(payload, dict):
        return decoded
    for stage in _STAGE_KEYS:
        value = payload.get(stage)
        if isinstance(value, dict):
            merged = dict(decoded.get(stage, {}))
            merged.update(value)
            decoded[stage] = merged  # type: ignore[assignment]
    return decoded


def _decode_transcript_segments(raw: str | None) -> list[dict[str, float | str]]:
    if not raw:
        return []
    try:
        payload = orjson.loads(raw)
    except orjson.JSONDecodeError:
        return []
    if not isinstance(payload, list):
        return []
    normalized: list[dict[str, float | str]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        normalized.append(
            {
                "start": _to_float(item.get("start")),
                "end": _to_float(item.get("end")),
                "text": str(item.get("text", "")),
            }
        )
    return normalized


def _normalize_transcript_segments_payload(payload: object) -> list[dict[str, float | str]]:
    if not isinstance(payload, list):
        return []
    normalized: list[dict[str, float | str]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text", "") or "").strip()
        if not text:
            continue
        start = round(_to_float(item.get("start")), 2)
        end = round(max(start, _to_float(item.get("end"))), 2)
        normalized.append(
            {
                "start": start,
                "end": end,
                "text": text,
            }
        )
    return normalized


def _empty_stage_metrics() -> dict[StageType, dict[str, object]]:
    metrics: dict[StageType, dict[str, object]] = {
        stage: {
            "started_at": None,
            "completed_at": None,
            "elapsed_seconds": None,
            "status": "pending",
            "reason": None,
            "log_count": 0,
            "scheduler_mode": "",
            "scheduler_wait_seconds": 0.0,
            "runtime_wait_seconds": 0.0,
            "runtime_lock_count": 0,
        }
        for stage in _STAGE_KEYS
    }
    metrics["D"]["substage_metrics"] = {
        substage: {
            "title": _D_SUBSTAGE_TITLES[substage],
            "status": "pending",
            "started_at": None,
            "completed_at": None,
            "elapsed_seconds": None,
            "optional": substage in {"transcript_optimize"},
        }
        for substage in _D_SUBSTAGE_KEYS
    }
    return metrics


def _encode_stage_logs(stage_logs: dict[str, list[str]]) -> str:
    return orjson.dumps(stage_logs).decode("utf-8")


def _encode_stage_metrics(stage_metrics: dict[StageType, dict[str, object]]) -> str:
    return orjson.dumps(stage_metrics).decode("utf-8")


def _format_stage_log_line(message: str, *, substage: str | None, elapsed_seconds: float | None) -> str:
    prefixes: list[str] = []
    if substage:
        prefixes.append(f"[{substage}]")
    if elapsed_seconds is not None:
        prefixes.append(f"[+{elapsed_seconds:.1f}s]")
    if not prefixes:
        return message
    return f"{' '.join(prefixes)} {message}"


def _resolve_execution_mode(
    *,
    llm_runtime_config: dict[str, object],
) -> ExecutionMode:
    _ = llm_runtime_config
    return "api"


def _llm_requires_runtime_lock(llm_runtime_config: dict[str, object]) -> bool:
    return str(llm_runtime_config.get("mode", "") or "").strip().lower() == "local"


def _to_optional_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_float(value: object) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _interpolate_progress(start: int, end: int, ratio: float) -> int:
    safe_start = int(start)
    safe_end = int(end)
    if safe_end <= safe_start:
        return safe_start
    safe_ratio = max(0.0, min(1.0, float(ratio)))
    return int(round(safe_start + (safe_end - safe_start) * safe_ratio))


def _format_size_mb(size_bytes: int) -> str:
    safe_size = max(0, int(size_bytes))
    return f"{safe_size / (1024 * 1024):.1f} MiB"


def _normalize_notes_image_relative_path(relative_path: str) -> str:
    normalized = str(relative_path or "").strip().replace("\\", "/").lstrip("/")
    if not normalized:
        return "notes-images/mermaid-unknown.png"
    if not normalized.startswith("notes-images/"):
        normalized = f"notes-images/{normalized}"
    return normalized


def _join_transcript_segment_texts(segments: list[dict[str, float | str]]) -> str:
    lines: list[str] = []
    for segment in segments:
        text = str(segment.get("text", "")).strip()
        if text:
            lines.append(text)
    return "\n".join(lines).strip()
