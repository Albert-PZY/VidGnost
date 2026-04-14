from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import TypedDict

import orjson

from app.config import Settings


class OllamaRuntimeConfig(TypedDict):
    install_dir: str
    executable_path: str
    models_dir: str
    base_url: str


def _default_install_dir() -> Path:
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            return Path(local_app_data) / "Programs" / "Ollama"
        return Path.home() / "AppData" / "Local" / "Programs" / "Ollama"
    return Path("/usr/local/bin")


def _default_executable_path(install_dir: Path) -> Path:
    if os.name == "nt":
        return install_dir / "ollama.exe"
    return install_dir / "ollama"


def _default_models_dir() -> Path:
    return Path.home() / ".ollama" / "models"


def _normalize_path(raw: object, *, default: Path) -> str:
    candidate = str(raw or "").strip()
    if not candidate:
        return str(default.resolve())
    return str(Path(candidate).expanduser().resolve())


def _normalize_base_url(raw: object, *, default: str) -> str:
    candidate = str(raw or "").strip().rstrip("/")
    return candidate or default.rstrip("/")


def _same_path(left: str | Path, right: str | Path) -> bool:
    try:
        return Path(left).expanduser().resolve() == Path(right).expanduser().resolve()
    except OSError:
        return str(left).strip() == str(right).strip()


class OllamaRuntimeConfigStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._path = Path(settings.storage_dir) / "ollama-runtime.json"
        self._lock = asyncio.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_file()

    async def get(self) -> OllamaRuntimeConfig:
        async with self._lock:
            return self._read_sync()

    def get_sync(self) -> OllamaRuntimeConfig:
        return self._read_sync()

    async def save(self, payload: dict[str, object]) -> OllamaRuntimeConfig:
        async with self._lock:
            current = self._read_sync()
            install_dir = _normalize_path(payload.get("install_dir"), default=Path(current["install_dir"]))
            current_default_executable = str(_default_executable_path(Path(current["install_dir"])).resolve())
            requested_executable = str(payload.get("executable_path") or "").strip()
            executable_default = (
                _default_executable_path(Path(install_dir))
                if not requested_executable or _same_path(current["executable_path"], current_default_executable)
                else Path(current["executable_path"])
            )
            next_payload = {
                "install_dir": install_dir,
                "executable_path": _normalize_path(
                    payload.get("executable_path"),
                    default=executable_default,
                ),
                "models_dir": _normalize_path(payload.get("models_dir"), default=Path(current["models_dir"])),
                "base_url": _normalize_base_url(payload.get("base_url"), default=current["base_url"]),
            }
            self._write_sync(next_payload)
            return self._build_config(next_payload)

    def _ensure_file(self) -> None:
        if self._path.exists():
            return
        self._write_sync(self._default_payload())

    def _default_payload(self) -> dict[str, object]:
        install_dir = _default_install_dir()
        executable_path = _default_executable_path(install_dir)
        models_dir = _default_models_dir()
        return {
            "install_dir": str(install_dir.resolve()),
            "executable_path": str(executable_path.resolve()),
            "models_dir": str(models_dir.resolve()),
            "base_url": str(self._settings.ollama_base_url).strip().rstrip("/"),
        }

    def _read_sync(self) -> OllamaRuntimeConfig:
        if not self._path.exists():
            payload = self._default_payload()
            self._write_sync(payload)
            return self._build_config(payload)
        try:
            loaded = orjson.loads(self._path.read_bytes())
        except orjson.JSONDecodeError:
            loaded = {}
        payload = loaded if isinstance(loaded, dict) else {}
        return self._build_config(payload)

    def _build_config(self, payload: dict[str, object]) -> OllamaRuntimeConfig:
        install_dir = _normalize_path(payload.get("install_dir"), default=_default_install_dir())
        executable_path = _normalize_path(
            payload.get("executable_path"),
            default=_default_executable_path(Path(install_dir)),
        )
        models_dir = _normalize_path(payload.get("models_dir"), default=_default_models_dir())
        return {
            "install_dir": install_dir,
            "executable_path": executable_path,
            "models_dir": models_dir,
            "base_url": _normalize_base_url(payload.get("base_url"), default=self._settings.ollama_base_url),
        }

    def _write_sync(self, payload: dict[str, object]) -> None:
        tmp_path = self._path.with_suffix(".json.tmp")
        tmp_path.write_bytes(orjson.dumps(payload, option=orjson.OPT_INDENT_2))
        tmp_path.replace(self._path)
