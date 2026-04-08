from __future__ import annotations

import asyncio
import shutil
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import orjson

from app.config import Settings
from app.models import TaskStatus
from app.services.events import EventBus
from app.services.ingestion import (
    AudioChunk,
    IngestionResult,
    download_bilibili_video,
    extract_audio_wav,
    prepare_local_video,
    split_audio_wav,
)
from app.services.llm_config_store import LLMConfigStore
from app.services.model_runtime_manager import ModelRuntimeManager, RuntimeEviction
from app.services.prompt_template_store import PromptTemplateStore
from app.services.resource_guard import ResourceGuard
from app.services.runtime_config_store import RuntimeConfigStore
from app.services.runtime_event_service import RuntimeEventService
from app.services.stage_artifact_store import StageArtifactStore
from app.services.summarizer import (
    LLMService,
    NotesPipelineArtifacts,
    SummaryBundle,
    _ensure_single_markdown_title,
)
from app.services.task_artifact_index import build_task_artifact_index
from app.services.task_artifact_persistence_service import TaskArtifactPersistenceService
from app.services.task_error_classifier import classify_task_failure
from app.services.task_store import TaskStore
from app.services.transcription import WhisperService

SourceType = Literal["bilibili", "local_file", "local_path"]
StageType = Literal["A", "B", "C", "D"]
DSubstageType = Literal[
    "transcript_optimize",
    "notes_extract",
    "notes_outline",
    "notes_sections",
    "notes_coverage",
    "summary_delivery",
    "mindmap_delivery",
]
ExecutionMode = Literal["api"]

_STAGE_KEYS: tuple[StageType, StageType, StageType, StageType] = ("A", "B", "C", "D")
_RESOURCE_GUARD_WARNING_CODE = "RESOURCE_GUARD_WARNING"
_RESOURCE_GUARD_WARNING_ACTION = "review_runtime_config"
_CONFIG_PRECHECK_WARNING_CODE = "CONFIG_PRECHECK_WARNING"
_CONFIG_PRECHECK_WARNING_ACTION = "review_runtime_config"
_D_SUBSTAGE_KEYS: tuple[DSubstageType, ...] = (
    "transcript_optimize",
    "notes_extract",
    "notes_outline",
    "notes_sections",
    "notes_coverage",
    "summary_delivery",
    "mindmap_delivery",
)
_D_SUBSTAGE_TITLES: dict[DSubstageType, str] = {
    "transcript_optimize": "转录文本优化",
    "notes_extract": "信息卡片提取",
    "notes_outline": "详细笔记提纲生成",
    "notes_sections": "详细笔记章节生成",
    "notes_coverage": "详细笔记覆盖率补全",
    "summary_delivery": "摘要生成",
    "mindmap_delivery": "思维导图生成",
}
_PROGRESS_STAGE_A_START = 2
_PROGRESS_STAGE_A_DONE = 10
_PROGRESS_STAGE_B_START = 12
_PROGRESS_STAGE_B_DONE = 22
_PROGRESS_STAGE_C_START = 24
_PROGRESS_STAGE_C_DONE = 46
_PROGRESS_STAGE_D_START = 48
_PROGRESS_TRANSCRIPT_DONE = 60
_PROGRESS_NOTES_EXTRACT_DONE = 68
_PROGRESS_NOTES_OUTLINE_DONE = 74
_PROGRESS_NOTES_SECTIONS_DONE = 84
_PROGRESS_NOTES_COVERAGE_DONE = 90
_PROGRESS_SUMMARY_DONE = 95
_PROGRESS_MINDMAP_DONE = 99
_PROGRESS_TASK_DONE = 100


