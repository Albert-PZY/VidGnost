param(
    [ValidateSet("web", "electron")]
    [string]$Mode = "electron"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptPath = Join-Path $RepoRoot "scripts/bootstrap-and-run.ps1"

if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "Missing script: $ScriptPath"
}

& powershell -ExecutionPolicy Bypass -File $ScriptPath -Mode $Mode
