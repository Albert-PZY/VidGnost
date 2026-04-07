Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$InstallTimeoutSeconds = if ($env:INSTALL_TIMEOUT_SECONDS) { [int]$env:INSTALL_TIMEOUT_SECONDS } else { 45 }
$UvInstallerMirrorBaseUrl = if ($env:UV_INSTALLER_MIRROR_BASE_URL) { $env:UV_INSTALLER_MIRROR_BASE_URL } else { "https://ghproxy.net/https://github.com" }
$PnpmRegistryMirror = if ($env:PNPM_REGISTRY_MIRROR) { $env:PNPM_REGISTRY_MIRROR } else { "https://registry.npmmirror.com" }
$UvDefaultIndexMirror = if ($env:UV_DEFAULT_INDEX_MIRROR) { $env:UV_DEFAULT_INDEX_MIRROR } else { "https://pypi.tuna.tsinghua.edu.cn/simple" }
$PinnedPythonVersion = "3.12"

function Write-Step([string]$message) {
    Write-Host "[auto-fix] $message"
}

function Invoke-ProcessWithTimeout {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList,
        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $stdoutFile = [System.IO.Path]::GetTempFileName()
    $stderrFile = [System.IO.Path]::GetTempFileName()
    try {
        $proc = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -NoNewWindow -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
        if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
            try {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            } catch {}
            return [PSCustomObject]@{
                Success  = $false
                TimedOut = $true
                ExitCode = 124
                StdOut   = Get-Content -LiteralPath $stdoutFile -Raw -ErrorAction SilentlyContinue
                StdErr   = Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue
            }
        }

        return [PSCustomObject]@{
            Success  = ($proc.ExitCode -eq 0)
            TimedOut = $false
            ExitCode = $proc.ExitCode
            StdOut   = Get-Content -LiteralPath $stdoutFile -Raw -ErrorAction SilentlyContinue
            StdErr   = Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue
        }
    } finally {
        Remove-Item -LiteralPath $stdoutFile,$stderrFile -Force -ErrorAction SilentlyContinue
    }
}

function Write-ProcessStreams {
    param(
        [Parameter(Mandatory = $true)]
        [PSCustomObject]$Result
    )

    if (-not [string]::IsNullOrWhiteSpace($Result.StdOut)) {
        Write-Host ($Result.StdOut.TrimEnd())
    }
    if (-not [string]::IsNullOrWhiteSpace($Result.StdErr)) {
        Write-Warning ($Result.StdErr.TrimEnd())
    }
}

function Ensure-Uv {
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        return
    }
    Write-Step "uv not found. Installing latest from mirror..."
    $hadMirrorEnv = Test-Path -Path "Env:UV_INSTALLER_GITHUB_BASE_URL"
    $previousMirrorEnv = $env:UV_INSTALLER_GITHUB_BASE_URL
    $env:UV_INSTALLER_GITHUB_BASE_URL = $UvInstallerMirrorBaseUrl
    try {
        $mirrorResult = Invoke-ProcessWithTimeout -FilePath "powershell" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://astral.sh/uv/install.ps1 | iex") -TimeoutSeconds $InstallTimeoutSeconds
    } finally {
        if ($hadMirrorEnv) {
            $env:UV_INSTALLER_GITHUB_BASE_URL = $previousMirrorEnv
        } else {
            Remove-Item -Path "Env:UV_INSTALLER_GITHUB_BASE_URL" -ErrorAction SilentlyContinue
        }
    }
    Write-ProcessStreams -Result $mirrorResult

    if (-not $mirrorResult.Success) {
        if ($mirrorResult.TimedOut) {
            Write-Step "Mirror uv installer timed out after $InstallTimeoutSeconds seconds. Falling back to official source..."
        } else {
            Write-Step "Mirror uv installer failed (exit $($mirrorResult.ExitCode)). Falling back to official source..."
        }

        $officialResult = Invoke-ProcessWithTimeout -FilePath "powershell" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://astral.sh/uv/install.ps1 | iex") -TimeoutSeconds $InstallTimeoutSeconds
        Write-ProcessStreams -Result $officialResult
        if (-not $officialResult.Success) {
            Write-Step "Failed to install uv from both mirror and official source."
            return
        }
    }

    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    }
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        Write-Step "uv command is still unavailable after installation."
    }
}

function Ensure-Pnpm {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        return
    }
    if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
        Write-Step "corepack unavailable. Cannot auto-install pnpm."
        return
    }

    Write-Step "pnpm not found. Enabling via corepack (mirror first)..."
    corepack enable

    $hadRegistryEnv = Test-Path -Path "Env:COREPACK_NPM_REGISTRY"
    $previousRegistryEnv = $env:COREPACK_NPM_REGISTRY
    $env:COREPACK_NPM_REGISTRY = $PnpmRegistryMirror
    try {
        $mirrorResult = Invoke-ProcessWithTimeout -FilePath "corepack" -ArgumentList @("prepare", "pnpm@latest", "--activate") -TimeoutSeconds $InstallTimeoutSeconds
    } finally {
        if ($hadRegistryEnv) {
            $env:COREPACK_NPM_REGISTRY = $previousRegistryEnv
        } else {
            Remove-Item -Path "Env:COREPACK_NPM_REGISTRY" -ErrorAction SilentlyContinue
        }
    }
    Write-ProcessStreams -Result $mirrorResult

    if (-not $mirrorResult.Success) {
        if ($mirrorResult.TimedOut) {
            Write-Step "Mirror pnpm install timed out after $InstallTimeoutSeconds seconds. Falling back to official source..."
        } else {
            Write-Step "Mirror pnpm install failed (exit $($mirrorResult.ExitCode)). Falling back to official source..."
        }

        $officialResult = Invoke-ProcessWithTimeout -FilePath "corepack" -ArgumentList @("prepare", "pnpm@latest", "--activate") -TimeoutSeconds $InstallTimeoutSeconds
        Write-ProcessStreams -Result $officialResult
        if (-not $officialResult.Success) {
            Write-Step "Failed to install pnpm from both mirror and official source."
            return
        }
    }

    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Step "pnpm command is still unavailable after installation."
    }
}

