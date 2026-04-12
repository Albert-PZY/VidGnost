Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Remove-WorkspaceItem {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if (-not $resolved.StartsWith($RepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to delete path outside workspace: $resolved"
    }

    Remove-Item -LiteralPath $resolved -Recurse -Force
    Write-Host "[clean] Removed $resolved"
}

function Remove-WorkspaceLogs {
    $patterns = @("*.log")
    foreach ($pattern in $patterns) {
        Get-ChildItem -LiteralPath $RepoRoot -File -Filter $pattern -Force -ErrorAction SilentlyContinue |
            ForEach-Object {
                $resolved = $_.FullName
                if (-not $resolved.StartsWith($RepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                    throw "Refusing to delete path outside workspace: $resolved"
                }
                Remove-Item -LiteralPath $resolved -Force
                Write-Host "[clean] Removed $resolved"
            }
    }
}

Remove-WorkspaceLogs

$targets = @(
    (Join-Path $RepoRoot "backend\.mypy_cache"),
    (Join-Path $RepoRoot "backend\.pytest_cache"),
    (Join-Path $RepoRoot "backend\.ruff_cache"),
    (Join-Path $RepoRoot "backend\app\__pycache__"),
    (Join-Path $RepoRoot "backend\app\api\__pycache__"),
    (Join-Path $RepoRoot "backend\app\services\__pycache__"),
    (Join-Path $RepoRoot "frontend\.vite"),
    (Join-Path $RepoRoot "frontend\node_modules\.vite"),
    (Join-Path $RepoRoot "frontend\dist")
)

foreach ($target in $targets) {
    Remove-WorkspaceItem -Path $target
}
