from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

import orjson

from app.config import get_settings
from app.runtime_stdio import enable_windows_utf8_stdio
from app.services.transcription import WhisperService

_WORKER_EVENT_PREFIX = "@@VIDGNOST_GPU_WORKER@@ "


def main() -> int:
    enable_windows_utf8_stdio()
    parser = argparse.ArgumentParser(description="VidGnost GPU stage worker")
    parser.add_argument("--request", help="Path to the worker request JSON file.")
    args = parser.parse_args()

    try:
        request = _load_request(args.request)
        operation = str(request.get("operation", "") or "").strip().lower()
        if operation == "whisper_transcribe_stage":
            asyncio.run(_run_whisper_transcribe_stage(dict(request.get("payload") or {})))
            return 0
        raise RuntimeError(f"Unsupported GPU worker operation: {operation or 'unknown'}")
    except Exception as exc:  # noqa: BLE001
        _emit(
            {
                "type": "error",
                "error_type": type(exc).__name__,
                "message": str(exc),
            }
        )
        return 1


def _load_request(raw_path: str | None) -> dict[str, object]:
    if raw_path:
        path = Path(raw_path).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"GPU worker request not found: {path}")
        payload = orjson.loads(path.read_bytes())
    else:
        payload = orjson.loads(sys.stdin.buffer.read())
    if not isinstance(payload, dict):
        raise RuntimeError("GPU worker request payload is invalid.")
    return payload


async def _run_whisper_transcribe_stage(payload: dict[str, object]) -> None:
    settings = get_settings()
    whisper_service = WhisperService(settings)
    chunks = payload.get("chunks")
    if not isinstance(chunks, list) or not chunks:
        raise RuntimeError("Whisper GPU worker received no chunks to transcribe.")

    whisper_config = dict(payload.get("whisper_config") or {})
    selected_model = str(payload.get("selected_model", "small") or "small").strip() or "small"
    selected_language = str(payload.get("selected_language", "") or "").strip() or None
    task_id = str(payload.get("task_id", "") or "").strip() or "unknown-task"
    total_chunks = len(chunks)
    detected_language = ""

    try:
        for worker_position, chunk in enumerate(chunks, start=1):
            chunk_payload = dict(chunk) if isinstance(chunk, dict) else {}
            chunk_index = int(chunk_payload.get("chunk_index", worker_position - 1) or 0)
            chunk_path = Path(str(chunk_payload.get("path", "") or "")).expanduser()
            if not chunk_path.exists():
                raise FileNotFoundError(f"Audio chunk does not exist: {chunk_path}")
            chunk_start = _to_float(chunk_payload.get("start_seconds"))
            chunk_duration = max(0.0, _to_float(chunk_payload.get("duration_seconds")))

            _emit(
                {
                    "type": "chunk_start",
                    "task_id": task_id,
                    "chunk_index": chunk_index,
                    "chunk_total": total_chunks,
                    "worker_position": worker_position,
                    "file_name": chunk_path.name,
                    "start_seconds": round(chunk_start, 2),
                    "duration_seconds": round(chunk_duration, 2),
                }
            )

            def on_segment(segment: dict[str, float | str]) -> None:
                _emit(
                    {
                        "type": "segment",
                        "task_id": task_id,
                        "chunk_index": chunk_index,
                        "chunk_total": total_chunks,
                        "worker_position": worker_position,
                        "segment": segment,
                    }
                )

            result = await whisper_service.transcribe(
                audio_path=chunk_path,
                model_size=selected_model,
                language=selected_language,
                model_default=str(whisper_config.get("model_default", "small") or "small"),
                device=str(whisper_config.get("device", "auto") or "auto"),
                compute_type=str(whisper_config.get("compute_type", "int8") or "int8"),
                beam_size=int(whisper_config.get("beam_size", 5) or 5),
                vad_filter=bool(whisper_config.get("vad_filter", True)),
                model_load_profile=str(whisper_config.get("model_load_profile", "balanced") or "balanced"),
                timestamp_offset_seconds=chunk_start,
                on_segment=on_segment,
            )
            if result.language and not detected_language:
                detected_language = str(result.language).strip()
            _emit(
                {
                    "type": "chunk_complete",
                    "task_id": task_id,
                    "chunk_index": chunk_index,
                    "chunk_total": total_chunks,
                    "worker_position": worker_position,
                    "file_name": chunk_path.name,
                    "start_seconds": round(chunk_start, 2),
                    "duration_seconds": round(chunk_duration, 2),
                    "end_seconds": round(chunk_start + chunk_duration, 2),
                    "segments": result.segments,
                    "segment_count": len(result.segments),
                    "language": result.language,
                }
            )
    finally:
        whisper_service.shutdown()

    _emit(
        {
            "type": "completed",
            "result": {
                "task_id": task_id,
                "chunk_count": total_chunks,
                "language": detected_language or (selected_language or ""),
            },
        }
    )


def _emit(payload: dict[str, object]) -> None:
    sys.stdout.write(f"{_WORKER_EVENT_PREFIX}{orjson.dumps(payload).decode('utf-8')}\n")
    sys.stdout.flush()


def _to_float(value: object) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


if __name__ == "__main__":
    raise SystemExit(main())
