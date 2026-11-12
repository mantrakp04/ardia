param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$Hermes
)

$ErrorActionPreference = "Stop"

$library = "ArdiaApp.dll"
$bundleName = "index.windows.bundle"
$hermesMagic = [byte[]](0xC6, 0x1F, 0xBC, 0x03, 0xC1, 0x03, 0x19, 0x1F)
$browser = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "apps\browser"

if (-not (Test-Path -LiteralPath (Join-Path $App $library) -PathType Leaf)) { throw "the built app '$App' has no $library" }
if (-not (Test-Path -LiteralPath $Hermes -PathType Leaf)) { throw "no Hermes compiler at '$Hermes'" }
$appRoot = (Resolve-Path -LiteralPath $App).Path
$compiler = (Resolve-Path -LiteralPath $Hermes).Path
$shipped = Join-Path $appRoot "Bundle"

function Test-HermesBytecode([string]$path) {
  $stream = [System.IO.File]::OpenRead($path)
  try {
    $head = New-Object byte[] $hermesMagic.Length
    if ($stream.Read($head, 0, $head.Length) -ne $head.Length) { return $false }
    return -not (Compare-Object $head $hermesMagic -SyncWindow 0)
  } finally {
    $stream.Dispose()
  }
}

$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("ardia-rebundle-" + [guid]::NewGuid().ToString("N"))
$fresh = Join-Path $scratch "Bundle"
New-Item -ItemType Directory -Path $fresh -Force | Out-Null
try {
  $javascript = Join-Path $fresh $bundleName
  $bytecode = "$javascript.hbc"
  Push-Location $browser
  try {
    & npx @react-native-community/cli bundle --platform windows --entry-file index.js --bundle-output $javascript --assets-dest $fresh --dev false --reset-cache --minify false
    if ($LASTEXITCODE -ne 0) { throw "Metro did not bundle the app for Windows" }
    & $compiler -emit-binary -out $bytecode $javascript -O
    if ($LASTEXITCODE -ne 0) { throw "Hermes did not compile $bundleName" }
  } finally {
    Pop-Location
  }
  if (-not (Test-HermesBytecode $bytecode)) { throw "$bytecode is not Hermes bytecode" }
  Move-Item -LiteralPath $bytecode -Destination $javascript -Force
  if (Test-Path -LiteralPath $shipped) { Remove-Item -LiteralPath $shipped -Recurse -Force }
  Move-Item -LiteralPath $fresh -Destination $shipped
  $files = @(Get-ChildItem -LiteralPath $shipped -Recurse -File)
  $megabytes = [math]::Round((Get-Item -LiteralPath (Join-Path $shipped $bundleName)).Length / 1MB, 1)
  Write-Host "rebundle: $bundleName ($megabytes MB of Hermes bytecode) and $($files.Count - 1) assets are in $shipped"
} finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
