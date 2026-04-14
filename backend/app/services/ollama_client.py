from __future__ import annotations

import base64
from dataclasses import dataclass
import inspect
from pathlib import Path
from typing import Any

import httpx
import orjson

from app.config import Settings

OllamaProgressCallback = Any


@dataclass(frozen=True, slots=True)
class OllamaLocalModel:
    name: str
    size_bytes: int = 0
    digest: str = ""
    modified_at: str = ""


class OllamaClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._base_url = str(settings.ollama_base_url).strip().rstrip("/")
        self._tags_timeout = httpx.Timeout(connect=0.5, read=2.0, write=2.0, pool=2.0)
        self._request_timeout = httpx.Timeout(connect=1.0, read=180.0, write=180.0, pool=10.0)
        self._pull_timeout = httpx.Timeout(connect=1.0, read=None, write=None, pool=10.0)

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def openai_compat_base_url(self) -> str:
        return f"{self._base_url}/v1"

    @staticmethod
    def model_uri(model_name: str) -> str:
        return f"ollama://{str(model_name).strip()}"

    async def list_local_models(self) -> dict[str, OllamaLocalModel]:
        if not self._base_url:
            return {}
        try:
            async with httpx.AsyncClient(timeout=self._tags_timeout) as client:
                response = await client.get(self._api_url("/tags"))
                response.raise_for_status()
        except Exception:  # noqa: BLE001
            return {}

        payload = response.json()
        raw_models = payload.get("models")
        if not isinstance(raw_models, list):
            return {}

        models: dict[str, OllamaLocalModel] = {}
        for item in raw_models:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("model") or "").strip()
            if not name:
                continue
            local_model = OllamaLocalModel(
                name=name,
                size_bytes=max(0, int(item.get("size", 0) or 0)),
                digest=str(item.get("digest", "")).strip(),
                modified_at=str(item.get("modified_at", "")).strip(),
            )
            models[name] = local_model
            if name.endswith(":latest"):
                alias = name[: -len(":latest")].strip()
                if alias and alias not in models:
                    models[alias] = local_model
        return models

    async def chat(
        self,
        *,
        model: str,
        messages: list[dict[str, object]],
        options: dict[str, object] | None = None,
        keep_alive: str | None = None,
        format: dict[str, object] | str | None = None,
    ) -> str:
        payload: dict[str, object] = {
            "model": str(model).strip(),
            "messages": messages,
            "stream": False,
        }
        if options:
            payload["options"] = options
        if keep_alive:
            payload["keep_alive"] = keep_alive
        if format is not None:
            payload["format"] = format
        response = await self._post_json("/chat", payload)
        message = response.get("message")
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                return content.strip()
        return str(response.get("response", "") or "").strip()

    async def embed(self, *, model: str, inputs: list[str]) -> list[list[float]]:
        if not inputs:
            return []
        payload = {
            "model": str(model).strip(),
            "input": inputs,
            "keep_alive": "5m",
        }
        response = await self._post_json("/embed", payload)
        embeddings = response.get("embeddings")
        if isinstance(embeddings, list) and embeddings and all(isinstance(item, list) for item in embeddings):
            return [[float(value) for value in item] for item in embeddings]
        embedding = response.get("embedding")
        if isinstance(embedding, list):
            return [[float(value) for value in embedding]]
        raise RuntimeError("Ollama embed response is missing embeddings")

    async def pull_model(
        self,
        *,
        model: str,
        on_progress: OllamaProgressCallback | None = None,
    ) -> None:
        payload = {"model": str(model).strip(), "stream": True}
        async with httpx.AsyncClient(timeout=self._pull_timeout) as client:
            async with client.stream("POST", self._api_url("/pull"), json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    event = _loads_json_line(line)
                    if not isinstance(event, dict):
                        continue
                    if event.get("error"):
                        raise RuntimeError(str(event.get("error")).strip() or "ollama pull failed")
                    if on_progress is not None:
                        await _emit_progress(on_progress, _build_pull_progress_payload(event))

    async def image_to_base64(self, path: str | Path) -> str:
        image_path = Path(path).expanduser()
        if not image_path.is_file():
            raise FileNotFoundError(str(image_path))
        return base64.b64encode(image_path.read_bytes()).decode("utf-8")

    async def _post_json(self, endpoint: str, payload: dict[str, object]) -> dict[str, object]:
        async with httpx.AsyncClient(timeout=self._request_timeout) as client:
            response = await client.post(self._api_url(endpoint), json=payload)
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, dict):
            raise RuntimeError("Invalid Ollama JSON response")
        if data.get("error"):
            raise RuntimeError(str(data.get("error")).strip() or "Ollama request failed")
        return data

    def _api_url(self, endpoint: str) -> str:
        return f"{self._base_url}/api/{endpoint.lstrip('/')}"


def _loads_json_line(line: str) -> dict[str, object] | None:
    try:
        payload = orjson.loads(line.encode("utf-8"))
    except orjson.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


async def _emit_progress(callback: OllamaProgressCallback, payload: dict[str, object]) -> None:
    result = callback(payload)
    if inspect.isawaitable(result):
        await result


def _build_pull_progress_payload(event: dict[str, object]) -> dict[str, object]:
    status = str(event.get("status", "") or "").strip()
    total = max(0, int(event.get("total", 0) or 0))
    completed = max(0, int(event.get("completed", 0) or 0))
    percent = 100.0 if total <= 0 and status == "success" else (completed / total * 100.0 if total > 0 else 0.0)
    current_file = str(event.get("digest", "") or event.get("model", "") or "").strip()
    return {
        "status": "completed" if status == "success" else "downloading",
        "message": status or "pulling model",
        "current_file": current_file,
        "downloaded_bytes": completed,
        "total_bytes": total,
        "percent": max(0.0, min(100.0, percent)),
        "speed_bps": 0.0,
    }
