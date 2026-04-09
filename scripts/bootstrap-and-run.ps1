param(
    [ValidateSet("web", "electron")]
    [string]$Mode = "web"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ensure-Admin {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CurrentMode
    )

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdmin) {
        return
    }

    Write-Host "[setup] Administrator privilege required. Requesting elevation (UAC prompt)..."
    $escapedScriptPath = $PSCommandPath.Replace("'", "''")
    $escapedWorkingDir = $PWD.Path.Replace("'", "''")
    $relaunchCommand = "Set-Location -LiteralPath '$escapedWorkingDir'; & '$escapedScriptPath' -Mode '$CurrentMode'"
    Start-Process -FilePath "powershell" -Verb RunAs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $relaunchCommand) | Out-Null
    Write-Host "[setup] Elevated instance launched. This window will exit."
    exit 0
}

function Resolve-CommandPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [string[]]$Candidates = @()
    )

    foreach ($candidate in @($Candidates + $Name)) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -eq $command) {
            continue
        }
        if (-not [string]::IsNullOrWhiteSpace($command.Source)) {
            return $command.Source
        }
        if (-not [string]::IsNullOrWhiteSpace($command.Path)) {
            return $command.Path
        }
    }

    throw "Command '$Name' is unavailable. Please install it and rerun the script."
}

function Get-PortOwningPids {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    try {
        return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique |
            Where-Object { $_ -and $_ -gt 0 })
    } catch {
        $matches = @(netstat -ano -p tcp | Select-String -Pattern (":{0}\s+.*LISTENING\s+(\d+)$" -f $Port))
        $pids = @()
        foreach ($match in $matches) {
            if ($match.Matches.Count -gt 0) {
                $pids += [int]$match.Matches[0].Groups[1].Value
            }
        }
        return @($pids | Select-Object -Unique)
    }
}

function Expand-ProcessTreePids {
    param(
        [int[]]$RootPids
    )

    $normalizedRoots = @($RootPids | Where-Object { $_ -and $_ -gt 0 } | Select-Object -Unique)
    if ($normalizedRoots.Count -eq 0) {
        return @()
    }

    $rows = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Select-Object ProcessId, ParentProcessId)
    if ($rows.Count -eq 0) {
        return $normalizedRoots
    }

    $childrenByParent = @{}
    foreach ($row in $rows) {
        $pid = [int]$row.ProcessId
        $parentPid = [int]$row.ParentProcessId
        if (-not $childrenByParent.ContainsKey($parentPid)) {
            $childrenByParent[$parentPid] = @()
        }
        $childrenByParent[$parentPid] += $pid
    }

    $seen = @{}
    $queue = New-Object System.Collections.Generic.Queue[int]
    foreach ($root in $normalizedRoots) {
        if (-not $seen.ContainsKey($root)) {
            $seen[$root] = $true
            $queue.Enqueue($root)
        }
    }

    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        if (-not $childrenByParent.ContainsKey($current)) {
            continue
        }
        foreach ($childPid in $childrenByParent[$current]) {
            if ($childPid -le 0 -or $seen.ContainsKey($childPid)) {
                continue
            }
            $seen[$childPid] = $true
            $queue.Enqueue($childPid)
        }
    }

    return @($seen.Keys | ForEach-Object { [int]$_ } | Sort-Object -Unique)
}

function Test-PortBindable {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($null -ne $listener) {
            try {
                $listener.Stop()
            } catch {}
        }
    }
}

