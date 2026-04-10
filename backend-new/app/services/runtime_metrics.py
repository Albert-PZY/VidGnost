from __future__ import annotations

from datetime import datetime, timezone
import os
import subprocess
import time
from typing import TypedDict


class RuntimeMetrics(TypedDict):
    uptime_seconds: int
    cpu_percent: float
    memory_used_bytes: int
    memory_total_bytes: int
    gpu_percent: float
    gpu_memory_used_bytes: int
    gpu_memory_total_bytes: int
    sampled_at: str


class RuntimeMetricsService:
    def __init__(self) -> None:
        self._boot_time = time.time()

    def collect(self) -> RuntimeMetrics:
        cpu_percent = 0.0
        mem_used = 0
        mem_total = 0
        try:
            import psutil  # type: ignore

            cpu_percent = float(psutil.cpu_percent(interval=0.05))
            memory = psutil.virtual_memory()
            mem_used = int(memory.used)
            mem_total = int(memory.total)
        except Exception:  # noqa: BLE001
            pass

        gpu_percent = 0.0
        gpu_mem_used = 0
        gpu_mem_total = 0
        try:
            result = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=utilization.gpu,memory.used,memory.total",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                check=False,
                text=True,
                timeout=2,
            )
            line = (result.stdout or "").strip().splitlines()[0] if result.stdout else ""
            if line:
                fields = [item.strip() for item in line.split(",")]
                if len(fields) >= 3:
                    gpu_percent = float(fields[0])
                    gpu_mem_used = int(float(fields[1]) * 1024 * 1024)
                    gpu_mem_total = int(float(fields[2]) * 1024 * 1024)
        except Exception:  # noqa: BLE001
            pass

        uptime_seconds = max(0, int(time.time() - self._boot_time))
        return {
            "uptime_seconds": uptime_seconds,
            "cpu_percent": round(cpu_percent, 2),
            "memory_used_bytes": mem_used,
            "memory_total_bytes": mem_total,
            "gpu_percent": round(gpu_percent, 2),
            "gpu_memory_used_bytes": gpu_mem_used,
            "gpu_memory_total_bytes": gpu_mem_total,
            "sampled_at": datetime.now(timezone.utc).isoformat(),
        }
