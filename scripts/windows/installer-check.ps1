param(
  [Parameter(Mandatory = $true)][string]$Setup
)

$ErrorActionPreference = "Stop"

$entry = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{47A92F18-32B0-4548-A1EF-72C217FE1836}_is1"
$folder = Join-Path $env:LOCALAPPDATA "Programs\Ardia"
$shortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Ardia.lnk"
$appUserModelId = "Ardia.Browser"
$progId = "HKCU:\Software\Classes\ArdiaHTM"
$client = "HKCU:\Software\Clients\StartMenuInternet\Ardia"
$capabilities = "Software\Clients\StartMenuInternet\Ardia\Capabilities"
$registered = "HKCU:\Software\RegisteredApplications"
$fileTypes = @(".htm", ".html", ".shtml", ".svg", ".webp", ".xht", ".xhtml")
$shipped = @("Ardia.exe", "ArdiaApp.dll", "chrome.dll", "Ardia.ico", "Ardia.build.json", "unins000.exe")

function Default-Value([string]$key) {
  $item = Get-Item -LiteralPath $key -ErrorAction SilentlyContinue
  if ($item) { return $item.GetValue("") }
  return $null
}

function Browser-Leftovers {
  $left = @()
  if (Test-Path -LiteralPath $progId) { $left += "the ProgID ArdiaHTM" }
  if (Test-Path -LiteralPath $client) { $left += "StartMenuInternet\Ardia" }
  if ($null -ne (Get-ItemProperty -LiteralPath $registered -ErrorAction SilentlyContinue).Ardia) { $left += "RegisteredApplications\Ardia" }
  foreach ($type in $fileTypes) {
    $list = Get-Item -LiteralPath "HKCU:\Software\Classes\$type\OpenWithProgids" -ErrorAction SilentlyContinue
    if ($list -and ($list.GetValueNames() -contains "ArdiaHTM")) { $left += "$type OpenWithProgids ArdiaHTM" }
  }
  return ,$left
}

function Invoke-Quietly([string]$program, [string]$what) {
  $run = Start-Process -FilePath $program -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait -PassThru
  if ($run.ExitCode -ne 0) { throw "$what exited with $($run.ExitCode)" }
}

if (-not (Test-Path -LiteralPath $Setup -PathType Leaf)) { throw "'$Setup' does not exist" }
if ((Test-Path -LiteralPath $entry) -or (Test-Path -LiteralPath $folder)) { throw "Ardia is already installed for this user: this check installs and removes it, so it only runs where it is not" }
$before = Browser-Leftovers
if ($before.Count) { throw "Ardia's browser registration is already here before the install: $($before -join ', ')" }

