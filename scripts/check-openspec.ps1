$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
python (Join-Path $scriptDir "check-openspec.py") @args
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
