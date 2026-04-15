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
    (Join-Path $RepoRoot "backend-ts\dist"),
    (Join-Path $RepoRoot "backend-ts\coverage"),
    (Join-Path $RepoRoot "frontend\.vite"),
    (Join-Path $RepoRoot "frontend\node_modules\.vite"),
    (Join-Path $RepoRoot "frontend\dist"),
    (Join-Path $RepoRoot "frontend\coverage"),
    (Join-Path $RepoRoot "packages\contracts\dist"),
    (Join-Path $RepoRoot "packages\contracts\coverage"),
    (Join-Path $RepoRoot "packages\shared\dist"),
    (Join-Path $RepoRoot "packages\shared\coverage"),
    (Join-Path $RepoRoot ".turbo"),
    (Join-Path $RepoRoot ".cache")
)

foreach ($target in $targets) {
    Remove-WorkspaceItem -Path $target
}
