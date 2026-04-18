import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "--probe":
        return run_probe()
    if len(sys.argv) >= 2 and sys.argv[1] == "--worker":
        return run_worker()
    if len(sys.argv) < 2:
        write_json({"error": "missing request path"})
        return 1

    request_path = Path(sys.argv[1])
    payload = json.loads(request_path.read_text(encoding="utf-8"))
    result = transcribe_request(payload, {})
    write_json(result)
    return 0 if not result.get("error") else 1


def run_probe() -> int:
    response = {
        "python": sys.version.split()[0],
        "ready": False,
    }
    try:
        import faster_whisper

        response["faster_whisper"] = getattr(faster_whisper, "__version__", "installed")
    except Exception as error:
        response["faster_whisper"] = f"missing:{error}"
        write_json(response)
        return 0

    try:
        import ctranslate2

        response["ctranslate2"] = getattr(ctranslate2, "__version__", "installed")
    except Exception as error:
        response["ctranslate2"] = f"missing:{error}"
        write_json(response)
        return 0

    response["ready"] = True
    write_json(response)
    return 0


def run_worker() -> int:
    model_cache = {}
    for raw_line in sys.stdin:
        line = str(raw_line or "").strip()
        if not line:
            continue

        request_id = ""
        try:
            payload = json.loads(line)
            request_id = str(payload.get("request_id") or "").strip()
            if str(payload.get("type") or "").strip() != "transcribe":
                write_json(
                    {
                        "request_id": request_id,
                        "type": "error",
                        "error": "unsupported request type",
                    }
                )
                continue

            write_json({"request_id": request_id, "type": "started"})
            result = transcribe_request(payload, model_cache, request_id=request_id, stream_segments=True)
            if result.get("error"):
                write_json(
                    {
                        "request_id": request_id,
                        "type": "error",
                        "error": str(result.get("error") or "faster-whisper worker error"),
                    }
                )
                continue

            write_json(
                {
                    "request_id": request_id,
                    "type": "completed",
                    "language": result.get("language", ""),
                    "device": result.get("device", ""),
                    "compute_type": result.get("compute_type", ""),
                    "text": result.get("text", ""),
                }
            )
        except Exception as error:
            write_json(
                {
                    "request_id": request_id,
                    "type": "error",
                    "error": str(error),
                }
            )
    return 0


def transcribe_request(payload, model_cache, *, request_id="", stream_segments=False):
    try:
        from faster_whisper import WhisperModel
    except Exception as error:
        return {"error": f"failed to import faster_whisper: {error}"}

    requested_device = str(payload.get("device") or "auto").strip().lower()
    requested_compute_type = str(payload.get("compute_type") or "int8").strip().lower()
    model_path = str(payload.get("model_path") or "").strip()
    if not model_path:
        return {"error": "missing model path"}

    model, resolved_device, resolved_compute_type = get_cached_model(
        WhisperModel,
        model_cache,
        model_path=model_path,
        requested_device=requested_device,
        requested_compute_type=requested_compute_type,
    )
    segment_iter, info = model.transcribe(
        str(payload.get("audio_path") or ""),
        language=str(payload.get("language") or "").strip() or None,
        beam_size=max(1, int(payload.get("beam_size") or 5)),
        vad_filter=bool(payload.get("vad_filter", True)),
        condition_on_previous_text=False,
        word_timestamps=False,
    )

    segments = []
    texts = []
    for segment in segment_iter:
        text = str(getattr(segment, "text", "") or "").strip()
        if not text:
            continue
        normalized_segment = {
            "start": round(float(getattr(segment, "start", 0.0) or 0.0), 3),
            "end": round(float(getattr(segment, "end", 0.0) or 0.0), 3),
            "text": text,
        }
        segments.append(normalized_segment)
        texts.append(text)
        if stream_segments and request_id:
            write_json(
                {
                    "request_id": request_id,
                    "type": "segment",
                    **normalized_segment,
                }
            )

    return {
        "language": str(getattr(info, "language", "") or payload.get("language") or ""),
        "segments": segments,
        "text": "\n".join(texts).strip(),
        "device": resolved_device,
        "compute_type": resolved_compute_type,
    }


def get_cached_model(
    whisper_model_cls,
    model_cache,
    *,
    model_path: str,
    requested_device: str,
    requested_compute_type: str,
):
    cache_key = (model_path, requested_device, requested_compute_type)
    cached = model_cache.get(cache_key)
    if cached is not None:
        return cached

    model = create_model(
        whisper_model_cls,
        model_path=model_path,
        requested_device=requested_device,
        requested_compute_type=requested_compute_type,
    )
    model_cache[cache_key] = model
    return model


def create_model(whisper_model_cls, *, model_path: str, requested_device: str, requested_compute_type: str):
    attempts = build_attempts(requested_device, requested_compute_type)
    errors = []
    for device, compute_type in attempts:
        try:
            model = whisper_model_cls(model_path, device=device, compute_type=compute_type)
            return model, device, compute_type
        except Exception as error:
            errors.append(f"{device}/{compute_type}: {error}")
    raise RuntimeError("; ".join(errors))


def build_attempts(requested_device: str, requested_compute_type: str):
    if requested_device == "cuda":
        return [("cuda", requested_compute_type)]
    if requested_device == "cpu":
        return [("cpu", normalize_cpu_compute_type(requested_compute_type))]
    return [
        ("cuda", requested_compute_type),
        ("cpu", normalize_cpu_compute_type(requested_compute_type)),
    ]


def normalize_cpu_compute_type(requested_compute_type: str) -> str:
    if requested_compute_type in {"float32", "int8"}:
        return requested_compute_type
    return "int8"


def write_json(payload) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