@dataclass(slots=True)
class TaskSubmission:
    task_id: str
    source_type: SourceType
    source_input: str
    source_local_path: str | None
    model_size: str
    language: str


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
    ) -> None:
        self._settings = settings
        self._event_bus = event_bus
        self._llm_config_store = llm_config_store
        self._resource_guard = resource_guard
        self._runtime_config_store = runtime_config_store
        self._model_runtime_manager = model_runtime_manager
        self._task_store = task_store
        self._transcriber = WhisperService(settings)
        self._summarizer = LLMService(
            settings,
            llm_config_store=llm_config_store,
            prompt_template_store=prompt_template_store,
        )
        self._stage_artifact_store = StageArtifactStore(settings.storage_dir)
        self._artifact_persistence = TaskArtifactPersistenceService(
            task_store=task_store,
            stage_artifact_store=self._stage_artifact_store,
        )
        self._runtime_events = RuntimeEventService(
            event_bus=event_bus,
            task_store=task_store,
            artifact_persistence=self._artifact_persistence,
            d_substage_titles=_D_SUBSTAGE_TITLES,
            d_optional_substages=("transcript_optimize",),
        )
        self._jobs: dict[str, asyncio.Task[None]] = {}
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_jobs)
        self._api_mode_semaphore = asyncio.Semaphore(max(1, settings.max_api_mode_jobs))

    async def submit(self, submission: TaskSubmission) -> None:
        job = asyncio.create_task(self._run_pipeline(submission))
        self._jobs[submission.task_id] = job
        job.add_done_callback(lambda _: self._jobs.pop(submission.task_id, None))

    async def rerun_stage_d(self, task_id: str) -> bool:
        existing = self._jobs.get(task_id)
        if existing is not None and not existing.done():
            return False

        def _prepare_record() -> bool:
            record = self._task_store.get(task_id)
            if record is None:
                raise ValueError(f"Task not found: {task_id}")
            if record.status not in {
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
            return True

        await asyncio.to_thread(_prepare_record)
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

    async def shutdown(self) -> None:
        running_jobs = list(self._jobs.values())
        for job in running_jobs:
            if not job.done():
                job.cancel()
        if running_jobs:
            await asyncio.gather(*running_jobs, return_exceptions=True)
        self._transcriber.shutdown()

    async def _run_pipeline(self, submission: TaskSubmission) -> None:
        async with self._semaphore:
            task_id = submission.task_id
            media_dir = Path(self._settings.temp_dir) / task_id
            audio_path = media_dir / "audio.wav"
            chunks_dir = media_dir / "chunks"
            stage_logs = _empty_stage_logs()
            stage_metrics = _empty_stage_metrics()
            active_stage: StageType = "A"
            uploaded_source = (
                Path(submission.source_local_path)
                if submission.source_type == "local_file" and submission.source_local_path
                else None
            )
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
            runtime_warnings.extend(
                self._resource_guard.ensure_runtime_capacity(
                    whisper=whisper_config, llm=llm_runtime_config
                )
            )

            selected_model = "small"
            selected_language = submission.language.strip() or whisper_config["language"]
            self._runtime_events.initialize_task(task_id, stage_metrics)

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
                preflight_warnings = await asyncio.to_thread(
                    self._validate_analysis_prerequisites,
                    llm_runtime_config,
                    whisper_config,
                    selected_model,
                )
                for warning in preflight_warnings:
                    await self._emit_runtime_warning(
                        task_id,
                        "A",
                        warning,
                        stage_logs,
                        code=_CONFIG_PRECHECK_WARNING_CODE,
                        component="runtime_precheck",
                        action=_CONFIG_PRECHECK_WARNING_ACTION,
                        substage="precheck",
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
                            await self._emit_log(
                                task_id, "A", message, stage_logs, substage="asr_model"
                            )
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

                await self._transcriber.ensure_small_model_ready(
                    on_progress=on_model_prepare_progress
                )
                await self._emit_log(
                    task_id, "A", f"Source type: {submission.source_type}", stage_logs
                )
                ingestion_result = await asyncio.to_thread(
                    self._ingest_source, submission, media_dir
                )
                await self._emit_log(
                    task_id, "A", f"Video ready: {ingestion_result.media_path.name}", stage_logs
                )
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
                    source_local_path=str(ingestion_result.media_path),
                    progress=_PROGRESS_STAGE_A_DONE,
                    language=selected_language,
                    model_size=selected_model,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._stage_complete(
                    task_id, "A", progress=_PROGRESS_STAGE_A_DONE, stage_logs=stage_logs
                )
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
                await self._emit_log(
                    task_id, "B", f"Audio conversion completed: {audio_path.name}", stage_logs
                )
                await self._emit_log(
                    task_id,
                    "B",
                    f"Splitting audio into chunks ({whisper_config['chunk_seconds']}s each)...",
                    stage_logs,
                )
                audio_chunks = await asyncio.to_thread(
                    split_audio_wav, audio_path, chunks_dir, whisper_config["chunk_seconds"]
                )
                if not audio_chunks:
                    audio_chunks = [
                        AudioChunk(path=audio_path, start_seconds=0.0, duration_seconds=0.0)
                    ]
                self._set_stage_metric_values(
                    task_id,
                    "B",
                    {
                        "chunk_count": len(audio_chunks),
                        "chunk_seconds": int(whisper_config["chunk_seconds"]),
                        "audio_path": str(audio_path),
                    },
                )
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
                                "end_seconds": round(
                                    chunk.start_seconds + max(0.0, chunk.duration_seconds), 2
                                ),
                            }
                            for index, chunk in enumerate(audio_chunks, start=1)
                        ],
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                await self._update_task(
                    task_id,
                    progress=_PROGRESS_STAGE_B_DONE,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._stage_complete(
                    task_id, "B", progress=_PROGRESS_STAGE_B_DONE, stage_logs=stage_logs
                )
                active_stage = "C"

                await self._stage_start(
                    task_id,
                    "C",
                    "Speech Transcription",
                    stage_logs=stage_logs,
                    status=TaskStatus.TRANSCRIBING.value,
                    progress=_PROGRESS_STAGE_C_START,
                )
                all_segments: list[dict[str, float | str]] = []
                total_chunks = max(1, len(audio_chunks))
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
                    await self._handle_runtime_evictions(
                        task_id, "C", asr_lease.evictions, stage_logs
                    )
                    if asr_lease.wait_seconds > 0:
                        await self._emit_log(
                            task_id,
                            "C",
                            f"Waiting for model runtime lock: {asr_lease.wait_seconds:.2f}s",
                            stage_logs,
                            substage="runtime",
                        )
                    for chunk_index, chunk in enumerate(audio_chunks):
                        await self._emit_log(
                            task_id,
                            "C",
                            f"Transcribing chunk {chunk_index + 1}/{total_chunks}: {chunk.path.name}",
                            stage_logs,
                        )

                        segment_queue: asyncio.Queue[dict | None] = asyncio.Queue(maxsize=256)
                        last_overall_progress = -1

                        async def consume_segment_queue() -> None:
                            nonlocal last_overall_progress
                            while True:
                                item = await segment_queue.get()
                                if item is None:
                                    break
                                segment = item["segment"]
                                overall_progress = int(item["overall_progress"])
                                stage_progress = int(item["stage_progress"])
                                await self._event_bus.publish(
                                    task_id, {"type": "transcript_delta", "stage": "C", **segment}
                                )
                                if overall_progress != last_overall_progress:
                                    last_overall_progress = overall_progress
                                    await self._event_bus.publish(
                                        task_id,
                                        {
                                            "type": "progress",
                                            "stage": "C",
                                            "stage_progress": stage_progress,
                                            "overall_progress": overall_progress,
                                        },
                                    )

                        consumer_task = asyncio.create_task(consume_segment_queue())

                        def on_segment(raw_segment: dict[str, float | str]) -> None:
                            relative_end = max(0.0, float(raw_segment["end"]) - chunk.start_seconds)
                            progress_ratio = (
                                chunk_index
                                + min(relative_end / max(chunk.duration_seconds, 1.0), 1.0)
                            ) / total_chunks
                            overall_progress = _interpolate_progress(
                                _PROGRESS_STAGE_C_START,
                                _PROGRESS_STAGE_C_DONE,
                                progress_ratio,
                            )
                            payload = {
                                "segment": raw_segment,
                                "overall_progress": max(
                                    _PROGRESS_STAGE_C_START,
                                    min(_PROGRESS_STAGE_C_DONE, overall_progress),
                                ),
                                "stage_progress": max(0, min(100, int(progress_ratio * 100))),
                            }

                            def enqueue_from_loop() -> None:
                                if segment_queue.full():
                                    try:
                                        _ = segment_queue.get_nowait()
                                    except asyncio.QueueEmpty:
                                        pass
                                try:
                                    segment_queue.put_nowait(payload)
                                except asyncio.QueueFull:
                                    pass

                            event_loop.call_soon_threadsafe(enqueue_from_loop)

                        try:
                            result = await self._transcriber.transcribe(
                                audio_path=chunk.path,
                                model_size=selected_model,
                                language=selected_language,
                                model_default=whisper_config["model_default"],
                                device=whisper_config["device"],
                                compute_type=whisper_config["compute_type"],
                                beam_size=whisper_config["beam_size"],
                                vad_filter=whisper_config["vad_filter"],
                                model_load_profile=whisper_config.get(
                                    "model_load_profile", "balanced"
                                ),
                                timestamp_offset_seconds=chunk.start_seconds,
                                on_segment=on_segment,
                            )
                        finally:
                            await segment_queue.put(None)
                            await consumer_task
                        all_segments.extend(result.segments)
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
                                "end_seconds": round(
                                    chunk.start_seconds + max(0.0, chunk.duration_seconds), 2
                                ),
                                "segment_count": len(result.segments),
                                "segments": result.segments,
                                "updated_at": datetime.now(timezone.utc).isoformat(),
                            },
                        )
                        chunk_progress = _interpolate_progress(
                            _PROGRESS_STAGE_C_START,
                            _PROGRESS_STAGE_C_DONE,
                            (chunk_index + 1) / total_chunks,
                        )
                        await self._emit_log(
                            task_id,
                            "C",
                            f"Chunk {chunk_index + 1}/{total_chunks} transcription completed",
                            stage_logs,
                        )
                        await self._update_task(
                            task_id,
                            progress=chunk_progress,
                            stage_logs_json=_encode_stage_logs(stage_logs),
                        )

                transcript_text = _join_transcript_segment_texts(all_segments)
                self._set_stage_metric_values(
                    task_id,
                    "C",
                    {
                        "segment_count": len(all_segments),
                        "transcript_chars": len(transcript_text),
                        "chunk_count": len(audio_chunks),
                    },
                )
                await self._persist_stage_artifact_json(
                    task_id,
                    "C",
                    "transcript/index.json",
                    {
                        "task_id": task_id,
                        "chunk_count": len(audio_chunks),
                        "segment_count": len(all_segments),
                        "chunks": [
                            {
                                "index": index,
                                "file_name": chunk.path.name,
                                "start_seconds": round(chunk.start_seconds, 2),
                                "duration_seconds": round(chunk.duration_seconds, 2),
                                "end_seconds": round(
                                    chunk.start_seconds + max(0.0, chunk.duration_seconds), 2
                                ),
                            }
                            for index, chunk in enumerate(audio_chunks, start=1)
                        ],
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                await self._persist_stage_artifact_text(
                    task_id, "C", "transcript/full.txt", transcript_text
                )
                await self._update_task(
                    task_id,
                    progress=_PROGRESS_STAGE_C_DONE,
                    transcript_text=transcript_text,
                    transcript_segments_json=orjson.dumps(all_segments).decode("utf-8"),
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._stage_complete(
                    task_id, "C", progress=_PROGRESS_STAGE_C_DONE, stage_logs=stage_logs
                )
                active_stage = "D"

                await self._stage_start(
                    task_id,
                    "D",
                    "Detailed Notes and Mindmap Generation",
                    stage_logs=stage_logs,
                    status=TaskStatus.SUMMARIZING.value,
                    progress=_PROGRESS_STAGE_D_START,
                )
                llm_model_id = (
                    str(llm_runtime_config.get("model", self._settings.llm_model)).strip()
                    or self._settings.llm_model
                )
                correction_mode = (
                    str(llm_runtime_config.get("correction_mode", "strict")).strip().lower()
                )
                correction = None
                preview_streamed = False
                await self._reset_transcript_optimized_preview(task_id)

                async def emit_correction_preview(delta: str, stream_mode: str) -> None:
                    nonlocal preview_streamed
                    if not delta:
                        return
                    preview_streamed = True
                    await self._append_transcript_optimized_preview(
                        task_id, delta, stream_mode=stream_mode
                    )

                async def emit_correction_preview_segment(
                    segment: dict[str, float | str], stream_mode: str
                ) -> None:
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
                    await self._d_substage_start(
                        task_id, "transcript_optimize", progress=_PROGRESS_STAGE_D_START
                    )
                    await self._emit_log(
                        task_id,
                        "D",
                        "Running transcript correction strategy...",
                        stage_logs,
                        substage="transcript_optimize",
                    )
                    try:
                        async with self._model_runtime_manager.reserve(
                            task_id=task_id,
                            stage="D",
                            component="llm",
                            model_id=f"llm:{llm_model_id}",
                        ) as llm_correction_lease:
                            self._record_runtime_lease(
                                task_id, "D", llm_correction_lease.wait_seconds
                            )
                            await self._handle_runtime_evictions(
                                task_id, "D", llm_correction_lease.evictions, stage_logs
                            )
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
                        await self._append_transcript_optimized_preview(
                            task_id, summary_source_text, stream_mode="compat"
                        )
                await self._complete_transcript_optimized_preview(task_id)
                await self._persist_transcript_optimization_artifacts(
                    task_id=task_id,
                    correction_mode=correction.mode,
                    fallback_used=correction.fallback_used,
                    summary_source_text=summary_source_text,
                    optimized_segments=correction.segments,
                    chunk_windows=self._build_audio_chunk_windows(audio_chunks),
                )
                self._set_stage_metric_values(
                    task_id,
                    "D",
                    {
                        "correction_mode": correction.mode,
                        "correction_fallback_used": bool(correction.fallback_used),
                        "optimized_segment_count": len(correction.segments),
                        "summary_source_chars": len(summary_source_text),
                        "notes_source_chars": len(transcript_text),
                        "notes_source_mode": "full_transcript_segments"
                        if all_segments
                        else "full_transcript_text",
                    },
                )

                await self._update_task(
                    task_id,
                    progress=_PROGRESS_TRANSCRIPT_DONE,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                bundle = await self._generate_stage_d_outputs(
                    task_id=task_id,
                    task_title=ingestion_result.title,
                    notes_source_text=transcript_text,
                    transcript_segments=all_segments,
                    llm_runtime_config=llm_runtime_config,
                    llm_model_id=llm_model_id,
                    stage_logs=stage_logs,
                )

                await self._emit_log(
                    task_id,
                    "D",
                    "Detailed notes and mindmap persisted to local storage",
                    stage_logs,
                )
                artifact_index_json, artifact_total_bytes = build_task_artifact_index(
                    task_id=task_id,
                    transcript_text=transcript_text,
                    transcript_segments_json=orjson.dumps(all_segments).decode("utf-8"),
                    summary_markdown=bundle.summary_markdown,
                    notes_markdown=bundle.notes_markdown,
                    mindmap_markdown=bundle.mindmap_markdown,
                    storage_dir=self._settings.storage_dir,
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
                await self._stage_complete(
                    task_id, "D", progress=_PROGRESS_TASK_DONE, stage_logs=stage_logs
                )
                await self._event_bus.publish(
                    task_id, {"type": "task_complete", "overall_progress": _PROGRESS_TASK_DONE}
                )
            except asyncio.CancelledError:
                await self._emit_log(task_id, active_stage, "Task cancelled", stage_logs)
                self._mark_stage_failed(task_id, active_stage, "Task cancelled by user.")
                await self._persist_stage_metric(task_id, active_stage)
                await self._persist_analysis_result(
                    task_id,
                    active_stage,
                    status="cancelled",
                    progress=100,
                    reason="Task cancelled by user.",
                )
                await self._update_task(
                    task_id,
                    status=TaskStatus.CANCELLED.value,
                    error_message="Task cancelled by user.",
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._event_bus.publish(
                    task_id, {"type": "task_cancelled", "error": "Task cancelled by user."}
                )
                raise
            except Exception as exc:  # noqa: BLE001
                failure = classify_task_failure(stage=active_stage, exc=exc)
                classified_reason = f"[{failure.category}] {failure.reason}"
                await self._emit_log(
                    task_id,
                    active_stage,
                    f"Task failed ({failure.category}): {failure.reason}",
                    stage_logs,
                )
                self._mark_stage_failed(task_id, active_stage, classified_reason)
                await self._persist_stage_metric(task_id, active_stage)
                await self._persist_analysis_result(
                    task_id,
                    active_stage,
                    status="failed",
                    progress=100,
                    reason=classified_reason,
                )
                await self._update_task(
                    task_id,
                    status=TaskStatus.FAILED.value,
                    progress=100,
                    error_message=f"{failure.hint} ({failure.reason})",
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._event_bus.publish(
                    task_id,
                    {
                        "type": "task_failed",
                        "error": classified_reason,
                        "category": failure.category,
                        "hint": failure.hint,
                    },
                )
            finally:
                mode_semaphore.release()
                if uploaded_source:
                    uploaded_source.unlink(missing_ok=True)
                await asyncio.to_thread(shutil.rmtree, media_dir, True)
                self._runtime_events.clear_task(task_id)

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
                self._runtime_events.initialize_task(task_id, stage_metrics)
                transcript_segments = _decode_transcript_segments(record.transcript_segments_json)
                transcript_text = (
                    record.transcript_text or ""
                ).strip() or _join_transcript_segment_texts(transcript_segments)
                if not transcript_text:
                    raise ValueError(
                        "Task has no persisted transcript artifacts for stage-D rerun."
                    )

                task_title = (
                    str(record.title or "").strip()
                    or str(record.source_input or "").strip()
                    or f"Task-{task_id}"
                )

                runtime_warnings: list[str] = []
                whisper_guard = self._resource_guard.guard_whisper_config(whisper_config)
                if whisper_guard["rollback_applied"]:
                    whisper_config = whisper_guard["config"]  # type: ignore[assignment]
                runtime_warnings.extend(whisper_guard["warnings"])
                llm_guard = self._resource_guard.guard_llm_config(llm_runtime_config)
                if llm_guard["rollback_applied"]:
                    llm_runtime_config = llm_guard["config"]  # type: ignore[assignment]
                runtime_warnings.extend(llm_guard["warnings"])
                runtime_warnings.extend(
                    self._resource_guard.ensure_runtime_capacity(
                        whisper=whisper_config, llm=llm_runtime_config
                    )
                )

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
                preflight_warnings = await asyncio.to_thread(
                    self._validate_analysis_prerequisites,
                    llm_runtime_config,
                    whisper_config,
                )
                for warning in [*runtime_warnings, *preflight_warnings]:
                    await self._emit_runtime_warning(
                        task_id,
                        "D",
                        warning,
                        stage_logs,
                        code=_CONFIG_PRECHECK_WARNING_CODE,
                        component="runtime_precheck",
                        action=_CONFIG_PRECHECK_WARNING_ACTION,
                        substage="precheck",
                    )

                llm_model_id = (
                    str(llm_runtime_config.get("model", self._settings.llm_model)).strip()
                    or self._settings.llm_model
                )
                correction_mode = (
                    str(llm_runtime_config.get("correction_mode", "strict")).strip().lower()
                )
                correction = None
                preview_streamed = False
                await self._reset_transcript_optimized_preview(task_id)

                async def emit_correction_preview(delta: str, stream_mode: str) -> None:
                    nonlocal preview_streamed
                    if not delta:
                        return
                    preview_streamed = True
                    await self._append_transcript_optimized_preview(
                        task_id, delta, stream_mode=stream_mode
                    )

                async def emit_correction_preview_segment(
                    segment: dict[str, float | str], stream_mode: str
                ) -> None:
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
                    await self._d_substage_start(
                        task_id, "transcript_optimize", progress=_PROGRESS_STAGE_D_START
                    )
                    await self._emit_log(
                        task_id,
                        "D",
                        "Running transcript correction strategy...",
                        stage_logs,
                        substage="transcript_optimize",
                    )
                    try:
                        async with self._model_runtime_manager.reserve(
                            task_id=task_id,
                            stage="D",
                            component="llm",
                            model_id=f"llm:{llm_model_id}",
                        ) as llm_correction_lease:
                            self._record_runtime_lease(
                                task_id, "D", llm_correction_lease.wait_seconds
                            )
                            await self._handle_runtime_evictions(
                                task_id, "D", llm_correction_lease.evictions, stage_logs
                            )
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
                await self._emit_log(
                    task_id, "D", correction.message, stage_logs, substage="transcript_optimize"
                )
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
                        await self._append_transcript_optimized_preview(
                            task_id, summary_source_text, stream_mode="compat"
                        )
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
                self._set_stage_metric_values(
                    task_id,
                    "D",
                    {
                        "correction_mode": correction.mode,
                        "correction_fallback_used": bool(correction.fallback_used),
                        "optimized_segment_count": len(correction.segments),
                        "summary_source_chars": len(summary_source_text),
                        "notes_source_chars": len(transcript_text),
                        "notes_source_mode": "full_transcript_segments"
                        if transcript_segments
                        else "full_transcript_text",
                        "retry_stage_d": True,
                    },
                )

                await self._update_task(
                    task_id,
                    progress=_PROGRESS_TRANSCRIPT_DONE,
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                bundle = await self._generate_stage_d_outputs(
                    task_id=task_id,
                    task_title=task_title,
                    notes_source_text=transcript_text,
                    transcript_segments=transcript_segments,
                    llm_runtime_config=llm_runtime_config,
                    llm_model_id=llm_model_id,
                    stage_logs=stage_logs,
                )

                artifact_index_json, artifact_total_bytes = build_task_artifact_index(
                    task_id=task_id,
                    transcript_text=transcript_text,
                    transcript_segments_json=orjson.dumps(transcript_segments).decode("utf-8"),
                    summary_markdown=bundle.summary_markdown,
                    notes_markdown=bundle.notes_markdown,
                    mindmap_markdown=bundle.mindmap_markdown,
                    storage_dir=self._settings.storage_dir,
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
                await self._stage_complete(
                    task_id, "D", progress=_PROGRESS_TASK_DONE, stage_logs=stage_logs
                )
                await self._event_bus.publish(
                    task_id, {"type": "task_complete", "overall_progress": _PROGRESS_TASK_DONE}
                )
            except asyncio.CancelledError:
                await self._emit_log(task_id, active_stage, "Task cancelled", stage_logs)
                self._mark_stage_failed(task_id, active_stage, "Task cancelled by user.")
                await self._persist_stage_metric(task_id, active_stage)
                await self._persist_analysis_result(
                    task_id,
                    active_stage,
                    status="cancelled",
                    progress=100,
                    reason="Task cancelled by user.",
                )
                await self._update_task(
                    task_id,
                    status=TaskStatus.CANCELLED.value,
                    error_message="Task cancelled by user.",
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._event_bus.publish(
                    task_id, {"type": "task_cancelled", "error": "Task cancelled by user."}
                )
                raise
            except Exception as exc:  # noqa: BLE001
                failure = classify_task_failure(stage=active_stage, exc=exc)
                classified_reason = f"[{failure.category}] {failure.reason}"
                await self._emit_log(
                    task_id,
                    active_stage,
                    f"Task failed ({failure.category}): {failure.reason}",
                    stage_logs,
                )
                self._mark_stage_failed(task_id, active_stage, classified_reason)
                await self._persist_stage_metric(task_id, active_stage)
                await self._persist_analysis_result(
                    task_id,
                    active_stage,
                    status="failed",
                    progress=100,
                    reason=classified_reason,
                )
                await self._update_task(
                    task_id,
                    status=TaskStatus.FAILED.value,
                    progress=100,
                    error_message=f"{failure.hint} ({failure.reason})",
                    stage_logs_json=_encode_stage_logs(stage_logs),
                )
                await self._event_bus.publish(
                    task_id,
                    {
                        "type": "task_failed",
                        "error": classified_reason,
                        "category": failure.category,
                        "hint": failure.hint,
                    },
                )
            finally:
                mode_semaphore.release()
                await asyncio.to_thread(shutil.rmtree, media_dir, True)
                self._runtime_events.clear_task(task_id)

    def _ingest_source(self, submission: TaskSubmission, media_dir: Path) -> IngestionResult:
        if submission.source_type == "bilibili":
            return download_bilibili_video(submission.task_id, submission.source_input, media_dir)

        if not submission.source_local_path:
            raise ValueError("Missing local file path for local source")
        local_path = Path(submission.source_local_path)
        if not local_path.exists():
            raise FileNotFoundError(f"Local source missing: {local_path}")
        return prepare_local_video(submission.task_id, local_path, media_dir)

    def _validate_analysis_prerequisites(
        self,
        llm_runtime_config: dict[str, object],
        whisper_config: dict[str, object],
        selected_whisper_model: str | None = None,
    ) -> list[str]:
        _ = selected_whisper_model
        _ = whisper_config
        llm_api_key = str(llm_runtime_config.get("api_key", "")).strip()
        if not llm_api_key:
            raise ValueError("运行前检查失败：LLM API 缺少 api_key。")
        llm_base_url = (
            str(llm_runtime_config.get("base_url", self._settings.llm_base_url)).strip()
            or self._settings.llm_base_url
        )
        llm_ok, llm_reason = _probe_openai_compat_models_endpoint(
            base_url=llm_base_url,
            api_key=llm_api_key,
            timeout_seconds=6.0,
        )
        if not llm_ok:
            raise ValueError(f"运行前检查失败：LLM API 连通性检查未通过（{llm_reason}）。")
        return []

    async def _stage_start(
        self,
        task_id: str,
        stage: StageType,
        title: str,
        stage_logs: dict[str, list[str]],
        status: str | None = None,
        progress: int | None = None,
    ) -> None:
        await self._runtime_events.stage_start(
            task_id=task_id,
            stage=stage,
            title=title,
            stage_logs=stage_logs,
            status=status,
            progress=progress,
            update_task=self._update_task,
        )

    async def _stage_complete(
        self,
        task_id: str,
        stage: StageType,
        progress: int,
        stage_logs: dict[str, list[str]],
    ) -> None:
        await self._runtime_events.stage_complete(
            task_id=task_id,
            stage=stage,
            progress=progress,
            stage_logs=stage_logs,
            update_task=self._update_task,
        )

    async def _d_substage_start(
        self,
        task_id: str,
        substage: DSubstageType,
        *,
        progress: int | None = None,
    ) -> None:
        await self._runtime_events.d_substage_start(
            task_id=task_id,
            substage=substage,
            progress=progress,
        )

    async def _d_substage_complete(
        self,
        task_id: str,
        substage: DSubstageType,
        *,
        status: Literal["completed", "skipped", "failed"] = "completed",
        message: str = "",
        progress: int | None = None,
    ) -> None:
        await self._runtime_events.d_substage_complete(
            task_id=task_id,
            substage=substage,
            status=status,
            message=message,
            progress=progress,
        )

    async def _emit_log(
        self,
        task_id: str,
        stage: StageType,
        message: str,
        stage_logs: dict[str, list[str]],
        substage: str | None = None,
    ) -> None:
        await self._runtime_events.emit_log(
            task_id=task_id,
            stage=stage,
            message=message,
            stage_logs=stage_logs,
            substage=substage,
        )

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
        await self._runtime_events.emit_runtime_warning(
            task_id=task_id,
            stage=stage,
            message=message,
            stage_logs=stage_logs,
            code=code,
            component=component,
            action=action,
            substage=substage,
        )

    def _stage_elapsed_seconds(self, task_id: str, stage: StageType) -> float | None:
        return self._runtime_events.stage_elapsed_seconds(task_id, stage)

    def _mark_stage_started(self, task_id: str, stage: StageType) -> None:
        self._runtime_events.mark_stage_started(task_id, stage)

    def _mark_stage_completed(self, task_id: str, stage: StageType) -> None:
        self._runtime_events.mark_stage_completed(task_id, stage)

    def _mark_stage_failed(self, task_id: str, stage: StageType, reason: str) -> None:
        self._runtime_events.mark_stage_failed(task_id, stage, reason)

    def _ensure_d_substage_metric_entry(
        self, task_id: str, substage: DSubstageType
    ) -> dict[str, object]:
        return self._runtime_events.ensure_d_substage_metric_entry(task_id, substage)

    def _mark_d_substage_started(self, task_id: str, substage: DSubstageType) -> None:
        self._runtime_events.mark_d_substage_started(task_id, substage)

    def _mark_d_substage_completed(self, task_id: str, substage: DSubstageType) -> None:
        self._runtime_events.mark_d_substage_completed(task_id, substage)

    def _mark_d_substage_skipped(
        self, task_id: str, substage: DSubstageType, reason: str = ""
    ) -> None:
        self._runtime_events.mark_d_substage_skipped(task_id, substage, reason)

    def _mark_d_substage_failed(self, task_id: str, substage: DSubstageType, reason: str) -> None:
        self._runtime_events.mark_d_substage_failed(task_id, substage, reason)

    def _increment_stage_log_count(self, task_id: str, stage: StageType) -> None:
        self._runtime_events.increment_stage_log_count(task_id, stage)

    def _set_stage_metric_values(
        self, task_id: str, stage: StageType, values: dict[str, object]
    ) -> None:
        self._runtime_events.set_stage_metric_values(task_id, stage, values)

    def _record_runtime_lease(self, task_id: str, stage: StageType, wait_seconds: float) -> None:
        self._runtime_events.record_runtime_lease(task_id, stage, wait_seconds)

    async def _handle_runtime_evictions(
        self,
        task_id: str,
        stage: StageType,
        evictions: tuple[RuntimeEviction, ...],
        stage_logs: dict[str, list[str]],
    ) -> None:
        await self._runtime_events.handle_runtime_evictions(
            task_id=task_id,
            stage=stage,
            evictions=evictions,
            stage_logs=stage_logs,
            evict_runtime_model=self._evict_runtime_model,
        )

    def _evict_runtime_model(self, eviction: RuntimeEviction) -> bool:
        if eviction.component == "asr":
            self._transcriber.release_runtime_models()
            return True
        if eviction.component == "llm":
            self._summarizer.release_runtime_models()
            return True
        return False

    def _select_mode_semaphore(self, mode: ExecutionMode) -> asyncio.Semaphore:
        _ = mode
        return self._api_mode_semaphore

    def _ensure_task_stage_metric_entry(self, task_id: str, stage: StageType) -> dict[str, object]:
        return self._runtime_events.ensure_task_stage_metric_entry(task_id, stage)

    async def _persist_stage_metric(self, task_id: str, stage: StageType) -> None:
        await self._runtime_events.persist_stage_metric(task_id, stage)

    async def _persist_analysis_result(
        self,
        task_id: str,
        stage: StageType,
        *,
        status: str,
        progress: int,
        reason: str | None = None,
    ) -> None:
        await self._runtime_events.persist_analysis_result(
            task_id,
            stage,
            status=status,
            progress=progress,
            reason=reason,
        )

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
        await self._artifact_persistence.persist_runtime_warning(
            task_id=task_id,
            stage=stage,
            code=code,
            component=component,
            action=action,
            substage=substage,
            message=message,
            elapsed_seconds=elapsed_seconds,
        )

    async def _persist_stage_artifact_json(
        self,
        task_id: str,
        stage: str,
        relative_path: str,
        payload: object,
    ) -> None:
        await self._artifact_persistence.persist_stage_artifact_json(
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
        await self._artifact_persistence.persist_stage_artifact_text(
            task_id,
            stage,
            relative_path,
            text,
        )

    async def _persist_stage_artifact_chunk_json(
        self,
        task_id: str,
        stage: str,
        chunk_group: str,
        chunk_index: int,
        payload: object,
    ) -> str:
        return await self._artifact_persistence.persist_stage_artifact_chunk_json(
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
        await self._artifact_persistence.persist_transcript_optimization_artifacts(
            task_id=task_id,
            correction_mode=correction_mode,
            fallback_used=fallback_used,
            summary_source_text=summary_source_text,
            optimized_segments=optimized_segments,
            chunk_windows=chunk_windows,
        )

    async def _persist_delivery_artifacts(
        self,
        task_id: str,
        summary_markdown: str,
        notes_markdown: str,
        mindmap_markdown: str,
    ) -> None:
        await self._artifact_persistence.persist_delivery_artifacts(
            task_id,
            summary_markdown,
            notes_markdown,
            mindmap_markdown,
        )

    async def _persist_notes_pipeline_artifacts(
        self,
        *,
        task_id: str,
        notes_artifacts: NotesPipelineArtifacts,
        notes_before_patch: str,
    ) -> None:
        await self._artifact_persistence.persist_notes_pipeline_artifacts(
            task_id=task_id,
            evidence_batches=notes_artifacts.evidence_batches,
            evidence_cards=notes_artifacts.evidence_cards,
            outline=notes_artifacts.outline,
            outline_markdown=notes_artifacts.outline_markdown,
            section_markdowns=notes_artifacts.section_markdowns,
            coverage_report=notes_artifacts.coverage_report,
            notes_before_patch=notes_before_patch,
            notes_after_patch=notes_artifacts.notes_markdown,
        )

    async def _publish_markdown_stream_compat(
        self,
        task_id: str,
        event_type: str,
        text: str,
    ) -> None:
        normalized = (text or "").strip()
        if not normalized:
            return
        await self._event_bus.publish(
            task_id,
            {"type": event_type, "stage": "D", "text": normalized, "stream_mode": "compat"},
        )

    async def _generate_stage_d_outputs(
        self,
        *,
        task_id: str,
        task_title: str,
        notes_source_text: str,
        transcript_segments: list[dict[str, float | str]],
        llm_runtime_config: dict[str, object],
        llm_model_id: str,
        stage_logs: dict[str, list[str]],
    ) -> SummaryBundle:
        async with self._model_runtime_manager.reserve(
            task_id=task_id,
            stage="D",
            component="llm",
            model_id=f"llm:{llm_model_id}",
        ) as llm_generate_lease:
            self._record_runtime_lease(task_id, "D", llm_generate_lease.wait_seconds)
            await self._handle_runtime_evictions(
                task_id, "D", llm_generate_lease.evictions, stage_logs
            )
            if llm_generate_lease.wait_seconds > 0:
                await self._emit_log(
                    task_id,
                    "D",
                    f"Waiting for model runtime lock: {llm_generate_lease.wait_seconds:.2f}s",
                    stage_logs,
                    substage="runtime",
                )

            async def notes_delta(delta: str, stream_mode: str) -> None:
                await self._event_bus.publish(
                    task_id,
                    {
                        "type": "notes_delta",
                        "stage": "D",
                        "text": delta,
                        "stream_mode": stream_mode,
                    },
                )

            async def mindmap_delta(delta: str, stream_mode: str) -> None:
                await self._event_bus.publish(
                    task_id,
                    {
                        "type": "mindmap_delta",
                        "stage": "D",
                        "text": delta,
                        "stream_mode": stream_mode,
                    },
                )

            async def publish_fusion_prompt_preview(markdown: str) -> None:
                await self._publish_fusion_prompt_preview(task_id, markdown)

            (
                summary_prompt,
                notes_prompt,
                mindmap_prompt,
            ) = await self._summarizer._prompt_template_store.resolve_selected_prompts()

            await self._d_substage_start(
                task_id, "notes_extract", progress=_PROGRESS_TRANSCRIPT_DONE
            )
            await self._emit_log(
                task_id,
                "D",
                "Extracting detailed note evidence cards directly from the full transcript (no summary compression)...",
                stage_logs,
                substage="notes_extract",
            )
            cards_bundle = await self._summarizer.build_notes_evidence_cards(
                title=task_title,
                transcript_text=notes_source_text,
                transcript_segments=transcript_segments,
                llm_config_override=llm_runtime_config,
            )
            await self._d_substage_complete(
                task_id,
                "notes_extract",
                status="completed",
                message="信息卡片提取完成。",
                progress=_PROGRESS_NOTES_EXTRACT_DONE,
            )
            self._set_stage_metric_values(
                task_id,
                "D",
                {
                    "notes_extract_batch_count": len(cards_bundle["evidence_batches"]),
                    "notes_extract_card_count": len(cards_bundle["evidence_cards"]),
                },
            )
            await self._update_task(
                task_id,
                progress=_PROGRESS_NOTES_EXTRACT_DONE,
                stage_logs_json=_encode_stage_logs(stage_logs),
            )

            await self._d_substage_start(
                task_id, "notes_outline", progress=_PROGRESS_NOTES_EXTRACT_DONE
            )
            await self._emit_log(
                task_id,
                "D",
                "Building global outline for detailed notes...",
                stage_logs,
                substage="notes_outline",
            )
            outline, outline_markdown = await self._summarizer.build_notes_outline(
                title=task_title,
                evidence_cards=cards_bundle["evidence_cards"],
                llm_config_override=llm_runtime_config,
            )
            await self._d_substage_complete(
                task_id,
                "notes_outline",
                status="completed",
                message="详细笔记提纲生成完成。",
                progress=_PROGRESS_NOTES_OUTLINE_DONE,
            )
            self._set_stage_metric_values(
                task_id,
                "D",
                {
                    "notes_outline_section_count": len(outline.get("sections", []))
                    if isinstance(outline.get("sections"), list)
                    else 0,
                },
            )
            await self._update_task(
                task_id,
                progress=_PROGRESS_NOTES_OUTLINE_DONE,
                stage_logs_json=_encode_stage_logs(stage_logs),
            )

            await self._d_substage_start(
                task_id, "notes_sections", progress=_PROGRESS_NOTES_OUTLINE_DONE
            )
            await self._emit_log(
                task_id,
                "D",
                "Generating detailed notes by outline sections...",
                stage_logs,
                substage="notes_sections",
            )
            notes_before_patch, section_markdowns = await self._summarizer.generate_notes_sections(
                title=task_title,
                notes_prompt=notes_prompt,
                evidence_cards=cards_bundle["evidence_cards"],
                outline=outline,
                outline_markdown=outline_markdown,
                llm_config_override=llm_runtime_config,
                on_notes_delta=notes_delta,
                on_fusion_prompt_preview=publish_fusion_prompt_preview,
            )
            await self._d_substage_complete(
                task_id,
                "notes_sections",
                status="completed",
                message="详细笔记章节生成完成。",
                progress=_PROGRESS_NOTES_SECTIONS_DONE,
            )
            self._set_stage_metric_values(
                task_id,
                "D",
                {
                    "notes_sections_count": len(section_markdowns),
                    "notes_chars_before_coverage": len(notes_before_patch),
                },
            )
            await self._update_task(
                task_id,
                progress=_PROGRESS_NOTES_SECTIONS_DONE,
                stage_logs_json=_encode_stage_logs(stage_logs),
            )

            await self._d_substage_start(
                task_id, "notes_coverage", progress=_PROGRESS_NOTES_SECTIONS_DONE
            )
            await self._emit_log(
                task_id,
                "D",
                "Inspecting detailed notes coverage and patching gaps...",
                stage_logs,
                substage="notes_coverage",
            )
            coverage_report = await self._summarizer.inspect_notes_coverage(
                title=task_title,
                evidence_cards=cards_bundle["evidence_cards"],
                outline=outline,
                outline_markdown=outline_markdown,
                notes_markdown=notes_before_patch,
                llm_config_override=llm_runtime_config,
            )
            final_notes = await self._summarizer.patch_notes_coverage(
                title=task_title,
                outline_markdown=outline_markdown,
                notes_markdown=notes_before_patch,
                coverage_report=coverage_report,
                llm_config_override=llm_runtime_config,
            )
            notes_artifacts = NotesPipelineArtifacts(
                evidence_batches=cards_bundle["evidence_batches"],
                evidence_cards=cards_bundle["evidence_cards"],
                outline=outline,
                outline_markdown=outline_markdown,
                section_markdowns=section_markdowns,
                coverage_report=coverage_report,
                notes_markdown=final_notes,
            )
            await self._persist_notes_pipeline_artifacts(
                task_id=task_id,
                notes_artifacts=notes_artifacts,
                notes_before_patch=notes_before_patch,
            )
            await self._d_substage_complete(
                task_id,
                "notes_coverage",
                status="completed",
                message="覆盖率检查与补全完成。",
                progress=_PROGRESS_NOTES_COVERAGE_DONE,
            )
            self._set_stage_metric_values(
                task_id,
                "D",
                {
                    "notes_coverage_missing_count": int(
                        coverage_report.get("missing_count", 0) or 0
                    ),
                    "notes_chars": len(notes_artifacts.notes_markdown),
                },
            )
            await self._update_task(
                task_id,
                progress=_PROGRESS_NOTES_COVERAGE_DONE,
                stage_logs_json=_encode_stage_logs(stage_logs),
            )

            await self._d_substage_start(
                task_id, "summary_delivery", progress=_PROGRESS_NOTES_COVERAGE_DONE
            )
            await self._emit_log(
                task_id,
                "D",
                "Generating concise summary from detailed notes...",
                stage_logs,
                substage="summary_delivery",
            )
            summary_markdown = await self._summarizer.generate_summary_from_notes(
                title=task_title,
                notes_markdown=notes_artifacts.notes_markdown,
                outline_markdown=notes_artifacts.outline_markdown,
                summary_prompt=summary_prompt,
                llm_config_override=llm_runtime_config,
                on_summary_delta=lambda delta, stream_mode: self._event_bus.publish(
                    task_id,
                    {
                        "type": "summary_delta",
                        "stage": "D",
                        "text": delta,
                        "stream_mode": stream_mode,
                    },
                ),
            )
            await self._d_substage_complete(
                task_id,
                "summary_delivery",
                status="completed",
                message="摘要生成完成。",
                progress=_PROGRESS_SUMMARY_DONE,
            )
            self._set_stage_metric_values(
                task_id,
                "D",
                {
                    "summary_chars": len(summary_markdown),
                },
            )
            await self._update_task(
                task_id,
                progress=_PROGRESS_SUMMARY_DONE,
                stage_logs_json=_encode_stage_logs(stage_logs),
            )

            await self._d_substage_start(
                task_id, "mindmap_delivery", progress=_PROGRESS_SUMMARY_DONE
            )
            await self._emit_log(
                task_id,
                "D",
                "Generating mindmap from outline and high-fidelity evidence cards...",
                stage_logs,
                substage="mindmap_delivery",
            )
            mindmap_markdown = await self._summarizer.generate_mindmap_from_notes(
                title=task_title,
                outline_markdown=notes_artifacts.outline_markdown,
                notes_markdown=notes_artifacts.notes_markdown,
                evidence_cards=notes_artifacts.evidence_cards,
                mindmap_prompt=mindmap_prompt,
                llm_config_override=llm_runtime_config,
                on_mindmap_delta=mindmap_delta,
            )
            await self._d_substage_complete(
                task_id,
                "mindmap_delivery",
                status="completed",
                message="思维导图生成完成。",
                progress=_PROGRESS_MINDMAP_DONE,
            )
            self._set_stage_metric_values(
                task_id,
                "D",
                {
                    "mindmap_chars": len(mindmap_markdown),
                },
            )
            await self._update_task(
                task_id,
                progress=_PROGRESS_MINDMAP_DONE,
                stage_logs_json=_encode_stage_logs(stage_logs),
            )

        bundle = SummaryBundle(
            summary_markdown=summary_markdown,
            notes_markdown=notes_artifacts.notes_markdown,
            mindmap_markdown=mindmap_markdown,
        )
        bundle = self._normalize_stage_d_bundle(
            title=task_title,
            transcript_text=notes_source_text,
            bundle=bundle,
        )
        await self._persist_delivery_artifacts(
            task_id,
            bundle.summary_markdown,
            bundle.notes_markdown,
            bundle.mindmap_markdown,
        )
        return bundle

    @staticmethod
    def _build_audio_chunk_windows(audio_chunks: list[AudioChunk]) -> list[dict[str, object]]:
        return TaskArtifactPersistenceService.build_audio_chunk_windows(audio_chunks)

    def _load_audio_chunk_windows_for_task(
        self,
        *,
        task_id: str,
        transcript_segments: list[dict[str, float | str]],
    ) -> list[dict[str, object]]:
        return self._artifact_persistence.load_audio_chunk_windows_for_task(
            task_id=task_id,
            transcript_segments=transcript_segments,
        )

    @staticmethod
    def _split_segments_by_chunk_windows(
        segments: list[dict[str, float | str]],
        chunk_windows: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        return TaskArtifactPersistenceService.split_segments_by_chunk_windows(
            segments=segments,
            chunk_windows=chunk_windows,
        )

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
        await self._persist_stage_artifact_text(
            task_id, "D", "fusion/fusion-prompt.md", normalized_text
        )
        await self._event_bus.publish(
            task_id,
            {
                "type": "fusion_prompt_preview",
                "stage": "D",
                "text": normalized_text,
            },
        )

    def _normalize_stage_d_bundle(
        self,
        *,
        title: str,
        transcript_text: str,
        bundle: SummaryBundle,
    ) -> SummaryBundle:
        summary_markdown = (bundle.summary_markdown or "").strip()
        notes_markdown = (bundle.notes_markdown or "").strip()
        mindmap_markdown = (bundle.mindmap_markdown or "").strip()

        if not summary_markdown:
            summary_markdown = self._build_fallback_summary_markdown(
                transcript_text=transcript_text
            )
        if not self._is_notes_markdown_structured(notes_markdown):
            notes_markdown = self._build_fallback_notes_markdown(
                title=title, summary_markdown=summary_markdown
            )
        notes_markdown = _ensure_single_markdown_title(notes_markdown, title)
        if not self._is_mindmap_markdown_valid(mindmap_markdown):
            mindmap_markdown = self._build_fallback_mindmap_markdown(
                title=title, summary_markdown=summary_markdown
            )

        return SummaryBundle(
            summary_markdown=summary_markdown,
            notes_markdown=notes_markdown,
            mindmap_markdown=mindmap_markdown,
        )

    @staticmethod
    def _is_notes_markdown_structured(markdown: str) -> bool:
        text = (markdown or "").strip()
        if not text:
            return False
        return "## " in text or text.startswith("# ")

    @staticmethod
    def _is_mindmap_markdown_valid(markdown: str) -> bool:
        text = (markdown or "").strip().lower()
        if not text:
            return False
        return (
            "```mindmap" in text
            or "```mermaid" in text
            or text.startswith("mindmap")
            or text.startswith("graph ")
            or text.startswith("flowchart ")
        )

    @staticmethod
    def _build_fallback_summary_markdown(*, transcript_text: str) -> str:
        normalized = (transcript_text or "").strip()
        lines = [line.strip() for line in normalized.splitlines() if line.strip()]
        preview = "\n".join(lines[:12]).strip() if lines else "无可用转录内容。"
        return (
            "## 核心摘要\n\n"
            f"{preview}\n\n"
            "## 后续建议\n\n"
            "- 建议复核关键术语与时间点\n"
            "- 建议补充业务上下文后再次生成\n"
        )

    @staticmethod
    def _build_fallback_notes_markdown(*, title: str, summary_markdown: str) -> str:
        normalized_title = (title or "").strip() or "任务笔记"
        normalized_summary = _normalize_single_markdown_title(
            summary_markdown or "", normalized_title, demote_extra_h1=True
        )
        if normalized_summary.startswith("# "):
            normalized_summary = "\n".join(normalized_summary.splitlines()[1:]).strip()
        return (
            f"# {normalized_title}\n\n"
            "## 关键内容\n\n"
            f"{normalized_summary or '暂无可用内容。'}\n\n"
            "## 行动项\n\n"
            "- [ ] 校对摘要结构\n"
            "- [ ] 补充重点结论\n"
        )

    @staticmethod
    def _build_fallback_mindmap_markdown(*, title: str, summary_markdown: str) -> str:
        normalized_title = (title or "").strip() or "任务分析"
        lines = [
            line.strip("- ").strip()
            for line in (summary_markdown or "").splitlines()
            if line.strip()
        ]
        branch_1 = lines[0] if lines else "核心观点"
        branch_2 = lines[1] if len(lines) > 1 else "关键事实"
        branch_3 = lines[2] if len(lines) > 2 else "行动建议"
        return (
            "```mindmap\n"
            "mindmap\n"
            f"  root(({normalized_title}))\n"
            f"    {branch_1}\n"
            f"    {branch_2}\n"
            f"    {branch_3}\n"
            "```\n"
        )

    async def _update_task(self, task_id: str, **fields) -> None:
        if "stage_metrics_json" not in fields:
            stage_metrics_json = self._runtime_events.stage_metrics_json(task_id)
            if stage_metrics_json is not None:
                fields["stage_metrics_json"] = stage_metrics_json

        def _write() -> None:
            self._task_store.update(task_id, **fields)

        await asyncio.to_thread(_write)

    async def _mark_cancelled(
        self, task_id: str, *, emit_event: bool, cleanup_media_dir: bool
    ) -> bool:
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
        if changed and emit_event:
            await self._event_bus.publish(
                task_id, {"type": "task_cancelled", "error": "Task cancelled by user."}
            )
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
            "runtime_eviction_count": 0,
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


def _format_stage_log_line(
    message: str, *, substage: str | None, elapsed_seconds: float | None
) -> str:
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


def _normalize_single_markdown_title(markdown: str, title: str, *, demote_extra_h1: bool) -> str:
    normalized = (markdown or "").strip()
    normalized_title = (title or "").strip() or "任务笔记"
    if not normalized:
        return f"# {normalized_title}"
    lines = normalized.splitlines()
    first_index = next((index for index, line in enumerate(lines) if line.strip()), -1)
    if first_index < 0:
        return f"# {normalized_title}"
    if not lines[first_index].strip().startswith("# "):
        lines.insert(first_index, f"# {normalized_title}")
    result_lines: list[str] = []
    primary_seen = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("# "):
            if not primary_seen:
                primary_seen = True
                result_lines.append(line)
                continue
            if demote_extra_h1:
                result_lines.append(line.replace("# ", "## ", 1))
            continue
        result_lines.append(line)
    return "\n".join(result_lines).strip()


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


def _probe_openai_compat_models_endpoint(
    *, base_url: str, api_key: str, timeout_seconds: float
) -> tuple[bool, str]:
    normalized_base_url = str(base_url).strip().rstrip("/")
    if not normalized_base_url:
        return (False, "missing base_url")
    endpoint = f"{normalized_base_url}/models"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "User-Agent": "VidGnost/RuntimePrecheck",
    }
    request = urllib.request.Request(endpoint, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=max(1.0, float(timeout_seconds))) as response:
            status_code = int(getattr(response, "status", 200))
            if 200 <= status_code < 400:
                return (True, f"HTTP {status_code}")
            return (False, f"HTTP {status_code}")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            # Some OpenAI-compatible providers may not expose /models but endpoint is reachable.
            return (True, "HTTP 404")
        if exc.code in {401, 403}:
            return (False, f"HTTP {exc.code} (authentication rejected)")
        return (False, f"HTTP {exc.code}")
    except urllib.error.URLError as exc:
        return (
            False,
            f"{type(exc.reason).__name__ if getattr(exc, 'reason', None) is not None else type(exc).__name__}: {exc.reason if getattr(exc, 'reason', None) is not None else exc}",
        )
    except Exception as exc:  # noqa: BLE001
        return (False, f"{type(exc).__name__}: {exc}")


def _join_transcript_segment_texts(segments: list[dict[str, float | str]]) -> str:
    lines: list[str] = []
    for segment in segments:
        text = str(segment.get("text", "")).strip()
        if text:
            lines.append(text)
    return "\n".join(lines).strip()
