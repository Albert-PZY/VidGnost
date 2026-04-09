from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class VQATraceStore:
    """JSONL trace store for retrieval and QA pipeline observability."""

    def __init__(self, log_dir: str | Path) -> None:
        self._log_dir = Path(log_dir).resolve()
        self._log_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    @staticmethod
    def _utc_now() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds")

    def new_trace(
        self,
        *,
        metadata: dict[str, Any] | None = None,
        config_snapshot: dict[str, Any] | None = None,
    ) -> str:
        trace_id = uuid.uuid4().hex
        self.write(
            trace_id=trace_id,
            stage="trace_started",
            payload={
                "metadata": metadata or {},
                "config_snapshot": config_snapshot or {},
            },
        )
        return trace_id

    def write(self, *, trace_id: str, stage: str, payload: dict[str, Any]) -> None:
        record = {
            "ts": self._utc_now(),
            "trace_id": trace_id,
            "stage": stage,
            "payload": payload,
        }
        file_name = datetime.now(timezone.utc).strftime("%Y%m%d") + ".jsonl"
        path = self._log_dir / file_name
        with self._lock:
            with path.open("a", encoding="utf-8", newline="\n") as file:
                file.write(json.dumps(record, ensure_ascii=False) + "\n")

    def finalize(self, *, trace_id: str, payload: dict[str, Any]) -> None:
        self.write(trace_id=trace_id, stage="trace_finished", payload=payload)

    def read_trace(self, trace_id: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for path in sorted(self._log_dir.glob("*.jsonl")):
            try:
                for line in path.read_text(encoding="utf-8").splitlines():
                    if not line.strip():
                        continue
                    parsed = json.loads(line)
                    if str(parsed.get("trace_id", "")) == trace_id:
                        items.append(parsed)
            except (OSError, json.JSONDecodeError):
                continue
        return items