Invoke-Quietly (Resolve-Path -LiteralPath $Setup).Path "the installer"
$missing = @($shipped | Where-Object { -not (Test-Path -LiteralPath (Join-Path $folder $_) -PathType Leaf) })
if ($missing.Count) { throw "the install in $folder lacks $($missing -join ', ')" }
if (Get-ChildItem -LiteralPath $folder -Recurse -File -Force -Filter "Ardia.test-build" | Select-Object -First 1) { throw "the install in $folder carries an Ardia.test-build marker: a build people install must ignore test keys" }
if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) { throw "no Start Menu shortcut at $shortcut" }
$installed = Get-ItemProperty -LiteralPath $entry
if ($installed.DisplayName -ne "Ardia") { throw "the uninstall entry is named '$($installed.DisplayName)'" }
$displayIcon = ($installed.DisplayIcon -split ",")[0].Trim('"')
if (-not $displayIcon -or -not (Test-Path -LiteralPath $displayIcon -PathType Leaf)) { throw "the uninstall entry's icon '$($installed.DisplayIcon)' is not a file" }
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
$linkIcon = ($link.IconLocation -split ",")[0]
if (-not $linkIcon -or -not (Test-Path -LiteralPath $linkIcon -PathType Leaf)) { throw "the Start Menu shortcut's icon '$($link.IconLocation)' is not a file" }
$linkId = (New-Object -ComObject Shell.Application).NameSpace((Split-Path -Parent $shortcut)).ParseName((Split-Path -Leaf $shortcut)).ExtendedProperty("System.AppUserModel.ID")
if ($linkId -ne $appUserModelId) { throw "the Start Menu shortcut's AppUserModelID is '$linkId', not ${appUserModelId}: the taskbar would not group the app's windows with it" }
& (Join-Path $PSScriptRoot "launcher-identity.ps1") -Icon $displayIcon -To (Join-Path $folder "Ardia.exe") -Check
if ($LASTEXITCODE -ne 0) { throw "the installed Ardia.exe does not carry Ardia's icon and name" }
Write-Host "installer-check: the shortcut has Ardia's icon and AppUserModelID $linkId, the uninstall entry's icon is $displayIcon"
$exe = Join-Path $folder "Ardia.exe"
$command = Default-Value "$progId\shell\open\command"
if ($command -ne "`"$exe`" --single-argument %1") { throw "the ProgID's open command is '$command', not the launcher with --single-argument %1" }
if ((Default-Value "$progId\DefaultIcon") -ne "$exe,0") { throw "the ProgID's icon is '$(Default-Value "$progId\DefaultIcon")'" }
if ((Get-ItemProperty -LiteralPath "$progId\Application").ApplicationName -ne "Ardia") { throw "the ProgID's application name is not Ardia" }
if ((Get-ItemProperty -LiteralPath $registered).Ardia -ne $capabilities) { throw "RegisteredApplications\Ardia is '$((Get-ItemProperty -LiteralPath $registered).Ardia)', not $capabilities" }
$caps = Get-ItemProperty -LiteralPath "HKCU:\$capabilities"
if ($caps.ApplicationName -ne "Ardia" -or $caps.ApplicationIcon -ne "$exe,0") { throw "the Capabilities name or icon is wrong: '$($caps.ApplicationName)', '$($caps.ApplicationIcon)'" }
foreach ($scheme in "http", "https") {
  $handler = (Get-ItemProperty -LiteralPath "HKCU:\$capabilities\URLAssociations").$scheme
  if ($handler -ne "ArdiaHTM") { throw "URLAssociations\$scheme is '$handler', not ArdiaHTM" }
}
foreach ($type in $fileTypes) {
  $handler = (Get-ItemProperty -LiteralPath "HKCU:\$capabilities\FileAssociations").$type
  if ($handler -ne "ArdiaHTM") { throw "FileAssociations\$type is '$handler', not ArdiaHTM" }
  if (-not ((Get-Item -LiteralPath "HKCU:\Software\Classes\$type\OpenWithProgids").GetValueNames() -contains "ArdiaHTM")) { throw "$type does not offer ArdiaHTM in Open with" }
}
if ((Get-ItemProperty -LiteralPath "HKCU:\$capabilities\StartMenu").StartMenuInternet -ne "Ardia") { throw "Capabilities\StartMenu does not name StartMenuInternet\Ardia" }
if ((Default-Value "$client\shell\open\command") -ne "`"$exe`"") { throw "StartMenuInternet\Ardia's open command is '$(Default-Value "$client\shell\open\command")'" }
Write-Host "installer-check: Ardia is registered as a browser: ArdiaHTM opens $command, for http, https and $($fileTypes -join ' ')"
$count = @(Get-ChildItem -LiteralPath $folder -Recurse -File).Count
Write-Host "installer-check: installed Ardia $($installed.DisplayVersion), $count files in $folder"

Invoke-Quietly (Join-Path $folder "unins000.exe") "the uninstaller"
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline -and ((Test-Path -LiteralPath $folder) -or (Test-Path -LiteralPath $entry))) { Start-Sleep -Milliseconds 500 }
if (Test-Path -LiteralPath $folder) { throw "the uninstaller left $(@(Get-ChildItem -LiteralPath $folder -Recurse -File).Count) files in $folder" }
if (Test-Path -LiteralPath $entry) { throw "the uninstaller left its uninstall entry" }
if (Test-Path -LiteralPath $shortcut) { throw "the uninstaller left the Start Menu shortcut" }
$after = Browser-Leftovers
if ($after.Count) { throw "the uninstaller left Ardia's browser registration: $($after -join ', ')" }
Write-Host "installer-check: uninstalled, nothing left in $folder"
