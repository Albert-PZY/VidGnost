$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $scriptDir "check-openspec.mjs") @args
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
