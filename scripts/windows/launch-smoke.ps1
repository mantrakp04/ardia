param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Seconds = 25,
  [int]$SelfCheckSeconds = 120
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$log = Join-Path $Out "launch.log"
$checkLog = Join-Path $Out "self-check.log"
$shot = Join-Path $Out "window.png"
Remove-Item -Force -ErrorAction SilentlyContinue $log, $checkLog, $shot

$failures = @()

function Save-Screenshot([string]$Path) {
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
  } catch {
    Write-Host "::warning::no screenshot: $_"
  }
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ArdiaInput {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[ArdiaInput]::SetProcessDPIAware() | Out-Null

function Get-WindowRect([System.Diagnostics.Process]$Process) {
  $Process.Refresh()
  $rect = New-Object ArdiaInput+Rect
  if ($Process.MainWindowHandle -eq [IntPtr]::Zero) { return $null }
  if (-not [ArdiaInput]::GetWindowRect($Process.MainWindowHandle, [ref]$rect)) { return $null }
  return $rect
}

function Send-Click([int]$X, [int]$Y) {
  [ArdiaInput]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 80
  [ArdiaInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [ArdiaInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 250
}

function Send-Drag([int]$X, [int]$Y, [int]$ByX, [int]$ByY) {
  [ArdiaInput]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 120
  [ArdiaInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
  foreach ($step in 1..12) {
    [ArdiaInput]::SetCursorPos($X + [int]($ByX * $step / 12), $Y + [int]($ByY * $step / 12)) | Out-Null
    Start-Sleep -Milliseconds 40
  }
  Start-Sleep -Milliseconds 150
  [ArdiaInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 400
}

function Send-Chord([byte[]]$Modifiers, [byte]$Key) {
  foreach ($modifier in $Modifiers) { [ArdiaInput]::keybd_event($modifier, 0, 0, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 40
  [ArdiaInput]::keybd_event($Key, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [ArdiaInput]::keybd_event($Key, 0, 2, [UIntPtr]::Zero)
  foreach ($modifier in $Modifiers) { [ArdiaInput]::keybd_event($modifier, 0, 2, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 400
}

function Send-Text([string]$Text) {
  foreach ($character in $Text.ToUpperInvariant().ToCharArray()) {
    [ArdiaInput]::keybd_event([byte][char]$character, 0, 0, [UIntPtr]::Zero)
    [ArdiaInput]::keybd_event([byte][char]$character, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
  }
  Start-Sleep -Milliseconds 300
}

function Test-Input([System.Diagnostics.Process]$Process, [string]$Log) {
  $notes = @()
  $before = Get-WindowRect $Process
  if (-not $before) { return @("input: the app has no main window to drive") }
  [ArdiaInput]::SetForegroundWindow($Process.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 300
  $width = $before.Right - $before.Left
  $height = $before.Bottom - $before.Top

  Send-Click ($before.Left + [int]($width * 0.55)) ($before.Top + [int]($height * 0.42))
  Send-Text "ardia"
  Save-Screenshot (Join-Path $Out "browser-typed.png")

  Send-Chord @(0x11) 0x54
  $commanded = (Test-Path $Log) -and (Select-String -Path $Log -Pattern "^command \d+ newTab" -Quiet)
  if ($commanded) { Write-Host "Input: Ctrl+T reached the UI as newTab." } else { $notes += "input: Ctrl+T did not reach the UI as a command" }

  Send-Drag ($before.Left + [int]($width * 0.6)) ($before.Top + 24) 70 50
  $after = Get-WindowRect $Process
  if ($after) {
    $movedX = $after.Left - $before.Left
    $movedY = $after.Top - $before.Top
    if ([Math]::Abs($movedX - 70) -le 12 -and [Math]::Abs($movedY - 50) -le 12) { Write-Host "Input: dragging the toolbar moved the window by $movedX, $movedY." }
    else { $notes += "input: dragging the toolbar by 70, 50 moved the window by $movedX, $movedY" }
  } else { $notes += "input: the window was gone after the drag" }
  Save-Screenshot (Join-Path $Out "browser-after-input.png")
  return $notes
}

function New-DataDirectory([string]$Name) {
  $directory = Join-Path $Out $Name
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $directory
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  return $directory
}

$env:ARDIA_DATA_DIR = New-DataDirectory "launch-data"
$env:ARDIA_BACKGROUND = ""
$process = Start-Process -FilePath $App -ArgumentList "--log-file=`"$log`"" -PassThru
try {
  Start-Sleep -Seconds $Seconds
  Save-Screenshot $shot
  if ($process.HasExited) { $failures += "the app exited on its own within $Seconds s (exit code $($process.ExitCode))" }
} finally {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit(10000) | Out-Null
  }
}

if (Test-Path $log) { Get-Content $log } else { Write-Host "no launch log was written" }

if (-not (Test-Path $log)) { $failures += "the app wrote no launch log" }
elseif (Select-String -Path $log -Pattern "^(js-error|fatal|error) " -Quiet) { $failures += "the launch log has errors" }
elseif (-not (Select-String -Path $log -Pattern "\[ardia windows\] first window" -Quiet)) { $failures += "the first window never rendered" }
else {
  $first = (Select-String -Path $log -Pattern "^\w+ (\d+) .*\[ardia windows\] first window" | Select-Object -First 1)
  if ($first) { Write-Host "First window rendered $($first.Matches[0].Groups[1].Value) ms after the process started." }
}

$browserLog = Join-Path $Out "browser.log"
Remove-Item -Force -ErrorAction SilentlyContinue $browserLog
$env:ARDIA_DATA_DIR = New-DataDirectory "browser-data"
Set-Content -Path (Join-Path $env:ARDIA_DATA_DIR "onboarding.json") -Value '{"completedAt":1700000000000,"version":1}' -Encoding utf8NoBOM
$browser = Start-Process -FilePath $App -ArgumentList "--log-file=`"$browserLog`"" -PassThru
try {
  Start-Sleep -Seconds 12
  Save-Screenshot (Join-Path $Out "browser.png")
  if ($browser.HasExited) { $failures += "the app exited on its own with onboarding done (exit code $($browser.ExitCode))" }
  else {
    $working = [Math]::Round((Get-Process -Id $browser.Id).WorkingSet64 / 1MB)
    $private = [Math]::Round((Get-Process -Id $browser.Id).PrivateMemorySize64 / 1MB)
    Write-Host "Memory with the browser window open: $working MB working set, $private MB private."
    $inputNotes = Test-Input $browser $browserLog
    $inputNotes | ForEach-Object { Write-Host "::warning::$_" }
    if ($browser.HasExited) { $failures += "the app exited while being driven (exit code $($browser.ExitCode))" }
  }
} finally {
  if (-not $browser.HasExited) {
    Stop-Process -Id $browser.Id -Force
    $browser.WaitForExit(10000) | Out-Null
  }
}
if (-not (Test-Path $browserLog)) { $failures += "the launch with onboarding done wrote no log" }
elseif (Select-String -Path $browserLog -Pattern "^(js-error|fatal|error) " -Quiet) {
  Select-String -Path $browserLog -Pattern "^(js-error|fatal|error) " | ForEach-Object { Write-Host $_.Line }
  $failures += "the launch with onboarding done has errors"
}
elseif (-not (Select-String -Path $browserLog -Pattern "\[ardia windows\] first window" -Quiet)) { $failures += "the browser window never rendered with onboarding done" }

$env:ARDIA_DATA_DIR = New-DataDirectory "self-check-data"
$env:ARDIA_BACKGROUND = "1"
$check = Start-Process -FilePath $App -ArgumentList "--self-check", "--log-file=`"$checkLog`"" -PassThru
try {
  if (-not $check.WaitForExit($SelfCheckSeconds * 1000)) { $failures += "the self-check did not finish within $SelfCheckSeconds s" }
  elseif ($check.ExitCode -ne 0) { $failures += "the self-check launch exited with code $($check.ExitCode)" }
} finally {
  if (-not $check.HasExited) {
    Save-Screenshot (Join-Path $Out "self-check-stuck.png")
    Stop-Process -Id $check.Id -Force
    $check.WaitForExit(10000) | Out-Null
  }
}

if (Test-Path $checkLog) {
  Select-String -Path $checkLog -Pattern "self-check|^(js-error|fatal|error) " | ForEach-Object { Write-Host $_.Line }
  $done = Select-String -Path $checkLog -Pattern "self-check done: (\d+) passed, (\d+) failed" | Select-Object -First 1
  if (-not $done) { $failures += "the self-check never reported its result" }
  elseif ([int]$done.Matches[0].Groups[2].Value -gt 0) { $failures += "$($done.Matches[0].Groups[2].Value) self-checks failed" }
  elseif ([int]$done.Matches[0].Groups[1].Value -eq 0) { $failures += "the self-check ran no checks" }
  if (Select-String -Path $checkLog -Pattern "^(js-error|fatal|error) " -Quiet) { $failures += "the self-check log has errors" }
} else {
  $failures += "the self-check wrote no log"
}

if ($failures.Count) {
  $failures | ForEach-Object { Write-Host "::error::$_" }
  exit 1
}
Write-Host "The app launched, rendered its first window, stayed up for $Seconds s, and passed its self-check."
