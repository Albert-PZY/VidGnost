param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir,
  [bool]$AutoConfigureEnv = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProgressPreference = "SilentlyContinue"

$cudaRedistVersion = "12.9.1"
$cudnnRedistVersion = "9.20.0"
$progressPrefix = "VIDGNOST_GPU_RUNTIME_PROGRESS:"
$cudaManifestUrl = "https://developer.download.nvidia.com/compute/cuda/redist/redistrib_$cudaRedistVersion.json"
$cudnnManifestUrl = "https://developer.download.nvidia.com/compute/cudnn/redist/redistrib_$cudnnRedistVersion.json"
$cudaBaseUrl = "https://developer.download.nvidia.com/compute/cuda/redist"
$cudnnBaseUrl = "https://developer.download.nvidia.com/compute/cudnn/redist"
$cudaComponents = @(
  "cuda_cudart",
  "cuda_nvrtc",
  "libcublas",
  "libcufft",
  "libcurand",
  "libcusolver",
  "libcusparse",
  "libnvjitlink",
  "libnpp"
)

function Write-Stage {
  param(
    [string]$Message,
    [string]$CurrentPackage = "",
    [int64]$DownloadedBytes = 0,
    [int64]$TotalBytes = 0,
    [double]$Percent = 0
  )

  $payload = @{
    message = $Message
    current_package = $CurrentPackage
    downloaded_bytes = [Math]::Max(0, [int64]$DownloadedBytes)
    total_bytes = [Math]::Max(0, [int64]$TotalBytes)
    percent = [Math]::Max(0, [Math]::Min(100, [double]$Percent))
  } | ConvertTo-Json -Compress

  Write-Output "$progressPrefix$payload"
}

function Get-Json {
  param([string]$Url)
  return Invoke-RestMethod -Uri $Url -Method Get
}

function Get-CudaPackageSpec {
  param(
    [object]$Manifest,
    [string]$Component
  )

  $node = $Manifest.$Component.'windows-x86_64'
  if (-not $node) {
    throw "CUDA redist manifest does not contain component: $Component"
  }

  return @{
    id = $Component
    name = $Component
    relative_path = [string]$node.relative_path
    size = [int64]$node.size
    url = "$cudaBaseUrl/$($node.relative_path)"
  }
}

function Get-CudnnPackageSpec {
  param([object]$Manifest)

  $node = $Manifest.cudnn.'windows-x86_64'.cuda12
  if (-not $node) {
    throw "cuDNN redist manifest does not contain windows-x86_64.cuda12 package."
  }

  return @{
    id = "cudnn"
    name = "cudnn"
    relative_path = [string]$node.relative_path
    size = [int64]$node.size
    url = "$cudnnBaseUrl/$($node.relative_path)"
  }
}

function Download-File {
  param(
    [string]$Url,
    [string]$TargetFile
  )

  Invoke-WebRequest -Uri $Url -OutFile $TargetFile
}