function Ensure-PortFree {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    for ($attempt = 1; $attempt -le 8; $attempt++) {
        if (Test-PortBindable -Port $Port) {
            if ($attempt -eq 1) {
                Write-Host "[setup] Port $Port ($Label) is free."
            } else {
                Write-Host "[setup] Port $Port ($Label) has been released."
            }
            return
        }

        $ownerPids = @((Get-PortOwningPids -Port $Port) | Where-Object { $_ -and $_ -gt 0 -and $_ -ne $PID } | Select-Object -Unique)
        if ($ownerPids.Count -eq 0) {
            Write-Warning "[setup] Port $Port ($Label) is busy, but no PID was resolved. Waiting..."
            Start-Sleep -Milliseconds 450
            continue
        }
        $pids = @((Expand-ProcessTreePids -RootPids $ownerPids) | Where-Object { $_ -and $_ -gt 0 -and $_ -ne $PID } | Select-Object -Unique)
        if ($pids.Count -eq 0) {
            $pids = $ownerPids
        }

        if ($attempt -eq 1) {
            Write-Host "[setup] Port $Port ($Label) is occupied. Force stopping PID(s): $($pids -join ', ')"
        } else {
            Write-Warning "[setup] Port $Port ($Label) still occupied. Retry $attempt/8: $($pids -join ', ')"
        }

        foreach ($procId in $pids) {
            try {
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            } catch {}
            try {
                & taskkill.exe /PID "$procId" /T /F *> $null
            } catch {}
        }
        Start-Sleep -Milliseconds 450
    }

    if (-not (Test-PortBindable -Port $Port)) {
        $remaining = @(Get-PortOwningPids -Port $Port)
        if ($remaining.Count -gt 0) {
            throw "Port $Port ($Label) is still occupied by PID(s): $($remaining -join ', ')."
        }
        throw "Port $Port ($Label) is still occupied and cannot be resolved. Try rerunning as Administrator."
    }
}

function Wait-PortReady {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [int]$TimeoutSeconds = 25
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $pids = @(Get-PortOwningPids -Port $Port)
        if ($pids.Count -gt 0) {
            Write-Host "[ready] Port $Port ($Label) is listening. PID(s): $($pids -join ', ')"
            return
        }
        Start-Sleep -Milliseconds 400
    }
    throw "Port $Port ($Label) did not become ready within $TimeoutSeconds seconds."
}

function Get-ElectronAppPids {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FrontendPath
    )

    $rows = @(Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue)
    $pids = @()
    foreach ($row in $rows) {
        $commandLine = [string]$row.CommandLine
        if ([string]::IsNullOrWhiteSpace($commandLine)) {
            continue
        }
        if ($commandLine.Contains($FrontendPath)) {
            $pids += [int]$row.ProcessId
        }
    }
    return @($pids | Select-Object -Unique)
}

function Stop-ElectronAppProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FrontendPath
    )

    $targets = @((Get-ElectronAppPids -FrontendPath $FrontendPath) | Where-Object { $_ -and $_ -gt 0 -and $_ -ne $PID } | Select-Object -Unique)
    if ($targets.Count -eq 0) {
        return
    }
    Write-Host "[setup] Cleaning stale Electron process(es): $($targets -join ', ')"
    foreach ($procId in $targets) {
        try {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        } catch {}
        try {
            & taskkill.exe /PID "$procId" /T /F *> $null
        } catch {}
    }
}

function Wait-ElectronReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FrontendPath,
        [Parameter(Mandatory = $true)]
        [int]$LauncherPid,
        [int]$TimeoutSeconds = 45
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $launcher = Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue
        if ($null -eq $launcher) {
            throw "Frontend launcher process exited before Electron app became ready."
        }

        $electronPids = @((Get-ElectronAppPids -FrontendPath $FrontendPath) | Where-Object { $_ -ne $LauncherPid })
        if ($electronPids.Count -gt 0) {
            Write-Host "[ready] Electron app process PID(s): $($electronPids -join ', ')"
            return
        }
        Start-Sleep -Milliseconds 400
    }

    throw "Electron app did not become ready within $TimeoutSeconds seconds."
}

Ensure-Admin -CurrentMode $Mode

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$BackendPort = 8000
$FrontendPort = 5173
$PinnedPythonVersion = "3.12"
$UvDefaultIndexMirror = if ($env:UV_DEFAULT_INDEX_MIRROR) { $env:UV_DEFAULT_INDEX_MIRROR } else { "https://pypi.tuna.tsinghua.edu.cn/simple" }
$PnpmRegistryMirror = if ($env:PNPM_REGISTRY_MIRROR) { $env:PNPM_REGISTRY_MIRROR } else { "https://registry.npmmirror.com" }

