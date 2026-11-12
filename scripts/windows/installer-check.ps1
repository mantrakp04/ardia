param(
  [Parameter(Mandatory = $true)][string]$Setup
)

$ErrorActionPreference = "Stop"

$entry = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{47A92F18-32B0-4548-A1EF-72C217FE1836}_is1"
$folder = Join-Path $env:LOCALAPPDATA "Programs\Ardia"
$shortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Ardia.lnk"
$shipped = @("Ardia.exe", "ArdiaApp.dll", "chrome.dll", "Ardia.ico", "Ardia.build.json", "unins000.exe")

function Invoke-Quietly([string]$program, [string]$what) {
  $run = Start-Process -FilePath $program -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait -PassThru
  if ($run.ExitCode -ne 0) { throw "$what exited with $($run.ExitCode)" }
}

if (-not (Test-Path -LiteralPath $Setup -PathType Leaf)) { throw "'$Setup' does not exist" }
if ((Test-Path -LiteralPath $entry) -or (Test-Path -LiteralPath $folder)) { throw "Ardia is already installed for this user: this check installs and removes it, so it only runs where it is not" }

Invoke-Quietly (Resolve-Path -LiteralPath $Setup).Path "the installer"
$missing = @($shipped | Where-Object { -not (Test-Path -LiteralPath (Join-Path $folder $_) -PathType Leaf) })
if ($missing.Count) { throw "the install in $folder lacks $($missing -join ', ')" }
if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) { throw "no Start Menu shortcut at $shortcut" }
$installed = Get-ItemProperty -LiteralPath $entry
if ($installed.DisplayName -ne "Ardia") { throw "the uninstall entry is named '$($installed.DisplayName)'" }
$count = @(Get-ChildItem -LiteralPath $folder -Recurse -File).Count
Write-Host "installer-check: installed Ardia $($installed.DisplayVersion), $count files in $folder"

Invoke-Quietly (Join-Path $folder "unins000.exe") "the uninstaller"
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline -and ((Test-Path -LiteralPath $folder) -or (Test-Path -LiteralPath $entry))) { Start-Sleep -Milliseconds 500 }
if (Test-Path -LiteralPath $folder) { throw "the uninstaller left $(@(Get-ChildItem -LiteralPath $folder -Recurse -File).Count) files in $folder" }
if (Test-Path -LiteralPath $entry) { throw "the uninstaller left its uninstall entry" }
if (Test-Path -LiteralPath $shortcut) { throw "the uninstaller left the Start Menu shortcut" }
Write-Host "installer-check: uninstalled, nothing left in $folder"