function Merge-PackageContents {
  param(
    [string]$ExtractRoot,
    [string]$TargetRoot
  )

  $binTarget = Join-Path $TargetRoot "bin"
  $libTarget = Join-Path $TargetRoot "lib"
  $includeTarget = Join-Path $TargetRoot "include"
  New-Item -ItemType Directory -Path $binTarget -Force | Out-Null
  New-Item -ItemType Directory -Path $libTarget -Force | Out-Null
  New-Item -ItemType Directory -Path $includeTarget -Force | Out-Null

  $sourceBins = Get-ChildItem -Path $ExtractRoot -Directory -Recurse -Filter "bin" -ErrorAction SilentlyContinue
  foreach ($dir in $sourceBins) {
    Copy-Item -Path (Join-Path $dir.FullName "*") -Destination $binTarget -Recurse -Force -ErrorAction SilentlyContinue
  }

  $sourceLibs = Get-ChildItem -Path $ExtractRoot -Directory -Recurse -Filter "lib" -ErrorAction SilentlyContinue
  foreach ($dir in $sourceLibs) {
    Copy-Item -Path (Join-Path $dir.FullName "*") -Destination $libTarget -Recurse -Force -ErrorAction SilentlyContinue
  }

  $sourceIncludes = Get-ChildItem -Path $ExtractRoot -Directory -Recurse -Filter "include" -ErrorAction SilentlyContinue
  foreach ($dir in $sourceIncludes) {
    Copy-Item -Path (Join-Path $dir.FullName "*") -Destination $includeTarget -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Add-PathEntry {
  param(
    [string]$CurrentValue,
    [string]$Entry
  )

  $parts = @()
  if ($CurrentValue) {
    $parts = $CurrentValue -split ";" | Where-Object { $_.Trim() }
  }
  $normalized = $parts | ForEach-Object { $_.Trim().ToLowerInvariant() }
  if ($normalized -notcontains $Entry.Trim().ToLowerInvariant()) {
    $parts = @($Entry) + $parts
  }
  return ($parts -join ";")
}

if ($env:OS -ne "Windows_NT") {
  throw "This installer currently supports Windows only."
}

$resolvedInstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$downloadRoot = Join-Path $resolvedInstallDir ".downloads"
$extractRoot = Join-Path $resolvedInstallDir ".extract"
$binDir = Join-Path $resolvedInstallDir "bin"

New-Item -ItemType Directory -Path $resolvedInstallDir -Force | Out-Null
New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

Write-Stage -Message "正在拉取 NVIDIA 官方运行库清单..." -TotalBytes 1 -Percent 1
$cudaManifest = Get-Json -Url $cudaManifestUrl
$cudnnManifest = Get-Json -Url $cudnnManifestUrl

$packages = @()
foreach ($component in $cudaComponents) {
  $packages += Get-CudaPackageSpec -Manifest $cudaManifest -Component $component
}
$packages += Get-CudnnPackageSpec -Manifest $cudnnManifest

[int64]$totalBytes = ($packages | Measure-Object -Property size -Sum).Sum
[int64]$completedBytes = 0

foreach ($package in $packages) {
  $archiveName = Split-Path -Path $package.relative_path -Leaf
  $archivePath = Join-Path $downloadRoot $archiveName
  $packageExtractRoot = Join-Path $extractRoot $package.id

  Write-Stage `
    -Message "正在下载 $($package.name) ..." `
    -CurrentPackage $package.name `
    -DownloadedBytes $completedBytes `
    -TotalBytes $totalBytes `
    -Percent (($completedBytes / [Math]::Max(1, $totalBytes)) * 100)

  Download-File -Url $package.url -TargetFile $archivePath

  if (Test-Path $packageExtractRoot) {
    Remove-Item -LiteralPath $packageExtractRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Path $packageExtractRoot -Force | Out-Null
  Expand-Archive -LiteralPath $archivePath -DestinationPath $packageExtractRoot -Force
  Merge-PackageContents -ExtractRoot $packageExtractRoot -TargetRoot $resolvedInstallDir

  $completedBytes += [int64]$package.size
  Write-Stage `
    -Message "$($package.name) 已安装。" `
    -CurrentPackage $package.name `
    -DownloadedBytes $completedBytes `
    -TotalBytes $totalBytes `
    -Percent (($completedBytes / [Math]::Max(1, $totalBytes)) * 100)
}

$manifest = @{
  type = "vidgnost-whisper-gpu-runtime"
  cuda_redist_version = $cudaRedistVersion
  cudnn_redist_version = $cudnnRedistVersion
  generated_at = [DateTime]::UtcNow.ToString("o")
  install_dir = $resolvedInstallDir
  packages = @($packages | ForEach-Object { $_.id })
}
$manifestPath = Join-Path $resolvedInstallDir ".vidgnost-whisper-gpu-runtime.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5), $utf8NoBom)

[Environment]::SetEnvironmentVariable("CUDA_PATH", $resolvedInstallDir, "Process")
[Environment]::SetEnvironmentVariable("VIDGNOST_WHISPER_GPU_RUNTIME_ROOT", $resolvedInstallDir, "Process")
$processPath = [Environment]::GetEnvironmentVariable("Path", "Process")
[Environment]::SetEnvironmentVariable("Path", (Add-PathEntry -CurrentValue $processPath -Entry $binDir), "Process")

if ($AutoConfigureEnv) {
  [Environment]::SetEnvironmentVariable("CUDA_PATH", $resolvedInstallDir, "User")
  [Environment]::SetEnvironmentVariable("VIDGNOST_WHISPER_GPU_RUNTIME_ROOT", $resolvedInstallDir, "User")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  [Environment]::SetEnvironmentVariable("Path", (Add-PathEntry -CurrentValue $userPath -Entry $binDir), "User")
}

Write-Stage -Message "Whisper GPU 运行库安装完成。" -DownloadedBytes $completedBytes -TotalBytes $totalBytes -Percent 100
