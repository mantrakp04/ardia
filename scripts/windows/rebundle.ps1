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
$shippedMaps = Join-Path $appRoot "sourcemaps\react"

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

$scratch = Join-Path (Split-Path -Parent $appRoot) ("rebundle-" + [guid]::NewGuid().ToString("N"))
$fresh = Join-Path $scratch "Bundle"
$freshMaps = Join-Path $scratch "maps"
New-Item -ItemType Directory -Path $fresh, $freshMaps -Force | Out-Null
try {
  $javascript = Join-Path $fresh $bundleName
  $bytecode = "$javascript.hbc"
  $packagerMap = Join-Path $freshMaps "$bundleName.packager.map"
  $compilerMap = Join-Path $freshMaps "$bundleName.compiler.map"
  $composedMap = Join-Path $freshMaps "$bundleName.map"
  Push-Location $browser
  try {
    & npx @react-native-community/cli bundle --platform windows --entry-file index.js --bundle-output $javascript --assets-dest $fresh --dev false --reset-cache --sourcemap-output $packagerMap --minify false
    if ($LASTEXITCODE -ne 0) { throw "Metro did not bundle the app for Windows" }
    & $compiler -emit-binary -out $bytecode $javascript -O -output-source-map
    if ($LASTEXITCODE -ne 0) { throw "Hermes did not compile $bundleName" }
    $composer = & node -p "require('node:path').join(require('node:path').dirname(require.resolve('react-native/package.json', { paths: [require.resolve('react-native-windows/package.json')] })), 'scripts', 'compose-source-maps.js')"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $composer -PathType Leaf)) { throw "no compose-source-maps.js beside react-native-windows' react-native" }
    Move-Item -LiteralPath "$bytecode.map" -Destination $compilerMap
    & node $composer $packagerMap $compilerMap -o $composedMap
    if ($LASTEXITCODE -ne 0) { throw "the source maps of $bundleName did not compose" }
  } finally {
    Pop-Location
  }
  if (-not (Test-HermesBytecode $bytecode)) { throw "$bytecode is not Hermes bytecode" }
  Move-Item -LiteralPath $bytecode -Destination $javascript -Force
  foreach ($stale in @($shipped, $shippedMaps)) {
    if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Recurse -Force }
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $shippedMaps) -Force | Out-Null
  Move-Item -LiteralPath $fresh -Destination $shipped
  Move-Item -LiteralPath $freshMaps -Destination $shippedMaps
  $files = @(Get-ChildItem -LiteralPath $shipped -Recurse -File)
  $megabytes = [math]::Round((Get-Item -LiteralPath (Join-Path $shipped $bundleName)).Length / 1MB, 1)
  $digest = (Get-FileHash -LiteralPath (Join-Path $shipped $bundleName) -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "rebundle: $bundleName ($megabytes MB of Hermes bytecode, SHA-256 $digest) and $($files.Count - 1) assets are in $shipped"
} finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
