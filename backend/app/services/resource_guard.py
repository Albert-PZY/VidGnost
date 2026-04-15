from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

import psutil

from app.config import Settings
from app.services.llm_config_store import LLMConfig
from app.services.runtime_config_store import WhisperRuntimeConfig

_GIB = 1024 * 1024 * 1024
_MIB = 1024 * 1024
_WHISPER_MEMORY_SOFT_LIMIT_BYTES = 4 * _GIB
_WHISPER_MEMORY_HARD_LIMIT_BYTES = 3 * _GIB

_MIN_BASELINE_ANALYSIS_BYTES = 3 * _GIB
_MIN_BASELINE_SYSTEM_MEMORY_BYTES = 2 * _GIB


class GuardResult(TypedDict):
    config: dict
    warnings: list[str]
    rollback_applied: bool


@dataclass(slots=True)
class ResourceGuard:
    settings: Settings

    def startup_warning(self) -> str | None:
        free_bytes = self._free_bytes()
        if free_bytes >= _MIN_BASELINE_ANALYSIS_BYTES:
            return None
        return (
            "当前磁盘剩余空间偏低，可能不足以稳定执行最小分析流程。"
            f"建议至少保留 {_format_bytes(_MIN_BASELINE_ANALYSIS_BYTES)}，"
            f"当前仅 {_format_bytes(free_bytes)}。"
        )

    def guard_whisper_config(self, config: WhisperRuntimeConfig) -> GuardResult:
        adjusted: WhisperRuntimeConfig = dict(config)
        warnings: list[str] = []
        rollback_applied = False
        available_memory = self._available_system_memory_bytes()

        if available_memory is not None and available_memory < _WHISPER_MEMORY_SOFT_LIMIT_BYTES:
            if str(adjusted.get("model_load_profile", "")).strip().lower() != "memory_first":
                adjusted["model_load_profile"] = "memory_first"
                rollback_applied = True
                warnings.append(
                    "检测到系统可用内存偏低，转写已自动切换到低内存加载策略。"
                    f" 当前约 {_format_bytes(available_memory)} 可用。"
                )

            beam_size = int(adjusted.get("beam_size", 5) or 5)
            recommended_beam_size = 2 if available_memory >= _WHISPER_MEMORY_HARD_LIMIT_BYTES else 1
            if beam_size > recommended_beam_size:
                adjusted["beam_size"] = recommended_beam_size
                rollback_applied = True
                warnings.append(
                    "检测到系统可用内存偏低，已自动下调 Whisper Beam Size 以降低峰值内存占用。"
                )

            chunk_seconds = int(adjusted.get("chunk_seconds", 180) or 180)
            max_chunk_seconds = 180 if available_memory >= _WHISPER_MEMORY_HARD_LIMIT_BYTES else 120
            if chunk_seconds > max_chunk_seconds:
                adjusted["chunk_seconds"] = max_chunk_seconds
                rollback_applied = True
                warnings.append(
                    "检测到系统可用内存偏低，已自动缩短转写音频分片时长以降低内存压力。"
                )

        return {
            "config": adjusted,
            "warnings": warnings,
            "rollback_applied": rollback_applied,
        }

    def guard_llm_config(self, config: LLMConfig) -> GuardResult:
        adjusted: LLMConfig = dict(config)
        warnings: list[str] = []
        rollback_applied = False

        if str(adjusted.get("mode", "api")).strip().lower() != "api":
            adjusted["mode"] = "api"
            rollback_applied = True
            warnings.append("LLM 已自动切换为 API 模式：本地模式已移除。")

        return {
            "config": adjusted,
            "warnings": warnings,
            "rollback_applied": rollback_applied,
        }

    def ensure_runtime_capacity(self, whisper: WhisperRuntimeConfig, llm: LLMConfig) -> list[str]:
        warnings: list[str] = []

        free_bytes = self._free_bytes()
        if free_bytes < _MIN_BASELINE_ANALYSIS_BYTES:
            warnings.append(
                "磁盘空间不足最小分析建议值，任务可能失败。"
                f" 建议 >= {_format_bytes(_MIN_BASELINE_ANALYSIS_BYTES)}，当前 {_format_bytes(free_bytes)}。"
            )
        available_memory = self._available_system_memory_bytes()
        if available_memory is not None and available_memory < _MIN_BASELINE_SYSTEM_MEMORY_BYTES:
            warnings.append(
                "系统可用内存较低，可能影响稳定性。"
                f" 建议 >= {_format_bytes(_MIN_BASELINE_SYSTEM_MEMORY_BYTES)}，当前 {_format_bytes(available_memory)}。"
            )

        if str(llm.get("mode", "api")).strip().lower() != "api":
            warnings.append("LLM 本地模式已弃用，当前任务会按 API 模式执行。")

        return warnings

    def _free_bytes(self) -> int:
        base_path = Path(self.settings.storage_dir)
        base_path.mkdir(parents=True, exist_ok=True)
        return int(shutil.disk_usage(base_path).free)

    @staticmethod
    def _available_system_memory_bytes() -> int | None:
        try:
            memory = psutil.virtual_memory()
            available = int(getattr(memory, "available", 0) or 0)
            if available > 0:
                return available
        except Exception:  # noqa: BLE001
            pass
        if not hasattr(os, "sysconf"):
            return None
        names = getattr(os, "sysconf_names", {})
        if "SC_AVPHYS_PAGES" not in names or "SC_PAGE_SIZE" not in names:
            return None
        try:
            available_pages = int(os.sysconf("SC_AVPHYS_PAGES"))
            page_size = int(os.sysconf("SC_PAGE_SIZE"))
        except (TypeError, ValueError, OSError):
            return None
        if available_pages <= 0 or page_size <= 0:
            return None
        return available_pages * page_size


def _format_bytes(value: int) -> str:
    if value >= _GIB:
        return f"{value / _GIB:.1f} GiB"
    return f"{value / _MIB:.0f} MiB"
