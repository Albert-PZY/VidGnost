from __future__ import annotations

import urllib.error
import urllib.request


def probe_openai_compat_models_endpoint(
    *,
    base_url: str,
    api_key: str,
    timeout_seconds: float,
) -> tuple[bool, str]:
    normalized_base_url = str(base_url).strip().rstrip("/")
    if not normalized_base_url:
        return (False, "missing base_url")

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
            if 200 <= status_code < 400:
                return (True, f"HTTP {status_code}")
            return (False, f"HTTP {status_code}")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return (True, "HTTP 404")
        if exc.code in {401, 403}:
            return (False, f"HTTP {exc.code} (authentication rejected)")
        return (False, f"HTTP {exc.code}")
    except urllib.error.URLError as exc:
        reason = exc.reason if getattr(exc, "reason", None) is not None else exc
        reason_type = type(reason).__name__
        return (False, f"{reason_type}: {reason}")
    except Exception as exc:  # noqa: BLE001
        return (False, f"{type(exc).__name__}: {exc}")
