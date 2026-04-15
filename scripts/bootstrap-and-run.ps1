Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

function Convert-ToEncodedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandText
    )

    return [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($CommandText))
}

function Get-PortOwningPids {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    try {
        return @(Get-NetTCPConnection -LocalPort $Port -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique |
            Where-Object { $_ -and $_ -gt 0 })
    } catch {
        $matches = @(netstat -ano -p tcp | Select-String -Pattern (":{0}\s+.+\s+(\d+)\s*$" -f $Port))
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
        throw "Port $Port ($Label) is still occupied and cannot be resolved."
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

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$FrontendDir = Join-Path $RootDir "apps\desktop"
$BackendPort = 8666
$FrontendPort = 6221
$StorageDir = Join-Path $RootDir "storage"
$PnpmRegistryMirror = if ($env:PNPM_REGISTRY_MIRROR) { $env:PNPM_REGISTRY_MIRROR } else { "https://registry.npmmirror.com" }
$ElectronMirror = if ($env:ELECTRON_MIRROR) { $env:ELECTRON_MIRROR } else { "https://npmmirror.com/mirrors/electron/" }

if ([string]::IsNullOrWhiteSpace($env:COREPACK_NPM_REGISTRY)) {
    $env:COREPACK_NPM_REGISTRY = $PnpmRegistryMirror
}
if ([string]::IsNullOrWhiteSpace($env:ELECTRON_MIRROR)) {
    $env:ELECTRON_MIRROR = $ElectronMirror
}

$pnpmExe = Resolve-CommandPath -Name "pnpm" -Candidates @("pnpm.cmd", "pnpm.exe")
$null = New-Item -ItemType Directory -Path $StorageDir -Force
& $pnpmExe config set registry $PnpmRegistryMirror | Out-Null
Write-Host "[setup] Mirrors configured (pnpm: $PnpmRegistryMirror, electron: $($env:ELECTRON_MIRROR))."

Ensure-PortFree -Port $BackendPort -Label "backend"
Ensure-PortFree -Port $FrontendPort -Label "frontend"

Write-Host "[setup] Install workspace dependencies..."
Push-Location $RootDir
& $pnpmExe install
Pop-Location

$escapedRootDir = $RootDir.Replace("'", "''")
$escapedFrontendDir = $FrontendDir.Replace("'", "''")
$escapedStorageDir = $StorageDir.Replace("'", "''")

$backendCommand = @"
Set-Location -LiteralPath '$escapedRootDir'
`$env:VIDGNOST_API_HOST = '127.0.0.1'
`$env:VIDGNOST_API_PORT = '$BackendPort'
`$env:VIDGNOST_STORAGE_DIR = '$escapedStorageDir'
Write-Host '[run] Backend live logs (Ctrl+C to stop this window).'
Write-Host '[run] Backend URL: http://127.0.0.1:$BackendPort/api'
pnpm --filter @vidgnost/api dev
"@

Stop-ElectronAppProcesses -FrontendPath $FrontendDir
$frontendCommand = @"
Set-Location -LiteralPath '$escapedRootDir'
`$env:VITE_API_BASE_URL = 'http://127.0.0.1:$BackendPort/api'
`$env:VITE_DEV_SERVER_URL = 'http://127.0.0.1:$FrontendPort'
Write-Host '[run] Frontend desktop live logs (Ctrl+C to stop this window).'
Write-Host '[run] Backend API base: http://127.0.0.1:$BackendPort/api'
Write-Host '[run] Frontend dev server: http://127.0.0.1:$FrontendPort'
pnpm --filter @vidgnost/desktop desktop:dev
"@

$encodedBackendCommand = Convert-ToEncodedCommand -CommandText $backendCommand
$encodedFrontendCommand = Convert-ToEncodedCommand -CommandText $frontendCommand

Write-Host "[run] Starting backend at http://127.0.0.1:$BackendPort/api ..."
$backendProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encodedBackendCommand) -PassThru
Wait-PortReady -Port $BackendPort -Label "backend"

Write-Host "[run] Starting frontend (electron)..."
$frontendProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encodedFrontendCommand) -PassThru
Wait-ElectronReady -FrontendPath $FrontendDir -LauncherPid $frontendProc.Id

$backendListenPids = @(Get-PortOwningPids -Port $BackendPort)
$frontendListenPids = @(Get-ElectronAppPids -FrontendPath $FrontendDir)
$stopPids = @($backendListenPids + $frontendListenPids) | Select-Object -Unique
Write-Host "[ready] Backend launcher PID: $($backendProc.Id)"
Write-Host "[ready] Frontend launcher PID: $($frontendProc.Id)"
Write-Host "[ready] Backend service PID(s): $($backendListenPids -join ', ')"
Write-Host "[ready] Frontend service PID(s): $($frontendListenPids -join ', ')"
Write-Host "[ready] Frontend mode: electron"
Write-Host "[ready] Backend API URL: http://127.0.0.1:$BackendPort/api"
Write-Host "[ready] Frontend dev server URL: http://127.0.0.1:$FrontendPort"
if ($stopPids.Count -gt 0) {
    Write-Host "[ready] Stop all with: Stop-Process -Id $($stopPids -join ',')"
} else {
    Write-Host "[ready] Stop all with: Stop-Process -Id $($backendProc.Id),$($frontendProc.Id)"
}
