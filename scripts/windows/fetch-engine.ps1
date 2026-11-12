param(
  [Parameter(Mandatory = $true)][ValidateSet("x64", "arm64")][string]$Cpu,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Repository = "mantrakp04/ardia"
)

$ErrorActionPreference = "Stop"

$prebuilt = Get-Content -LiteralPath (Join-Path $PSScriptRoot "engine\prebuilt.json") -Raw | ConvertFrom-Json
$entry = $prebuilt.$Cpu
if (-not $entry -or -not $entry.asset -or -not $entry.sha256) { throw "scripts/windows/engine/prebuilt.json names no $Cpu engine" }
if (Test-Path -LiteralPath $Out) {
  if (Get-ChildItem -LiteralPath $Out -Force | Select-Object -First 1) { throw "'$Out' is not empty" }
} else {
  New-Item -ItemType Directory -Path $Out -Force | Out-Null
}

$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("ardia-engine-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
try {
  & gh release download $prebuilt.release --repo $Repository --pattern $entry.asset --dir $scratch
  if ($LASTEXITCODE -ne 0) { throw "gh could not download $($entry.asset) from the release $($prebuilt.release) of $Repository" }
  $archive = Join-Path $scratch $entry.asset
  $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $entry.sha256.ToLowerInvariant()) { throw "$($entry.asset) has SHA-256 $hash, not $($entry.sha256)" }
  $unpacked = Join-Path $scratch "unpacked"
  New-Item -ItemType Directory -Path $unpacked -Force | Out-Null
  & tar -xf $archive -C $unpacked
  if ($LASTEXITCODE -ne 0) { throw "$($entry.asset) did not unpack" }
  $launcher = Get-ChildItem -LiteralPath $unpacked -Recurse -Filter chrome.exe | Select-Object -First 1
  if (-not $launcher) { throw "$($entry.asset) holds no chrome.exe" }
  Get-ChildItem -LiteralPath $launcher.Directory.FullName -Force | Move-Item -Destination $Out
  Write-Host "fetch-engine: $($entry.asset) ($hash) is in $Out"
} finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