if ([string]::IsNullOrWhiteSpace($env:COREPACK_NPM_REGISTRY)) {
    $env:COREPACK_NPM_REGISTRY = $PnpmRegistryMirror
}

$uvExe = Resolve-CommandPath -Name "uv" -Candidates @("uv.exe")
$pnpmExe = Resolve-CommandPath -Name "pnpm" -Candidates @("pnpm.cmd", "pnpm.exe")
& $pnpmExe config set registry $PnpmRegistryMirror | Out-Null
$uvIndexDisplay = $UvDefaultIndexMirror
Write-Host "[setup] Mirrors configured (uv index-url: $uvIndexDisplay, pnpm: $PnpmRegistryMirror)."

Ensure-PortFree -Port $BackendPort -Label "backend"
if ($Mode -eq "web") {
    Ensure-PortFree -Port $FrontendPort -Label "frontend"
}

Write-Host "[setup] Sync backend dependencies..."
Push-Location $BackendDir
$uvSyncArgs = @("sync", "--python", $PinnedPythonVersion)
$uvSyncArgs += @("--index-url", $UvDefaultIndexMirror)
& $uvExe @uvSyncArgs
Pop-Location

Write-Host "[setup] Install frontend dependencies..."
Push-Location $FrontendDir
& $pnpmExe install
Pop-Location

$escapedBackendDir = $BackendDir.Replace("'", "''")
$escapedFrontendDir = $FrontendDir.Replace("'", "''")
$backendCommand = @"
Set-Location -LiteralPath '$escapedBackendDir'
`$env:PYTHONUTF8 = '1'
`$env:PYTHONIOENCODING = 'utf-8'
Write-Host '[run] Backend live logs (Ctrl+C to stop this window).'
uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app --reload-exclude=.venv/* --reload-exclude=storage/*
"@
if ($Mode -eq "electron") {
    Stop-ElectronAppProcesses -FrontendPath $FrontendDir
    $frontendCommand = @"
Set-Location -LiteralPath '$escapedFrontendDir'
Write-Host '[run] Frontend desktop live logs (Ctrl+C to stop this window).'
pnpm desktop:dev
"@
} else {
    $frontendCommand = @"
Set-Location -LiteralPath '$escapedFrontendDir'
Write-Host '[run] Frontend live logs (Ctrl+C to stop this window).'
pnpm dev --host 0.0.0.0 --port 5173
"@
}

Write-Host "[run] Starting backend..."
$backendProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand) -PassThru
Wait-PortReady -Port $BackendPort -Label "backend"

Write-Host "[run] Starting frontend ($Mode)..."
$frontendProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $frontendCommand) -PassThru
if ($Mode -eq "electron") {
    Wait-ElectronReady -FrontendPath $FrontendDir -LauncherPid $frontendProc.Id
} else {
    Wait-PortReady -Port $FrontendPort -Label "frontend"
}

$backendListenPids = @(Get-PortOwningPids -Port $BackendPort)
$frontendListenPids = if ($Mode -eq "electron") {
    @(Get-ElectronAppPids -FrontendPath $FrontendDir)
} else {
    @(Get-PortOwningPids -Port $FrontendPort)
}
$stopPids = @($backendListenPids + $frontendListenPids) | Select-Object -Unique
Write-Host "[ready] Backend launcher PID: $($backendProc.Id)"
Write-Host "[ready] Frontend launcher PID: $($frontendProc.Id)"
Write-Host "[ready] Backend service PID(s): $($backendListenPids -join ', ')"
Write-Host "[ready] Frontend service PID(s): $($frontendListenPids -join ', ')"
Write-Host "[ready] Frontend mode: $Mode"
if ($stopPids.Count -gt 0) {
    Write-Host "[ready] Stop all with: Stop-Process -Id $($stopPids -join ',')"
} else {
    Write-Host "[ready] Stop all with: Stop-Process -Id $($backendProc.Id),$($frontendProc.Id)"
}
