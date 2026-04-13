from __future__ import annotations

import asyncio
import contextlib
import os
import sys
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path

import orjson

from app.config import Settings

_WORKER_EVENT_PREFIX = "@@VIDGNOST_GPU_WORKER@@ "
WorkerEventHandler = Callable[[dict[str, object]], Awaitable[None] | None]


class GPUStageWorkerClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._backend_root = Path(__file__).resolve().parents[2]
        self._request_dir = Path(settings.temp_dir) / "gpu-stage-worker"
        self._request_dir.mkdir(parents=True, exist_ok=True)

    async def run(
        self,
        request: dict[str, object],
        *,
        on_event: WorkerEventHandler | None = None,
    ) -> dict[str, object]:
        request_id = uuid.uuid4().hex
        request_path = self._request_dir / f"{request_id}.json"
        request_path.write_bytes(orjson.dumps(request, option=orjson.OPT_INDENT_2))

        stderr_lines: list[str] = []
        process: asyncio.subprocess.Process | None = None
        stderr_task: asyncio.Task[None] | None = None
        result: dict[str, object] | None = None
        worker_error: str | None = None

        try:
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                "app.workers.gpu_stage_worker",
                "--request",
                str(request_path),
                cwd=str(self._backend_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={
                    **os.environ,
                    "PYTHONUTF8": "1",
                },
            )
            stderr_task = asyncio.create_task(self._drain_stream(process.stderr, stderr_lines))
            if process.stdout is None:
                raise RuntimeError("GPU worker stdout pipe is unavailable.")

            while True:
                raw_line = await process.stdout.readline()
                if not raw_line:
                    break
                event = _parse_worker_event(raw_line)
                if event is None:
                    continue
                if on_event is not None:
                    await _maybe_await(on_event(event))
                event_type = str(event.get("type", "") or "").strip().lower()
                if event_type == "completed":
                    payload = event.get("result")
                    result = dict(payload) if isinstance(payload, dict) else {}
                elif event_type == "error":
                    worker_error = str(event.get("message", "") or "").strip() or "GPU worker failed."

            return_code = await process.wait()
        except asyncio.CancelledError:
            if process is not None:
                await self._terminate_process(process)
            raise
        except Exception:
            if process is not None:
                await self._terminate_process(process)
            raise
        finally:
            if stderr_task is not None:
                with contextlib.suppress(Exception):
                    await stderr_task
            with contextlib.suppress(FileNotFoundError):
                request_path.unlink()

        stderr_text = "\n".join(line for line in stderr_lines if line).strip()
        if return_code != 0:
            if worker_error:
                raise RuntimeError(worker_error)
            if stderr_text:
                raise RuntimeError(stderr_text)
            raise RuntimeError(f"GPU worker exited unexpectedly with code {return_code}.")
        if result is None:
            if worker_error:
                raise RuntimeError(worker_error)
            if stderr_text:
                raise RuntimeError(stderr_text)
            raise RuntimeError("GPU worker finished without returning a result payload.")
        return result

    async def _terminate_process(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
            return
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()

    @staticmethod
    async def _drain_stream(
        stream: asyncio.StreamReader | None,
        bucket: list[str],
    ) -> None:
        if stream is None:
            return
        while True:
            raw_line = await stream.readline()
            if not raw_line:
                return
            line = raw_line.decode("utf-8", errors="replace").rstrip()
            if not line:
                continue
            bucket.append(line)
            if len(bucket) > 200:
                del bucket[: len(bucket) - 200]


def _parse_worker_event(raw_line: bytes) -> dict[str, object] | None:
    line = raw_line.decode("utf-8", errors="replace").strip()
    if not line.startswith(_WORKER_EVENT_PREFIX):
        return None
    payload = line.removeprefix(_WORKER_EVENT_PREFIX).strip()
    if not payload:
        return None
    try:
        parsed = orjson.loads(payload)
    except orjson.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


async def _maybe_await(result: Awaitable[None] | None) -> None:
    if result is None:
        return
    await result
