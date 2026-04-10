from __future__ import annotations

import asyncio
import json
import math
import os
import shutil
import time
from collections.abc import Awaitable, Callable
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import httpx

from app.config import Settings

DownloadProgressPayload = dict[str, object]
DownloadProgressCallback = Callable[[DownloadProgressPayload], Awaitable[None] | None]


class HuggingFaceModelDownloader:
    _READY_MARKER = ".ready.json"
    _DOWNLOAD_CHUNK_SIZE = 1024 * 512
    _FILE_DOWNLOAD_CONCURRENCY = 8
    _MAX_CONNECTIONS = 128
    _MAX_KEEPALIVE_CONNECTIONS = 96
    _RANGE_SEGMENT_THRESHOLD_BYTES = 16 * 1024 * 1024
    _RANGE_SEGMENT_TARGET_BYTES = 8 * 1024 * 1024
    _RANGE_SEGMENT_MAX_COUNT = 24
    _SKIP_SUFFIXES = {
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".svg",
        ".mp4",
        ".mov",
        ".avi",
        ".wav",
        ".mp3",
        ".flac",
        ".zip",
        ".tar",
        ".7z",
        ".parquet",
    }
    _SKIP_BASENAMES = {
        ".gitattributes",
        ".gitignore",
        "readme.md",
        "license",
        "license.txt",
        "training_args.bin",
        "optimizer.pt",
        "scheduler.pt",
        "trainer_state.json",
        "rng_state.pth",
    }

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._download_root = Path(settings.storage_dir) / "model-hub"
        self._download_root.mkdir(parents=True, exist_ok=True)

    async def download_repo(
        self,
        *,
        repo_id: str,
        target_dir_name: str,
        revision: str = "main",
        required_files: tuple[str, ...] | None = None,
        on_progress: DownloadProgressCallback | None = None,
        force_redownload: bool = False,
    ) -> Path:
        target_dir = self._download_root / target_dir_name
        await self._emit_progress(
            on_progress,
            {
                "status": "checking",
                "message": f"Checking local model cache for {repo_id}...",
                "current_file": "",
                "downloaded_bytes": 0,
                "total_bytes": 0,
                "percent": 0.0,
            },
        )
        if self.is_repo_ready(target_dir, required_files=required_files) and not force_redownload:
            await self._emit_progress(
                on_progress,
                {
                    "status": "cached",
                    "message": f"Model cache for {repo_id} is ready.",
                    "current_file": "",
                    "downloaded_bytes": 0,
                    "total_bytes": 0,
                    "percent": 100.0,
                },
            )
            return target_dir

        endpoint, files = await self._resolve_repo_files(repo_id=repo_id, revision=revision, required_files=required_files)
        total_bytes = sum(item[1] for item in files)
        await self._emit_progress(
            on_progress,
            {
                "status": "downloading",
                "message": f"Downloading {repo_id}...",
                "current_file": "",
                "downloaded_bytes": 0,
                "total_bytes": total_bytes,
                "percent": 0.0,
            },
        )

        temp_root = self._download_root / ".tmp" / f"{target_dir_name}-{int(time.time() * 1000)}"
        temp_root.mkdir(parents=True, exist_ok=True)

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
                should_emit = force or now - last_emit_at >= 0.2 or downloaded_bytes >= total_bytes
                if not should_emit:
                    return
                elapsed = max(0.001, now - started_at)
                percent = 100.0 if total_bytes <= 0 else min(100.0, (downloaded_bytes / total_bytes) * 100.0)
                await self._emit_progress(
                    on_progress,
                    {
                        "status": "downloading",
                        "message": f"Downloading {repo_id}...",
                        "current_file": current_file,
                        "downloaded_bytes": downloaded_bytes,
                        "total_bytes": total_bytes,
                        "percent": percent,
                        "speed_bps": downloaded_bytes / elapsed,
                    },
                )
                last_emit_at = now

        limits = httpx.Limits(
            max_connections=self._MAX_CONNECTIONS,
            max_keepalive_connections=self._MAX_KEEPALIVE_CONNECTIONS,
            keepalive_expiry=30.0,
        )
        timeout = httpx.Timeout(connect=20.0, read=120.0, write=120.0, pool=60.0)
        try:
            async with httpx.AsyncClient(http2=True, follow_redirects=True, limits=limits, timeout=timeout) as client:
                semaphore = asyncio.Semaphore(self._FILE_DOWNLOAD_CONCURRENCY)
                tasks = [
                    asyncio.create_task(
                        self._download_single_file(
                            client=client,
                            repo_id=repo_id,
                            revision=revision,
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
                    raise RuntimeError(f"Model file missing after download: {file_name}")
                if expected_size > 0 and downloaded.stat().st_size != expected_size:
                    raise RuntimeError(
                        f"Model file size mismatch: {file_name} ({downloaded.stat().st_size} != {expected_size})"
                    )

            ready_marker = temp_root / self._READY_MARKER
            ready_marker.write_text(
                (
                    "{\n"
                    f'  "repo_id": "{repo_id}",\n'
                    f'  "revision": "{revision}",\n'
                    f'  "source_endpoint": "{endpoint}",\n'
                    f'  "downloaded_at": "{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}",\n'
                    f'  "files": {self._json_array(files)}\n'
                    "}\n"
                ),
                encoding="utf-8",
            )

            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)
            target_dir.parent.mkdir(parents=True, exist_ok=True)
            temp_root.replace(target_dir)
            await report_progress(0, "", force=True)
            await self._emit_progress(
                on_progress,
                {
                    "status": "completed",
                    "message": f"{repo_id} downloaded and ready.",
                    "current_file": "",
                    "downloaded_bytes": downloaded_bytes,
                    "total_bytes": total_bytes,
                    "percent": 100.0,
                },
            )
            return target_dir
        except asyncio.CancelledError:
            shutil.rmtree(temp_root, ignore_errors=True)
            raise
        except Exception:
            shutil.rmtree(temp_root, ignore_errors=True)
            raise

    def is_repo_ready(self, target_dir: Path, *, required_files: tuple[str, ...] | None = None) -> bool:
        if not target_dir.is_dir():
            return False
        marker = target_dir / self._READY_MARKER
        if not marker.exists():
            return False
        if required_files:
            for file_name in required_files:
                target = target_dir / file_name
                if not target.is_file() or target.stat().st_size <= 0:
                    return False
            return True

        try:
            content = marker.read_text(encoding="utf-8")
        except OSError:
            return False

        file_names: list[str] = []
        marker_key = '"files": ['
        marker_index = content.find(marker_key)
        if marker_index >= 0:
            suffix = content[marker_index + len(marker_key) :]
            list_end = suffix.find("]")
            if list_end >= 0:
                raw_items = suffix[:list_end]
                file_names = [
                    chunk.strip().strip('"')
                    for chunk in raw_items.split(",")
                    if chunk.strip().strip('"')
                ]
        if not file_names:
            return False

        for file_name in file_names:
            target = target_dir / file_name
            if not target.is_file() or target.stat().st_size <= 0:
                return False
        return True

    async def _resolve_repo_files(
        self,
        *,
        repo_id: str,
        revision: str,
        required_files: tuple[str, ...] | None,
    ) -> tuple[str, list[tuple[str, int]]]:
        endpoints = self._candidate_model_endpoints()
        errors: list[str] = []
        async with httpx.AsyncClient(http2=True, follow_redirects=True, timeout=30.0) as client:
            for endpoint in endpoints:
                url = f"{endpoint}/api/models/{repo_id}?blobs=true"
                try:
                    response = await client.get(url)
                    response.raise_for_status()
                    payload = response.json()
                    siblings = payload.get("siblings", [])
                    if not isinstance(siblings, list):
                        raise RuntimeError("Invalid siblings payload.")
                    by_name: dict[str, dict[str, object]] = {}
                    for item in siblings:
                        if isinstance(item, dict):
                            name = str(item.get("rfilename", "")).strip()
                            if name:
                                by_name[name] = item
                    if required_files:
                        selected_names = list(required_files)
                    else:
                        selected_names = [
                            name
                            for name in by_name.keys()
                            if self._should_download_file(name)
                        ]
                    if not selected_names:
                        raise RuntimeError("No runtime files resolved from repo manifest.")
                    resolved: list[tuple[str, int]] = []
                    missing: list[str] = []
                    for file_name in selected_names:
                        file_item = by_name.get(file_name)
                        if file_item is None:
                            missing.append(file_name)
                            continue
                        size = int(file_item.get("size", 0) or 0)
                        if size <= 0 and isinstance(file_item.get("lfs"), dict):
                            size = int((file_item.get("lfs") or {}).get("size", 0) or 0)
                        resolved.append((file_name, max(0, size)))
                    if missing:
                        raise RuntimeError(f"Missing required files from manifest: {', '.join(missing)}")
                    return endpoint, resolved
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{endpoint}: {type(exc).__name__}: {exc}")
                    continue
        raise RuntimeError(f"Failed to resolve repo manifest for {repo_id}. {' | '.join(errors) or 'no endpoint responded'}")

    async def _download_single_file(
        self,
        *,
        client: httpx.AsyncClient,
        repo_id: str,
        revision: str,
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
            url = f"{endpoint}/{repo_id}/resolve/{revision}/{quoted_name}?download=1"
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
        segment_count = max(4, min(self._RANGE_SEGMENT_MAX_COUNT, math.ceil(expected_size / self._RANGE_SEGMENT_TARGET_BYTES)))
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
            ranges.append((start, end, part_dir / f"part-{index:02d}.bin"))

        async def download_range(start: int, end: int, part_path: Path) -> None:
            headers = {"Range": f"bytes={start}-{end}"}
            async with client.stream("GET", url, headers=headers) as response:
                if response.status_code != 206:
                    raise RuntimeError(f"Range request not supported (status={response.status_code}) for {current_file}")
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
            if head.status_code < 400 and "bytes" in str(head.headers.get("accept-ranges", "")).lower():
                return True
        except Exception:  # noqa: BLE001
            pass
        try:
            test = await client.get(url, headers={"Range": "bytes=0-0"})
            return test.status_code == 206
        except Exception:  # noqa: BLE001
            return False

    @staticmethod
    async def _emit_progress(
        on_progress: DownloadProgressCallback | None,
        payload: DownloadProgressPayload,
    ) -> None:
        if on_progress is None:
            return
        result = on_progress(payload)
        if asyncio.iscoroutine(result):
            await result

    @classmethod
    def _should_download_file(cls, file_name: str) -> bool:
        normalized = PurePosixPath(file_name)
        base_name = normalized.name.lower()
        suffix = normalized.suffix.lower()
        if any(part.startswith(".") for part in normalized.parts[:-1]):
            return False
        if base_name in cls._SKIP_BASENAMES:
            return False
        if suffix in cls._SKIP_SUFFIXES:
            return False
        return True

    @staticmethod
    def _json_array(files: list[tuple[str, int]]) -> str:
        return json.dumps([name.replace("\\", "/") for name, _ in files], ensure_ascii=False)

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

        for env_key in ("MODEL_DOWNLOAD_ENDPOINTS", "WHISPER_MODEL_ENDPOINTS"):
            env_raw = str(os.environ.get(env_key, "")).strip()
            if env_raw:
                for chunk in env_raw.replace("\n", ",").replace(";", ",").split(","):
                    append(chunk)
        append("https://hf-mirror.com")
        append("https://huggingface.co")
        return items
