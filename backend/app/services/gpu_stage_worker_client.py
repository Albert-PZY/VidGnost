from __future__ import annotations

import asyncio
import contextlib
import os
import subprocess
import sys
import threading
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
        event_queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        process_holder: dict[str, subprocess.Popen[bytes] | None] = {"process": None}
        return_code_holder: dict[str, int | None] = {"code": None}
        thread_errors: list[BaseException] = []
        result: dict[str, object] | None = None
        worker_error: str | None = None
        loop = asyncio.get_running_loop()

        def push_event(event: dict[str, object]) -> None:
            loop.call_soon_threadsafe(event_queue.put_nowait, event)

        def worker_main() -> None:
            stderr_thread: threading.Thread | None = None
            process: subprocess.Popen[bytes] | None = None
            try:
                process = subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "app.workers.gpu_stage_worker",
                        "--request",
                        str(request_path),
                    ],
                    cwd=str(self._backend_root),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env={
                        **os.environ,
                        "PYTHONUTF8": "1",
                    },
                )
                process_holder["process"] = process
                stderr_thread = threading.Thread(
                    target=self._drain_stderr_sync,
                    args=(process.stderr, stderr_lines),
                    daemon=True,
                )
                stderr_thread.start()
                if process.stdout is None:
                    raise RuntimeError("GPU worker stdout pipe is unavailable.")
                while True:
                    raw_line = process.stdout.readline()
                    if not raw_line:
                        break
                    event = _parse_worker_event(raw_line)
                    if event is not None:
                        push_event(event)
                process.stdout.close()
                return_code_holder["code"] = process.wait()
            except BaseException as exc:  # noqa: BLE001
                thread_errors.append(exc)
            finally:
                if stderr_thread is not None:
                    stderr_thread.join(timeout=5)
                push_event({"type": "__worker_done__"})

        worker_thread = threading.Thread(target=worker_main, daemon=True)
        worker_thread.start()

        try:
            while True:
                event = await event_queue.get()
                if str(event.get("type", "")).strip().lower() == "__worker_done__":
                    break
                if on_event is not None:
                    await _maybe_await(on_event(event))
                event_type = str(event.get("type", "") or "").strip().lower()
                if event_type == "completed":
                    payload = event.get("result")
                    result = dict(payload) if isinstance(payload, dict) else {}
                elif event_type == "error":
                    worker_error = str(event.get("message", "") or "").strip() or "GPU worker failed."
        except asyncio.CancelledError:
            await self._terminate_process(process_holder.get("process"))
            await asyncio.to_thread(worker_thread.join, 5)
            raise
        except Exception:
            await self._terminate_process(process_holder.get("process"))
            await asyncio.to_thread(worker_thread.join, 5)
            raise
        finally:
            with contextlib.suppress(Exception):
                await asyncio.to_thread(worker_thread.join, 5)
            with contextlib.suppress(FileNotFoundError):
                request_path.unlink()

        if thread_errors:
            raise RuntimeError(str(thread_errors[0])) from thread_errors[0]

        return_code = int(return_code_holder["code"]) if return_code_holder["code"] is not None else -1
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

    async def _terminate_process(self, process: subprocess.Popen[bytes] | None) -> None:
        await asyncio.to_thread(self._terminate_process_sync, process)

    @staticmethod
    def _terminate_process_sync(process: subprocess.Popen[bytes] | None) -> None:
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)

    @staticmethod
    def _drain_stderr_sync(
        stream: object | None,
        bucket: list[str],
    ) -> None:
        if stream is None:
            return
        while True:
            raw_line = stream.readline()
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
