from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ManagedModelSpec:
    model_id: str
    component: str
    backend: str
    remote_id: str
    target_dir_name: str = ""
    revision: str = "main"
    required_files: tuple[str, ...] | None = None


MANAGED_MODEL_SPECS: dict[str, ManagedModelSpec] = {
    "whisper-default": ManagedModelSpec(
        model_id="whisper-default",
        component="whisper",
        backend="whisper",
        remote_id="Systran/faster-whisper-small",
        target_dir_name="faster-whisper-small",
        required_files=(
            "config.json",
            "model.bin",
            "tokenizer.json",
            "vocabulary.txt",
        ),
    ),
    "embedding-default": ManagedModelSpec(
        model_id="embedding-default",
        component="embedding",
        backend="ollama",
        remote_id="bge-m3",
    ),
    "vlm-default": ManagedModelSpec(
        model_id="vlm-default",
        component="vlm",
        backend="ollama",
        remote_id="moondream",
    ),
    "rerank-default": ManagedModelSpec(
        model_id="rerank-default",
        component="rerank",
        backend="ollama",
        remote_id="sam860/qwen3-reranker:0.6b-q8_0",
    ),
    "llm-default": ManagedModelSpec(
        model_id="llm-default",
        component="llm",
        backend="ollama",
        remote_id="qwen2.5:3b",
    ),
}


def get_managed_model_spec(model_id: str) -> ManagedModelSpec | None:
    return MANAGED_MODEL_SPECS.get(model_id)


def supports_managed_download(model_id: str) -> bool:
    return model_id in MANAGED_MODEL_SPECS


def managed_model_target_dir(storage_dir: str, spec: ManagedModelSpec) -> Path:
    return Path(storage_dir) / "model-hub" / spec.target_dir_name
