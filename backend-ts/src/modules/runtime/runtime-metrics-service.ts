import os from "node:os"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { RuntimeMetricsResponse } from "@vidgnost/contracts"

const execFileAsync = promisify(execFile)
const CPU_SAMPLE_WINDOW_MS = 50
const NVIDIA_SMI_ARGS = [
  "--query-gpu=utilization.gpu,memory.used,memory.total",
  "--format=csv,noheader,nounits",
]

interface CpuSnapshot {
  idle: number
  total: number
}

export class RuntimeMetricsService {
  readonly #bootTime = Date.now()

  async collect(): Promise<RuntimeMetricsResponse> {
    const [cpuPercent, gpuMetrics] = await Promise.all([sampleCpuPercent(), readGpuMetrics()])
    const memoryTotal = os.totalmem()
    const memoryUsed = Math.max(0, memoryTotal - os.freemem())

    return {
      uptime_seconds: Math.max(0, Math.floor((Date.now() - this.#bootTime) / 1000)),
      cpu_percent: cpuPercent,
      memory_used_bytes: memoryUsed,
      memory_total_bytes: memoryTotal,
      gpu_percent: gpuMetrics.gpuPercent,
      gpu_memory_used_bytes: gpuMetrics.gpuMemoryUsedBytes,
      gpu_memory_total_bytes: gpuMetrics.gpuMemoryTotalBytes,
      sampled_at: new Date().toISOString(),
    }
  }
}

async function sampleCpuPercent(): Promise<number> {
  const start = readCpuSnapshot()
  await sleep(CPU_SAMPLE_WINDOW_MS)
  const end = readCpuSnapshot()

  const idleDelta = end.idle - start.idle
  const totalDelta = end.total - start.total
  if (totalDelta <= 0) {
    return 0
  }

  return roundToTwoDecimals(((totalDelta - idleDelta) / totalDelta) * 100)
}

function readCpuSnapshot(): CpuSnapshot {
  return os.cpus().reduce<CpuSnapshot>(
    (snapshot, cpu) => {
      snapshot.idle += cpu.times.idle
      snapshot.total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle
      return snapshot
    },
    { idle: 0, total: 0 },
  )
}

async function readGpuMetrics(): Promise<{
  gpuPercent: number
  gpuMemoryUsedBytes: number
  gpuMemoryTotalBytes: number
}> {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", NVIDIA_SMI_ARGS, {
      timeout: 2000,
      windowsHide: true,
    })
    const line = stdout.trim().split(/\r?\n/, 1)[0]?.trim()
    if (!line) {
      return emptyGpuMetrics()
    }

    const [gpuPercentText = "", usedText = "", totalText = ""] = line.split(",").map((item) => item.trim())
    const gpuPercent = roundToTwoDecimals(Number.parseFloat(gpuPercentText) || 0)
    const gpuMemoryUsedBytes = mibToBytes(Number.parseFloat(usedText) || 0)
    const gpuMemoryTotalBytes = mibToBytes(Number.parseFloat(totalText) || 0)

    return {
      gpuPercent,
      gpuMemoryUsedBytes,
      gpuMemoryTotalBytes,
    }
  } catch {
    return emptyGpuMetrics()
  }
}

function emptyGpuMetrics() {
  return {
    gpuPercent: 0,
    gpuMemoryUsedBytes: 0,
    gpuMemoryTotalBytes: 0,
  }
}

function mibToBytes(value: number): number {
  return Math.max(0, Math.round(value * 1024 * 1024))
}

function roundToTwoDecimals(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
