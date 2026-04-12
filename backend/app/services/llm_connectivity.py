from __future__ import annotations

import json
from dataclasses import dataclass
import urllib.error
import urllib.request
from typing import Any


@dataclass(slots=True, frozen=True)
class OpenAICompatModelsProbeResult:
    ok: bool
    reason: str
    status_code: int | None = None
    model_ids: tuple[str, ...] = ()


@dataclass(slots=True, frozen=True)
class OpenAICompatModelValidationResult:
    ok: bool
    connectivity_ok: bool
    connectivity_reason: str
    model_ok: bool
    model_reason: str
    model_ids: tuple[str, ...] = ()


def probe_openai_compat_models_endpoint(
    *,
    base_url: str,
    api_key: str,
    timeout_seconds: float,
) -> OpenAICompatModelsProbeResult:
    normalized_base_url = str(base_url).strip().rstrip("/")
    if not normalized_base_url:
        return OpenAICompatModelsProbeResult(ok=False, reason="missing base_url")

    endpoint = f"{normalized_base_url}/models"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "User-Agent": "VidGnost/LLMConnectivity",
    }
    request = urllib.request.Request(endpoint, headers=headers, method="GET")

    try:
        with urllib.request.urlopen(request, timeout=max(1.0, float(timeout_seconds))) as response:
            status_code = int(getattr(response, "status", 200))
            if not 200 <= status_code < 300:
                return OpenAICompatModelsProbeResult(ok=False, reason=f"HTTP {status_code}", status_code=status_code)

            payload = _load_json_payload(response)
            model_ids = _extract_model_ids(payload)
            if not model_ids:
                return OpenAICompatModelsProbeResult(
                    ok=False,
                    reason=f"HTTP {status_code} (invalid /models payload)",
                    status_code=status_code,
                )

            return OpenAICompatModelsProbeResult(
                ok=True,
                reason=f"HTTP {status_code}",
                status_code=status_code,
                model_ids=model_ids,
            )
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403}:
            return OpenAICompatModelsProbeResult(
                ok=False,
                reason=f"HTTP {exc.code} (authentication rejected)",
                status_code=exc.code,
            )
        return OpenAICompatModelsProbeResult(ok=False, reason=f"HTTP {exc.code}", status_code=exc.code)
    except urllib.error.URLError as exc:
        reason = exc.reason if getattr(exc, "reason", None) is not None else exc
        reason_type = type(reason).__name__
        return OpenAICompatModelsProbeResult(ok=False, reason=f"{reason_type}: {reason}")
    except Exception as exc:  # noqa: BLE001
        return OpenAICompatModelsProbeResult(ok=False, reason=f"{type(exc).__name__}: {exc}")


def validate_openai_compat_model_config(
    *,
    base_url: str,
    api_key: str,
    model: str,
    timeout_seconds: float,
) -> OpenAICompatModelValidationResult:
    probe = probe_openai_compat_models_endpoint(
        base_url=base_url,
        api_key=api_key,
        timeout_seconds=timeout_seconds,
    )
    if not probe.ok:
        return OpenAICompatModelValidationResult(
            ok=False,
            connectivity_ok=False,
            connectivity_reason=probe.reason,
            model_ok=False,
            model_reason="未执行（连通性校验失败）",
            model_ids=probe.model_ids,
        )

    normalized_model = str(model).strip()
    if not normalized_model:
        return OpenAICompatModelValidationResult(
            ok=False,
            connectivity_ok=True,
            connectivity_reason=probe.reason,
            model_ok=False,
            model_reason="未配置模型名",
            model_ids=probe.model_ids,
        )

    available_models = {item for item in probe.model_ids if item}
    if normalized_model not in available_models:
        return OpenAICompatModelValidationResult(
            ok=False,
            connectivity_ok=True,
            connectivity_reason=probe.reason,
            model_ok=False,
            model_reason=f'远端 /models 未返回当前模型 "{normalized_model}"',
            model_ids=probe.model_ids,
        )

    return OpenAICompatModelValidationResult(
        ok=True,
        connectivity_ok=True,
        connectivity_reason=probe.reason,
        model_ok=True,
        model_reason="已匹配远端模型列表",
        model_ids=probe.model_ids,
    )


def _load_json_payload(response: object) -> Any:
    body = response.read() if hasattr(response, "read") else b""
    if isinstance(body, bytes):
        text = body.decode("utf-8", errors="replace")
    else:
        text = str(body)
    return json.loads(text or "{}")


def _extract_model_ids(payload: Any) -> tuple[str, ...]:
    if not isinstance(payload, dict):
        return ()

    raw_items = payload.get("data")
    if not isinstance(raw_items, list):
        return ()

    model_ids: list[str] = []
    for item in raw_items:
        candidate = _resolve_model_id(item)
        if candidate and candidate not in model_ids:
            model_ids.append(candidate)
    return tuple(model_ids)


def _resolve_model_id(item: Any) -> str:
    if isinstance(item, str):
        return item.strip()
    if not isinstance(item, dict):
        return ""

    for key in ("id", "model", "name"):
        candidate = str(item.get(key, "")).strip()
        if candidate:
            return candidate
    return ""
