from __future__ import annotations

import asyncio
import gc
import math
import os
import shutil
import threading
import time
from collections.abc import Awaitable, Callable
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

import httpx
import orjson

from app.config import Settings


@dataclass(slots=True)
class TranscriptionResult:
    text: str
    segments: list[dict[str, float | str]]
    language: str | None


LoadProfile = str
ModelPrepareProgressPayload = dict[str, object]
ModelPrepareProgressCallback = Callable[[ModelPrepareProgressPayload], Awaitable[None] | None]


class WhisperService:
    _MODEL_REPO_ID = "Systran/faster-whisper-small"
    _MODEL_REVISION = "main"
    _MODEL_DIR_NAME = "faster-whisper-small"
    _READY_MARKER = ".ready.json"
    _REQUIRED_MODEL_FILES = (
        "config.json",
        "model.bin",
        "tokenizer.json",
        "vocabulary.txt",
    )
    _DOWNLOAD_CHUNK_SIZE = 1024 * 256
    _RANGE_SEGMENT_THRESHOLD_BYTES = 64 * 1024 * 1024
    _RANGE_SEGMENT_TARGET_BYTES = 32 * 1024 * 1024

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._models: OrderedDict[str, object] = OrderedDict()
        self._models_lock = threading.Lock()
        self._max_cached_models = max(1, settings.max_cached_whisper_models)
        self._download_root = Path(settings.storage_dir) / "model-hub"
        self._download_root.mkdir(parents=True, exist_ok=True)
        self._prepare_lock = asyncio.Lock()

    async def ensure_small_model_ready(
        self,
        on_progress: ModelPrepareProgressCallback | None = None,
        force_redownload: bool = False,
    ) -> None:
        await self._emit_prepare_progress(
            on_progress,
            {
                "status": "checking",
                "message": "Checking local Whisper small model cache...",
                "current_file": "",
                "downloaded_bytes": 0,
                "total_bytes": 0,
                "percent": 0.0,
            },
        )
        if self.is_small_model_ready() and not force_redownload:
            await self._emit_prepare_progress(
                on_progress,
                {
                    "status": "cached",
                    "message": "Whisper small model cache is ready.",
                    "current_file": "",
                    "downloaded_bytes": 0,
                    "total_bytes": 0,
                    "percent": 100.0,
                },
            )
            return

        async with self._prepare_lock:
            if self.is_small_model_ready() and not force_redownload:
                await self._emit_prepare_progress(
                    on_progress,
                    {
                        "status": "cached",
                        "message": "Whisper small model cache is ready.",
                        "current_file": "",
                        "downloaded_bytes": 0,
                        "total_bytes": 0,
                        "percent": 100.0,
                    },
                )
                return
            await self._download_small_model(on_progress)

    async def transcribe(
        self,
        audio_path: Path,
        model_size: str,
        language: str | None,
        model_default: str,
        device: str,
        compute_type: str,
        beam_size: int,
        vad_filter: bool,
        model_load_profile: str = "balanced",
        timestamp_offset_seconds: float = 0.0,
        on_segment: Callable[[dict[str, float | str]], None] | None = None,
    ) -> TranscriptionResult:
        return await asyncio.to_thread(
            self._transcribe_sync,
            audio_path,
            model_size,
            language,
            model_default,
            device,
            compute_type,
            beam_size,
            vad_filter,
            model_load_profile,
            timestamp_offset_seconds,
            on_segment,
        )

    def _transcribe_sync(
        self,
        audio_path: Path,
        model_size: str,
        language: str | None,
        model_default: str,
        device: str,
        compute_type: str,
        beam_size: int,
        vad_filter: bool,
        model_load_profile: str = "balanced",
        timestamp_offset_seconds: float = 0.0,
        on_segment: Callable[[dict[str, float | str]], None] | None = None,
    ) -> TranscriptionResult:
        _ = model_size
        _ = model_default
        load_profile = _normalize_load_profile(model_load_profile)
        try:
            model = self._get_or_create_model(
                device=device,
                compute_type=compute_type,
            )
            segments, info = model.transcribe(
                str(audio_path),
                beam_size=beam_size,
                language=language,
                vad_filter=vad_filter,
            )
            parsed_segments: list[dict[str, float | str]] = []
            text_parts: list[str] = []
            for segment in segments:
                text = segment.text.strip()
                parsed_segment = {
                    "start": round(float(segment.start) + timestamp_offset_seconds, 2),
                    "end": round(float(segment.end) + timestamp_offset_seconds, 2),
                    "text": text,
                }
                parsed_segments.append(parsed_segment)
                if on_segment:
                    on_segment(parsed_segment)
                if text:
                    text_parts.append(text)
            return TranscriptionResult(
                text="\n".join(text_parts).strip(),
                segments=parsed_segments,
                language=getattr(info, "language", None),
            )
        finally:
            if load_profile == "memory_first":
                self.release_runtime_models()

    def _get_or_create_model(
        self,
        *,
        device: str,
        compute_type: str,
    ):
        normalized_device = self._normalize_device(device)
        normalized_compute_type = compute_type.strip() or "int8"
        cache_key = f"small|{normalized_device}|{normalized_compute_type}"
        stale_models: list[object] = []
        with self._models_lock:
            model = self._models.get(cache_key)
            if model is not None:
                self._models.move_to_end(cache_key)
                return model

            from faster_whisper import WhisperModel

            model = self._create_whisper_model(
                WhisperModel=WhisperModel,
                normalized_device=normalized_device,
                normalized_compute_type=normalized_compute_type,
            )
            self._models[cache_key] = model
            self._models.move_to_end(cache_key)
            while len(self._models) > self._max_cached_models:
                _, stale_model = self._models.popitem(last=False)
                stale_models.append(stale_model)
        if stale_models:
            gc.collect()
        return model

    def _create_whisper_model(
        self,
        WhisperModel: object,
        normalized_device: str,
        normalized_compute_type: str,
    ):
        model_path = self.small_model_dir()
        if not self.is_small_model_ready():
            raise RuntimeError(
                "Whisper small model cache is missing. "
                "Please run analysis once to auto-download model files before transcription starts."
            )
        model_ctor = WhisperModel  # type: ignore[assignment]
        try:
            return model_ctor(
                model_size_or_path=str(model_path),
                device=normalized_device,
                compute_type=normalized_compute_type,
                local_files_only=True,
            )
        except Exception:
            raise

    async def _download_small_model(self, on_progress: ModelPrepareProgressCallback | None) -> None:
        endpoint, files = await self._resolve_model_files()
        total_bytes = sum(item[1] for item in files)
        await self._emit_prepare_progress(
            on_progress,
            {
                "status": "downloading",
                "message": "Downloading Whisper small model...",
                "current_file": "",
                "downloaded_bytes": 0,
                "total_bytes": total_bytes,
                "percent": 0.0,
            },
        )

        temp_root = self._download_root / ".tmp" / f"{self._MODEL_DIR_NAME}-{int(time.time() * 1000)}"
        temp_root.mkdir(parents=True, exist_ok=True)
        target_dir = self.small_model_dir()

        downloaded_bytes = 0
        last_emit_at = 0.0
        started_at = time.perf_counter()
        progress_lock = asyncio.Lock()

        async def report_progress(delta: int, current_file: str, *, force: bool = False) -> None:
            nonlocal downloaded_bytes
            nonlocal last_emit_at
            async with progress_lock:
                downloaded_bytes += max(0, int(delta))
                now = time.perf_counter()
                should_emit = force or now - last_emit_at >= 0.25 or downloaded_bytes >= total_bytes
                if not should_emit:
                    return
                elapsed = max(0.001, now - started_at)
                percent = 100.0 if total_bytes <= 0 else min(100.0, (downloaded_bytes / total_bytes) * 100.0)
                await self._emit_prepare_progress(
                    on_progress,
                    {
                        "status": "downloading",
                        "message": "Downloading Whisper small model...",
                        "current_file": current_file,
                        "downloaded_bytes": downloaded_bytes,
                        "total_bytes": total_bytes,
                        "percent": percent,
                        "speed_bps": downloaded_bytes / elapsed,
                    },
                )
                last_emit_at = now

        limits = httpx.Limits(max_connections=64, max_keepalive_connections=32, keepalive_expiry=30.0)
        timeout = httpx.Timeout(connect=20.0, read=120.0, write=120.0, pool=60.0)
        try:
            async with httpx.AsyncClient(http2=True, follow_redirects=True, limits=limits, timeout=timeout) as client:
                semaphore = asyncio.Semaphore(4)
                tasks = [
                    asyncio.create_task(
                        self._download_single_model_file(
                            client=client,
                            endpoint=endpoint,
                            file_name=file_name,
                            expected_size=expected_size,
                            target_root=temp_root,
                            semaphore=semaphore,
                            report_progress=report_progress,
                        )
                    )
                    for file_name, expected_size in files
                ]
                await asyncio.gather(*tasks)

            for file_name, expected_size in files:
                downloaded = temp_root / file_name
                if not downloaded.exists():
                    raise RuntimeError(f"Whisper model file missing after download: {file_name}")
                if expected_size > 0 and downloaded.stat().st_size != expected_size:
                    raise RuntimeError(
                        f"Whisper model file size mismatch: {file_name} "
                        f"({downloaded.stat().st_size} != {expected_size})"
                    )

            ready_marker = temp_root / self._READY_MARKER
            ready_marker.write_text(
                (
                    "{\n"
                    f'  "repo_id": "{self._MODEL_REPO_ID}",\n'
                    f'  "revision": "{self._MODEL_REVISION}",\n'
                    f'  "source_endpoint": "{endpoint}",\n'
                    f'  "downloaded_at": "{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}"\n'
                    "}\n"
                ),
                encoding="utf-8",
            )

            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)
            target_dir.parent.mkdir(parents=True, exist_ok=True)
            temp_root.replace(target_dir)
            await report_progress(0, "", force=True)
            await self._emit_prepare_progress(
                on_progress,
                {
                    "status": "completed",
                    "message": "Whisper small model downloaded and ready.",
                    "current_file": "",
                    "downloaded_bytes": downloaded_bytes,
                    "total_bytes": total_bytes,
                    "percent": 100.0,
                },
            )
        except asyncio.CancelledError:
            shutil.rmtree(temp_root, ignore_errors=True)
            raise
        except Exception:
            shutil.rmtree(temp_root, ignore_errors=True)
            raise

    async def _resolve_model_files(self) -> tuple[str, list[tuple[str, int]]]:
        endpoints = self._candidate_model_endpoints()
        errors: list[str] = []
        async with httpx.AsyncClient(http2=True, follow_redirects=True, timeout=30.0) as client:
            for endpoint in endpoints:
                url = f"{endpoint}/api/models/{self._MODEL_REPO_ID}?blobs=true"
                try:
                    response = await client.get(url)
                    response.raise_for_status()
                    payload = response.json()
                    siblings = payload.get("siblings", [])
                    if not isinstance(siblings, list):
                        raise RuntimeError("Invalid siblings payload.")
                    resolved: list[tuple[str, int]] = []
                    missing: list[str] = []
                    by_name: dict[str, dict[str, object]] = {}
                    for item in siblings:
                        if isinstance(item, dict):
                            name = str(item.get("rfilename", "")).strip()
                            if name:
                                by_name[name] = item
                    for required_name in self._REQUIRED_MODEL_FILES:
                        file_item = by_name.get(required_name)
                        if file_item is None:
                            missing.append(required_name)
                            continue
                        size = int(file_item.get("size", 0) or 0)
                        if size <= 0 and isinstance(file_item.get("lfs"), dict):
                            size = int((file_item.get("lfs") or {}).get("size", 0) or 0)
                        resolved.append((required_name, max(0, size)))
                    if missing:
                        raise RuntimeError(f"Missing required files from manifest: {', '.join(missing)}")
                    return endpoint, resolved
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{endpoint}: {type(exc).__name__}: {exc}")
                    continue
        joined = " | ".join(errors) if errors else "no endpoint responded"
        raise RuntimeError(f"Failed to resolve Whisper small model manifest. {joined}")

    async def _download_single_model_file(
        self,
        *,
        client: httpx.AsyncClient,
        endpoint: str,
        file_name: str,
        expected_size: int,
        target_root: Path,
        semaphore: asyncio.Semaphore,
        report_progress: Callable[[int, str], Awaitable[None]],
    ) -> None:
        async with semaphore:
            target_path = target_root / file_name
            target_path.parent.mkdir(parents=True, exist_ok=True)
            quoted_name = quote(file_name, safe="/")
            url = f"{endpoint}/{self._MODEL_REPO_ID}/resolve/{self._MODEL_REVISION}/{quoted_name}?download=1"
            attempts = 3
            delay_seconds = 1.0
            for attempt in range(1, attempts + 1):
                try:
                    await self._download_file(
                        client=client,
                        url=url,
                        expected_size=expected_size,
                        target_path=target_path,
                        current_file=file_name,
                        report_progress=report_progress,
                    )
                    return
                except Exception:
                    target_path.unlink(missing_ok=True)
                    if attempt >= attempts:
                        raise
                    await asyncio.sleep(delay_seconds * attempt)

    async def _download_file(
        self,
        *,
        client: httpx.AsyncClient,
        url: str,
        expected_size: int,
        target_path: Path,
        current_file: str,
        report_progress: Callable[[int, str], Awaitable[None]],
    ) -> None:
        supports_range = expected_size >= self._RANGE_SEGMENT_THRESHOLD_BYTES and await self._supports_range_download(
            client, url
        )
        if supports_range:
            await self._download_file_by_ranges(
                client=client,
                url=url,
                expected_size=expected_size,
                target_path=target_path,
                current_file=current_file,
                report_progress=report_progress,
            )
            return

        temp_path = target_path.with_suffix(target_path.suffix + ".downloading")
        temp_path.unlink(missing_ok=True)
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            with temp_path.open("wb") as output:
                async for chunk in response.aiter_bytes(self._DOWNLOAD_CHUNK_SIZE):
                    if not chunk:
                        continue
                    output.write(chunk)
                    await report_progress(len(chunk), current_file)
        temp_path.replace(target_path)

    async def _download_file_by_ranges(
        self,
        *,
        client: httpx.AsyncClient,
        url: str,
        expected_size: int,
        target_path: Path,
        current_file: str,
        report_progress: Callable[[int, str], Awaitable[None]],
    ) -> None:
        segment_count = max(4, min(16, math.ceil(expected_size / self._RANGE_SEGMENT_TARGET_BYTES)))
        segment_size = math.ceil(expected_size / segment_count)
        part_dir = target_path.parent / f".{target_path.name}.parts"
        if part_dir.exists():
            shutil.rmtree(part_dir, ignore_errors=True)
        part_dir.mkdir(parents=True, exist_ok=True)

        ranges: list[tuple[int, int, Path]] = []
        for index in range(segment_count):
            start = index * segment_size
            if start >= expected_size:
                break
            end = min(expected_size - 1, (start + segment_size - 1))
            part_path = part_dir / f"part-{index:02d}.bin"
            ranges.append((start, end, part_path))

        async def download_range(start: int, end: int, part_path: Path) -> None:
            headers = {"Range": f"bytes={start}-{end}"}
            async with client.stream("GET", url, headers=headers) as response:
                if response.status_code != 206:
                    raise RuntimeError(
                        f"Range request not supported (status={response.status_code}) for {current_file}"
                    )
                with part_path.open("wb") as output:
                    async for chunk in response.aiter_bytes(self._DOWNLOAD_CHUNK_SIZE):
                        if not chunk:
                            continue
                        output.write(chunk)
                        await report_progress(len(chunk), current_file)

        try:
            await asyncio.gather(*(download_range(start, end, part) for start, end, part in ranges))
            temp_path = target_path.with_suffix(target_path.suffix + ".downloading")
            temp_path.unlink(missing_ok=True)
            with temp_path.open("wb") as output:
                for _, _, part_path in ranges:
                    with part_path.open("rb") as part_file:
                        shutil.copyfileobj(part_file, output, length=self._DOWNLOAD_CHUNK_SIZE)
            temp_path.replace(target_path)
        finally:
            shutil.rmtree(part_dir, ignore_errors=True)

    @staticmethod
    async def _supports_range_download(client: httpx.AsyncClient, url: str) -> bool:
        try:
            head = await client.head(url)
            if head.status_code < 400:
                accept_ranges = str(head.headers.get("accept-ranges", "")).lower()
                if "bytes" in accept_ranges:
                    return True
        except Exception:  # noqa: BLE001
            pass
        try:
            test = await client.get(url, headers={"Range": "bytes=0-0"})
            return test.status_code == 206
        except Exception:  # noqa: BLE001
            return False

    @staticmethod
    async def _emit_prepare_progress(
        on_progress: ModelPrepareProgressCallback | None,
        payload: ModelPrepareProgressPayload,
    ) -> None:
        if on_progress is None:
            return
        result = on_progress(payload)
        if asyncio.iscoroutine(result):
            await result

    def small_model_dir(self) -> Path:
        configured_dir = _read_configured_whisper_model_dir(self._settings.storage_dir)
        if configured_dir is not None:
            return configured_dir
        return self._download_root / self._MODEL_DIR_NAME

    def is_small_model_ready(self) -> bool:
        model_dir = self.small_model_dir()
        if not model_dir.is_dir():
            return False
        marker = model_dir / self._READY_MARKER
        if not marker.exists():
            return False
        for file_name in self._REQUIRED_MODEL_FILES:
            target = model_dir / file_name
            if not target.exists() or not target.is_file():
                return False
            if target.stat().st_size <= 0:
                return False
        return True

    def _small_model_dir(self) -> Path:
        return self.small_model_dir()

    def _is_small_model_ready(self) -> bool:
        return self.is_small_model_ready()

    @staticmethod
    def _candidate_model_endpoints() -> list[str]:
        items: list[str] = []
        seen: set[str] = set()

        def append(raw: str) -> None:
            endpoint = raw.strip().rstrip("/")
            if not endpoint or endpoint in seen:
                return
            seen.add(endpoint)
            items.append(endpoint)

        for env_key in ("WHISPER_MODEL_ENDPOINTS",):
            env_raw = str(os.environ.get(env_key, "")).strip()
            if env_raw:
                for chunk in env_raw.replace("\n", ",").replace(";", ",").split(","):
                    append(chunk)
        append("https://hf-mirror.com")
        append("https://huggingface.co")
        return items

    def shutdown(self) -> None:
        with self._models_lock:
            if not self._models:
                return
            self._models.clear()
        gc.collect()

    def release_runtime_models(self) -> None:
        with self._models_lock:
            if not self._models:
                return
            self._models.clear()
        gc.collect()

    @staticmethod
    def _normalize_device(device: str) -> str:
        normalized = device.strip().lower()
        if normalized in {"", "auto", "cpu", "cuda"}:
            return normalized or "auto"
        return "cpu"


def _normalize_load_profile(raw: object) -> LoadProfile:
    candidate = str(raw).strip().lower()
    if candidate in {"balanced", "memory_first"}:
        return candidate
    return "balanced"


def _read_configured_whisper_model_dir(storage_dir: str) -> Path | None:
    catalog_path = Path(storage_dir) / "models" / "catalog.json"
    if not catalog_path.exists():
        return None
    try:
        payload = orjson.loads(catalog_path.read_bytes())
    except (orjson.JSONDecodeError, OSError):
        return None
    if not isinstance(payload, list):
        return None
    for item in payload:
        if not isinstance(item, dict):
            continue
        if str(item.get("id", "")).strip() != "whisper-default":
            continue
        raw_path = str(item.get("path", "")).strip()
        if not raw_path:
            return None
        return Path(raw_path).expanduser().resolve()
    return None
