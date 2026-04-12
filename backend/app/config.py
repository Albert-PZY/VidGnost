from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _resolve_path(path_value: str) -> Path:
    candidate = Path(path_value).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()
    return (_BACKEND_ROOT / candidate).resolve()


@dataclass(slots=True)
class Settings:
    app_name: str = "VidGnost API"
    api_prefix: str = "/api"
    debug: bool = False

    storage_dir: str = "./storage"
    temp_dir: str = "./storage/tmp"
    upload_dir: str = "./storage/uploads"
    output_dir: str = "./storage/outputs"

    max_upload_mb: int = 1024
    max_concurrent_jobs: int = 2
    max_local_mode_jobs: int = 1
    max_api_mode_jobs: int = 2
    max_cached_whisper_models: int = 2
    max_cached_llm_models: int = 1
    task_history_max_items: int = 240
    task_artifact_budget_bytes: int = 2 * 1024 * 1024 * 1024

    llm_api_key: str = ""
    llm_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    llm_model: str = "qwen3.5-flash"
    llm_mode: str = "local"
    llm_local_model_id: str = "Qwen/Qwen2.5-7B-Instruct"
    llm_timeout_seconds: int = 120
    llm_correction_mode: str = "strict"
    llm_correction_batch_size: int = 24
    llm_correction_overlap: int = 3
    llm_config_path: str = "./storage/model_config.json"
    runtime_config_path: str = "./storage/config.toml"
    enable_mock_llm: bool = False

    allow_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:6221,http://127.0.0.1:6221"

    def __post_init__(self) -> None:
        self.max_concurrent_jobs = max(1, int(self.max_concurrent_jobs))
        self.max_local_mode_jobs = max(1, int(self.max_local_mode_jobs))
        self.max_api_mode_jobs = max(1, int(self.max_api_mode_jobs))
        self.max_cached_whisper_models = max(1, int(self.max_cached_whisper_models))
        self.max_cached_llm_models = max(1, int(self.max_cached_llm_models))

        self.storage_dir = str(_resolve_path(self.storage_dir))
        self.temp_dir = str(_resolve_path(self.temp_dir))
        self.upload_dir = str(_resolve_path(self.upload_dir))
        self.output_dir = str(_resolve_path(self.output_dir))
        self.llm_config_path = str(_resolve_path(self.llm_config_path))
        self.runtime_config_path = str(_resolve_path(self.runtime_config_path))

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allow_origins.split(",") if origin.strip()]

    def ensure_directories(self) -> None:
        for directory in (self.storage_dir, self.temp_dir, self.upload_dir, self.output_dir):
            Path(directory).mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_directories()
    return settings