function Configure-DependencyMirrors {
    if ([string]::IsNullOrWhiteSpace($env:UV_DEFAULT_INDEX)) {
        $env:UV_DEFAULT_INDEX = $UvDefaultIndexMirror
    }
    if ([string]::IsNullOrWhiteSpace($env:COREPACK_NPM_REGISTRY)) {
        $env:COREPACK_NPM_REGISTRY = $PnpmRegistryMirror
    }

    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        pnpm config set registry $PnpmRegistryMirror | Out-Null
    }

    $uvIndexDisplay = $UvDefaultIndexMirror
    Write-Step "Dependency mirrors configured (uv index-url: $uvIndexDisplay, pnpm: $PnpmRegistryMirror)."
}

function Repair-BackendVenvIfNeeded {
    $venvDir = Join-Path $BackendDir ".venv"
    if (-not (Test-Path -LiteralPath $venvDir -PathType Container)) {
        return
    }

    $windowsPython = Join-Path $venvDir "Scripts\python.exe"
    $linuxPython = Join-Path $venvDir "bin\python"
    $rebuildReason = $null

    if ((Test-Path -LiteralPath $linuxPython) -and -not (Test-Path -LiteralPath $windowsPython)) {
        $rebuildReason = "detected Linux-style .venv in Windows runtime"
    } elseif (-not (Test-Path -LiteralPath $windowsPython)) {
        $rebuildReason = "missing .venv\Scripts\python.exe"
    }

    $pyvenvCfg = Join-Path $venvDir "pyvenv.cfg"
    if (-not $rebuildReason -and (Test-Path -LiteralPath $pyvenvCfg)) {
        $homeLine = Get-Content -LiteralPath $pyvenvCfg | Where-Object { $_ -match "^\s*home\s*=" } | Select-Object -First 1
        if ($homeLine) {
            $homeValue = ($homeLine -split "=", 2)[1].Trim()
            if ($homeValue -match "^/") {
                $rebuildReason = "pyvenv home points to Linux interpreter ($homeValue)"
            }
        }
        if (-not $rebuildReason) {
            $versionLine = Get-Content -LiteralPath $pyvenvCfg | Where-Object { $_ -match "^\s*version_info\s*=" } | Select-Object -First 1
            if ($versionLine) {
                $versionValue = ($versionLine -split "=", 2)[1].Trim()
                if ($versionValue -notmatch "^3\.12(\.|$)") {
                    $rebuildReason = "pyvenv version_info is $versionValue (requires 3.12.x)"
                }
            }
        }
    }

    if ($rebuildReason) {
        Write-Step "Rebuilding backend .venv due to compatibility conflict: $rebuildReason"
        Remove-Item -LiteralPath $venvDir -Recurse -Force
    }
}

function Ensure-BackendRuntimeFiles {
    Write-Step "Ensuring runtime config files exist..."
    Push-Location $BackendDir
    try {
        $script = @'
import asyncio

from app.config import get_settings
from app.services.llm_config_store import LLMConfigStore
from app.services.runtime_config_store import RuntimeConfigStore

settings = get_settings()

async def main():
    llm_store = LLMConfigStore(settings)
    await llm_store.get()
    runtime_store = RuntimeConfigStore(settings)
    await runtime_store.get_whisper()

asyncio.run(main())
print("runtime config files are ready")
'@
        $script | uv run python -
    } finally {
        Pop-Location
    }
}

function Ensure-Ffmpeg {
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
        Write-Step "ffmpeg already exists."
        return
    }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Step "ffmpeg missing and winget unavailable. Please install ffmpeg manually."
        return
    }
    Write-Step "ffmpeg missing. Attempting winget install..."
    try {
        winget install --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements --silent
    } catch {
        Write-Step "winget install failed. Please install ffmpeg manually."
    }
}

Write-Step "Running cross-platform auto-fix workflow..."
Ensure-Uv
Ensure-Pnpm
Configure-DependencyMirrors
Repair-BackendVenvIfNeeded

Write-Step "Sync backend dependencies..."
Push-Location $BackendDir
$uvSyncArgs = @("sync")
$uvSyncArgs += @("--python", $PinnedPythonVersion)
$uvSyncArgs += @("--index-url", $UvDefaultIndexMirror)
uv @uvSyncArgs
Pop-Location

Write-Step "Install frontend dependencies..."
Push-Location $FrontendDir
pnpm install
Pop-Location

Ensure-Ffmpeg
Ensure-BackendRuntimeFiles

Write-Step "Auto-fix workflow finished."
