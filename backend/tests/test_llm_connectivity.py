from __future__ import annotations

import io
import urllib.error

from app.services.llm_connectivity import (
    OpenAICompatModelsProbeResult,
    probe_openai_compat_models_endpoint,
    validate_openai_compat_model_config,
)


class _FakeResponse:
    def __init__(self, *, status: int, body: bytes) -> None:
        self.status = status
        self._body = body

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001, D401
        return False

    def read(self) -> bytes:
        return self._body


def test_probe_openai_models_endpoint_rejects_http_404(monkeypatch) -> None:
    def fake_urlopen(*_args, **_kwargs):
        raise urllib.error.HTTPError(
            url="https://example.com/v1/models",
            code=404,
            msg="Not Found",
            hdrs=None,
            fp=io.BytesIO(b'{"error":"missing"}'),
        )

    monkeypatch.setattr("app.services.llm_connectivity.urllib.request.urlopen", fake_urlopen)

    result = probe_openai_compat_models_endpoint(
        base_url="https://example.com/v1",
        api_key="sk-test",
        timeout_seconds=2.0,
    )

    assert result.ok is False
    assert result.reason == "HTTP 404"
    assert result.status_code == 404


def test_probe_openai_models_endpoint_extracts_remote_model_ids(monkeypatch) -> None:
    def fake_urlopen(*_args, **_kwargs):
        return _FakeResponse(
            status=200,
            body=(
                b'{"object":"list","data":['
                b'{"id":"qwen-plus"},'
                b'{"id":"qwen-plus"},'
                b'{"name":"qwen-max"},'
                b'"qwen-turbo"'
                b"]}"
            ),
        )

    monkeypatch.setattr("app.services.llm_connectivity.urllib.request.urlopen", fake_urlopen)

    result = probe_openai_compat_models_endpoint(
        base_url="https://example.com/v1",
        api_key="sk-test",
        timeout_seconds=2.0,
    )

    assert result.ok is True
    assert result.reason == "HTTP 200"
    assert result.model_ids == ("qwen-plus", "qwen-max", "qwen-turbo")


def test_validate_openai_model_config_rejects_unknown_model(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.llm_connectivity.probe_openai_compat_models_endpoint",
        lambda **_: OpenAICompatModelsProbeResult(
            ok=True,
            reason="HTTP 200",
            status_code=200,
            model_ids=("qwen-plus", "qwen-max"),
        ),
    )

    result = validate_openai_compat_model_config(
        base_url="https://example.com/v1",
        api_key="sk-test",
        model="test-model",
        timeout_seconds=2.0,
    )

    assert result.ok is False
    assert result.connectivity_ok is True
    assert result.model_ok is False
    assert result.model_reason == '远端 /models 未返回当前模型 "test-model"'
