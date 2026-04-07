from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from app.services.stage_artifact_store import StageArtifactStore
from app.services.task_store import TaskStore


class TaskArtifactPersistenceService:
    def __init__(self, *, task_store: TaskStore, stage_artifact_store: StageArtifactStore) -> None:
        self._task_store = task_store
        self._stage_artifact_store = stage_artifact_store

    async def persist_runtime_warning(
        self,
        *,
        task_id: str,
        stage: str,
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

    async def persist_stage_artifact_json(
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

    async def persist_stage_artifact_text(
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

    async def persist_stage_artifact_chunk_json(
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

    async def persist_transcript_optimization_artifacts(
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
                "end": round(
                    max(_to_float(segment.get("start")), _to_float(segment.get("end"))), 2
                ),
                "text": str(segment.get("text", "")).strip(),
            }
            for segment in optimized_segments
            if isinstance(segment, dict)
        ]
        grouped_chunks = self.split_segments_by_chunk_windows(normalized_segments, chunk_windows)
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
            relative_path = await self.persist_stage_artifact_chunk_json(
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
        await self.persist_stage_artifact_text(
            task_id,
            "D",
            "transcript-optimize/full.txt",
            (summary_source_text or "").strip(),
        )
        await self.persist_stage_artifact_json(
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

    async def persist_delivery_artifacts(
        self,
        task_id: str,
        summary_markdown: str,
        notes_markdown: str,
        mindmap_markdown: str,
    ) -> None:
        await self.persist_stage_artifact_text(
            task_id, "D", "fusion/summary.md", summary_markdown or ""
        )
        await self.persist_stage_artifact_text(
            task_id, "D", "fusion/notes.md", notes_markdown or ""
        )
        await self.persist_stage_artifact_text(
            task_id, "D", "fusion/mindmap.md", mindmap_markdown or ""
        )
        await self.persist_stage_artifact_json(
            task_id,
            "D",
            "fusion/index.json",
            {
                "task_id": task_id,
                "summary_chars": len(summary_markdown or ""),
                "notes_chars": len(notes_markdown or ""),
                "mindmap_chars": len(mindmap_markdown or ""),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    async def persist_notes_pipeline_artifacts(
        self,
        *,
        task_id: str,
        evidence_batches: list[dict[str, object]],
        evidence_cards: list[dict[str, object]],
        outline: dict[str, object],
        outline_markdown: str,
        section_markdowns: list[dict[str, object]],
        coverage_report: dict[str, object],
        notes_before_patch: str,
        notes_after_patch: str,
    ) -> None:
        chunk_manifest: list[dict[str, object]] = []
        for index, (batch, card) in enumerate(
            zip(evidence_batches, evidence_cards, strict=False), start=1
        ):
            payload = {
                "task_id": task_id,
                "chunk_index": index,
                "batch": batch,
                "card": card,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            relative_path = await self.persist_stage_artifact_chunk_json(
                task_id,
                "D",
                "notes-extract/chunks",
                index - 1,
                payload,
            )
            chunk_manifest.append(
                {
                    "chunk_index": index,
                    "relative_path": relative_path,
                    "batch_id": int(batch.get("batch_id", index) or index),
                }
            )

        await self.persist_stage_artifact_json(
            task_id,
            "D",
            "notes-extract/index.json",
            {
                "task_id": task_id,
                "chunk_count": len(chunk_manifest),
                "chunks": chunk_manifest,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await self.persist_stage_artifact_json(task_id, "D", "notes-outline/outline.json", outline)
        await self.persist_stage_artifact_text(
            task_id, "D", "notes-outline/outline.md", outline_markdown or ""
        )

        section_index_payload: list[dict[str, object]] = []
        for index, section in enumerate(section_markdowns, start=1):
            markdown = str(section.get("markdown", "")).strip()
            relative_path = f"notes-sections/section-{index:02d}.md"
            await self.persist_stage_artifact_text(task_id, "D", relative_path, markdown)
            section_index_payload.append(
                {
                    "section_index": index,
                    "section_id": str(section.get("section_id", "")).strip() or f"section_{index}",
                    "section_title": str(section.get("section_title", "")).strip()
                    or f"章节 {index}",
                    "relative_path": relative_path,
                    "source_batch_ids": section.get("source_batch_ids", []),
                }
            )

        await self.persist_stage_artifact_json(
            task_id,
            "D",
            "notes-sections/index.json",
            {
                "task_id": task_id,
                "section_count": len(section_index_payload),
                "sections": section_index_payload,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await self.persist_stage_artifact_json(
            task_id, "D", "notes-coverage/report.json", coverage_report
        )
        await self.persist_stage_artifact_text(
            task_id, "D", "notes-coverage/notes-before-patch.md", notes_before_patch or ""
        )
        await self.persist_stage_artifact_text(
            task_id, "D", "notes-coverage/notes-after-patch.md", notes_after_patch or ""
        )

    @staticmethod
    def build_audio_chunk_windows(audio_chunks: list[Any]) -> list[dict[str, object]]:
        windows: list[dict[str, object]] = []
        for index, chunk in enumerate(audio_chunks, start=1):
            start_seconds = round(max(0.0, float(getattr(chunk, "start_seconds", 0.0))), 2)
            duration_seconds = round(max(0.0, float(getattr(chunk, "duration_seconds", 0.0))), 2)
            end_seconds = round(start_seconds + duration_seconds, 2)
            windows.append(
                {
                    "chunk_index": index,
                    "start_seconds": start_seconds,
                    "end_seconds": end_seconds,
                }
            )
        return windows

    def load_audio_chunk_windows_for_task(
        self,
        *,
        task_id: str,
        transcript_segments: list[dict[str, float | str]],
    ) -> list[dict[str, object]]:
        payload = self._stage_artifact_store.read_json(
            task_id, "C", "transcript/index.json", default={}
        )
        if isinstance(payload, dict):
            chunks_payload = payload.get("chunks")
            if isinstance(chunks_payload, list):
                windows: list[dict[str, object]] = []
                for item in chunks_payload:
                    if not isinstance(item, dict):
                        continue
                    windows.append(
                        {
                            "chunk_index": int(
                                item.get("index", len(windows) + 1) or (len(windows) + 1)
                            ),
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
        return [
            {
                "chunk_index": 1,
                "start_seconds": start_seconds,
                "end_seconds": max(start_seconds, end_seconds),
            }
        ]

    @staticmethod
    def split_segments_by_chunk_windows(
        segments: list[dict[str, float | str]],
        chunk_windows: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        windows = [window for window in chunk_windows if isinstance(window, dict)]
        if not windows:
            windows = [{"chunk_index": 1, "start_seconds": 0.0, "end_seconds": 0.0}]
        windows.sort(
            key=lambda item: (
                int(item.get("chunk_index", 0) or 0),
                _to_float(item.get("start_seconds")),
            )
        )
        grouped: list[dict[str, object]] = [
            {
                "chunk_index": int(window.get("chunk_index", index + 1) or (index + 1)),
                "start_seconds": round(_to_float(window.get("start_seconds")), 2),
                "end_seconds": round(
                    max(
                        _to_float(window.get("start_seconds")), _to_float(window.get("end_seconds"))
                    ),
                    2,
                ),
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
                "end": round(
                    max(_to_float(segment.get("start")), _to_float(segment.get("end"))), 2
                ),
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


def _to_float(value: object) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _join_transcript_segment_texts(segments: list[dict[str, float | str]]) -> str:
    lines: list[str] = []
    for segment in segments:
        text = str(segment.get("text", "")).strip()
        if text:
            lines.append(text)
    return "\n".join(lines).strip()
