from __future__ import annotations

import shutil
from pathlib import Path

import orjson


class StageArtifactStore:
    def __init__(self, storage_dir: str) -> None:
        root = Path(storage_dir)
        self._artifacts_root = root / "tasks" / "stage-artifacts"
        self._artifacts_root.mkdir(parents=True, exist_ok=True)

    def write_json(self, task_id: str, stage: str, relative_path: str, payload: object) -> None:
        path = self._safe_stage_relative_path(task_id, stage, relative_path)
        self._write_bytes(path, orjson.dumps(payload))

    def read_json(self, task_id: str, stage: str, relative_path: str, *, default: object) -> object:
        path = self._safe_stage_relative_path(task_id, stage, relative_path)
        if not path.exists():
            return default
        try:
            return orjson.loads(path.read_bytes())
        except orjson.JSONDecodeError:
            return default

    def write_text(self, task_id: str, stage: str, relative_path: str, text: str) -> None:
        path = self._safe_stage_relative_path(task_id, stage, relative_path)
        self._write_bytes(path, text.encode("utf-8"))

    def write_chunk_json(
        self,
        task_id: str,
        stage: str,
        chunk_group: str,
        chunk_index: int,
        payload: object,
    ) -> str:
        filename = f"chunk-{max(1, int(chunk_index) + 1):04d}.json"
        relative_path = f"{chunk_group.strip().strip('/').strip('\\\\')}/{filename}"
        self.write_json(task_id, stage, relative_path, payload)
        return relative_path.replace("\\", "/")

    def read_text(self, task_id: str, stage: str, relative_path: str, *, default: str = "") -> str:
        path = self._safe_stage_relative_path(task_id, stage, relative_path)
        if not path.exists() or not path.is_file():
            return default
        try:
            return path.read_text(encoding="utf-8")
        except OSError:
            return default

    def read_bytes(self, task_id: str, stage: str, relative_path: str, *, default: bytes = b"") -> bytes:
        path = self._safe_stage_relative_path(task_id, stage, relative_path)
        if not path.exists() or not path.is_file():
            return default
        try:
            return path.read_bytes()
        except OSError:
            return default

    def reset_stage(self, task_id: str, stage: str) -> None:
        stage_dir = self._stage_dir(task_id, stage)
        if stage_dir.exists():
            shutil.rmtree(stage_dir, ignore_errors=True)

    def delete_task(self, task_id: str) -> None:
        task_dir = self._task_dir(task_id)
        if task_dir.exists():
            shutil.rmtree(task_dir, ignore_errors=True)

    def _task_dir(self, task_id: str) -> Path:
        return self._artifacts_root / task_id

    def _stage_dir(self, task_id: str, stage: str) -> Path:
        return self._task_dir(task_id) / stage

    def _safe_stage_relative_path(self, task_id: str, stage: str, relative_path: str) -> Path:
        stage_dir = self._stage_dir(task_id, stage)
        candidate = (stage_dir / relative_path).resolve()
        if stage_dir.resolve() not in candidate.parents and candidate != stage_dir.resolve():
            raise ValueError("Invalid stage artifact path")
        return candidate

    @staticmethod
    def _write_bytes(path: Path, payload: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(path.suffix + ".tmp")
        temp_path.write_bytes(payload)
        temp_path.replace(path)
