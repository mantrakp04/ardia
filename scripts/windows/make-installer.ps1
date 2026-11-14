param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][ValidateSet("x64", "arm64")][string]$Cpu,
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$compiler = @{
  Version = "6.7.4"
  Url = "https://github.com/jrsoftware/issrc/releases/download/is-6_7_4/innosetup-6.7.4.exe"
  Sha256 = "a549929319f9120716677c685535ca4671e4b937b5fdc87e2585f32d8eb30e8c"
}
$allowed = @{ x64 = "x64compatible"; arm64 = "arm64" }
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Find-Compiler([string]$installed) {
  $onPath = Get-Command ISCC.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($onPath) { return $onPath.Source }
  $folders = @($installed)
  foreach ($programs in ${env:ProgramFiles(x86)}, $env:ProgramFiles) {
    if ($programs) { $folders += (Join-Path $programs "Inno Setup 6") }
  }
  if ($env:LOCALAPPDATA) { $folders += (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6") }
  foreach ($folder in $folders) {
    $candidate = Join-Path $folder "ISCC.exe"
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  return $null
}

function Install-Compiler([string]$installed, [string]$scratch) {
  $setup = Join-Path $scratch "innosetup.exe"
  Invoke-WebRequest -UseBasicParsing -Uri $compiler.Url -OutFile $setup
  $hash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $compiler.Sha256) { throw "Inno Setup $($compiler.Version) has SHA-256 $hash, not $($compiler.Sha256)" }
  $run = Start-Process -FilePath $setup -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER", "/NOICONS", "/PORTABLE=1", "/DIR=`"$installed`"" -Wait -PassThru
  if ($run.ExitCode -ne 0) { throw "Inno Setup's installer exited with $($run.ExitCode)" }
}

if (-not (Test-Path -LiteralPath (Join-Path $Source "Ardia.exe") -PathType Leaf)) { throw "'$Source' has no Ardia.exe" }
if (-not (Test-Path -LiteralPath (Join-Path $Source "chrome.dll") -PathType Leaf)) { throw "'$Source' has no chrome.dll: the installer ships the app assembled with the engine" }
$sourceRoot = (Resolve-Path -LiteralPath $Source).Path
if (Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Filter "Ardia.test-build" | Select-Object -First 1) { throw "'$Source' holds an Ardia.test-build marker: an installer never ships it, so a build people install ignores test keys" }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$outRoot = (Resolve-Path -LiteralPath $Out).Path
if (-not $Version) { $Version = & (Join-Path $PSScriptRoot "project-version.ps1") }
$icon = Join-Path $repository "apps\browser\windows\Ardia\Ardia.ico"
$script = Join-Path $PSScriptRoot "installer\Ardia.iss"

$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("ardia-installer-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
try {
  $installed = Join-Path $scratch "inno"
  $iscc = Find-Compiler $installed
  if (-not $iscc) {
    Install-Compiler $installed $scratch
    $iscc = Find-Compiler $installed
    if (-not $iscc) { throw "Inno Setup installed without an ISCC.exe" }
  }
  Write-Host "make-installer: using $iscc"
  & $iscc "/Q" "/DSource=$sourceRoot" "/DOut=$outRoot" "/DCpu=$Cpu" "/DAllowed=$($allowed[$Cpu])" "/DVersion=$Version" "/DIcon=$icon" $script
  if ($LASTEXITCODE -ne 0) { throw "ISCC exited with $LASTEXITCODE" }
  $setup = Join-Path $outRoot "Ardia-Setup-$Cpu.exe"
  if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) { throw "ISCC wrote no $setup" }
  $size = [Math]::Round((Get-Item -LiteralPath $setup).Length / 1MB)
  Write-Host "make-installer: Ardia $Version for $Cpu is $setup ($size MB)"
} finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
