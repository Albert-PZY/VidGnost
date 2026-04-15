import path from "node:path"
import { createWriteStream } from "node:fs"
import { chmod, rename, rm } from "node:fs/promises"
import { spawn } from "node:child_process"
import { pipeline } from "node:stream/promises"

import { ensureDirectory, pathExists } from "./fs.js"

export class CommandExecutionError extends Error {
  readonly command: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stderr: string
  readonly stdout: string

  constructor(input: {
    command: string
    exitCode: number | null
    signal: NodeJS.Signals | null
    stderr: string
    stdout: string
  }) {
    super(buildCommandErrorMessage(input))
    this.name = "CommandExecutionError"
    this.command = input.command
    this.exitCode = input.exitCode
    this.signal = input.signal
    this.stderr = input.stderr
    this.stdout = input.stdout
  }
}

export async function findCommand(candidates: string[]): Promise<string | null> {
  for (const rawCandidate of candidates) {
    const candidate = String(rawCandidate || "").trim()
    if (!candidate) {
      continue
    }

    if (path.isAbsolute(candidate) || candidate.includes(path.sep)) {
      if (await pathExists(candidate)) {
        return path.normalize(candidate)
      }
      continue
    }

    const resolved = await resolveCommandFromPath(candidate)
    if (resolved) {
      return resolved
    }
  }

  return null
}

export async function runCommand(input: {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args || [], {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...(input.env || {}),
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let abortHandler: (() => void) | undefined

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      cleanupAbort()
      reject(error)
    })
    child.on("close", (exitCode, signal) => {
      cleanupAbort()
      if (exitCode === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(
        new CommandExecutionError({
          command: [input.command, ...(input.args || [])].join(" "),
          exitCode,
          signal,
          stderr,
          stdout,
        }),
      )
    })

    if (input.signal) {
      if (input.signal.aborted) {
        child.kill("SIGTERM")
      } else {
        abortHandler = () => {
          child.kill("SIGTERM")
        }
        input.signal.addEventListener("abort", abortHandler, { once: true })
      }
    }

    function cleanupAbort(): void {
      if (input.signal && abortHandler) {
        input.signal.removeEventListener("abort", abortHandler)
      }
    }
  })
}

export async function downloadFile(input: {
  url: string
  targetPath: string
  makeExecutable?: boolean
  signal?: AbortSignal
}): Promise<string> {
  await ensureDirectory(path.dirname(input.targetPath))

  const response = await fetch(input.url, {
    method: "GET",
    signal: input.signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download runtime binary from ${input.url}`)
  }

  const tempPath = `${input.targetPath}.${process.pid}.${Date.now()}.tmp`
  const output = createWriteStream(tempPath)
  try {
    await pipeline(response.body, output)
    if (input.makeExecutable && process.platform !== "win32") {
      await chmod(tempPath, 0o755)
    }
    await rm(input.targetPath, { force: true }).catch(() => undefined)
    await rename(tempPath, input.targetPath)
    return input.targetPath
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function resolveCommandFromPath(candidate: string): Promise<string | null> {
  const tool = process.platform === "win32" ? "where.exe" : "which"
  try {
    const result = await runCommand({
      command: tool,
      args: [candidate],
    })
    const match = result.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean)
    return match ? path.normalize(match) : null
  } catch {
    return null
  }
}

function buildCommandErrorMessage(input: {
  command: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  stderr: string
}): string {
  const stderr = input.stderr.trim()
  if (stderr) {
    return stderr
  }
  if (input.signal) {
    return `Command aborted by signal ${input.signal}: ${input.command}`
  }
  return `Command failed with exit code ${input.exitCode ?? -1}: ${input.command}`
}
