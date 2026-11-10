param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Seconds = 25,
  [int]$SelfCheckSeconds = 120,
  [switch]$NoInput
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
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW")] public static extern bool GetSystemFlag(uint action, uint unused, ref int value, uint flags);
  [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW")] public static extern bool SetSystemFlag(uint action, uint value, IntPtr pointerValue, uint flags);
  [DllImport("user32.dll", EntryPoint = "SendMessageW")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
"@
[ArdiaInput]::SetProcessDPIAware() | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function Get-WindowRect([System.Diagnostics.Process]$Process) {
  $Process.Refresh()
  $rect = New-Object ArdiaInput+Rect
  if ($Process.MainWindowHandle -eq [IntPtr]::Zero) { return $null }
  if (-not [ArdiaInput]::GetWindowRect($Process.MainWindowHandle, [ref]$rect)) { return $null }
  return $rect
}

function Get-ClientArea([System.Diagnostics.Process]$Process) {
  $Process.Refresh()
  $handle = $Process.MainWindowHandle
  if ($handle -eq [IntPtr]::Zero) { return $null }
  $origin = New-Object ArdiaInput+Point
  $size = New-Object ArdiaInput+Rect
  if (-not [ArdiaInput]::ClientToScreen($handle, [ref]$origin)) { return $null }
  if (-not [ArdiaInput]::GetClientRect($handle, [ref]$size)) { return $null }
  $dpi = [ArdiaInput]::GetDpiForWindow($handle)
  return [pscustomobject]@{ X = $origin.X; Y = $origin.Y; Width = $size.Right; Height = $size.Bottom; Scale = $(if ($dpi) { $dpi / 96.0 } else { 1.0 }) }
}

function Enable-WindowSnapping {
  $flags = @(@{ Name = "window arranging"; Read = 0x0082; Write = 0x0083 }, @{ Name = "docking at screen edges"; Read = 0x0090; Write = 0x0091 }, @{ Name = "dragging off a maximized window"; Read = 0x008C; Write = 0x008D })
  foreach ($flag in $flags) {
    $value = 0
    if (-not [ArdiaInput]::GetSystemFlag($flag.Read, 0, [ref]$value, 0)) { Write-Host "Input: could not read whether $($flag.Name) is on."; continue }
    if ($value) { continue }
    $set = [ArdiaInput]::SetSystemFlag($flag.Write, 1, [IntPtr]1, 3)
    Write-Host "Input: $($flag.Name) was off on this runner; turned on: $set."
  }
}

function Count-LogLines([string]$Log, [string]$Pattern) {
  if (-not (Test-Path $Log)) { return 0 }
  return @(Select-String -Path $Log -Pattern $Pattern).Count
}

function Get-HitTest([IntPtr]$Handle, [int]$X, [int]$Y) {
  $point = [IntPtr](($Y -shl 16) -bor ($X -band 0xFFFF))
  return [ArdiaInput]::SendMessage($Handle, 0x0084, [IntPtr]::Zero, $point).ToInt64()
}

function Send-Press {
  [ArdiaInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 30
  [ArdiaInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
}

function Send-Click([int]$X, [int]$Y) {
  [ArdiaInput]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 80
  [ArdiaInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [ArdiaInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 250
}

function Send-Drag([int]$X, [int]$Y, [int]$ByX, [int]$ByY, [int]$Hold = 150) {
  [ArdiaInput]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 250
  [ArdiaInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
  $screen = [System.Windows.Forms.SystemInformation]::PrimaryMonitorSize
  foreach ($step in 1..12) {
    $toX = $X + [int]($ByX * $step / 12)
    $toY = $Y + [int]($ByY * $step / 12)
    [ArdiaInput]::mouse_event(0x8001, [uint32]($toX * 65535 / ($screen.Width - 1)), [uint32]($toY * 65535 / ($screen.Height - 1)), 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
  }
  Start-Sleep -Milliseconds $Hold
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

function Test-Snap([System.Diagnostics.Process]$Process, [string]$Log) {
  $notes = @()
  $handle = $Process.MainWindowHandle
  $restored = Get-WindowRect $Process
  $client = Get-ClientArea $Process
  if (-not $restored -or -not $client) { return @("input: the window could not be measured before the snap") }
  $screen = [System.Windows.Forms.SystemInformation]::PrimaryMonitorSize
  $systemMoves = Count-LogLines $Log "^window \d+ system move began"

  $fromX = $client.X + [int]($client.Width * 0.6)
  $fromY = $client.Y + [int](16 * $client.Scale)
  Send-Drag $fromX $fromY ([int]($screen.Width * 0.15) - $fromX) (0 - $fromY) 600
  Start-Sleep -Milliseconds 700
  Save-Screenshot (Join-Path $Out "browser-maximized.png")
  if ([ArdiaInput]::IsZoomed($handle)) { Write-Host "Input: dragging the title band to the top edge of the screen maximized the window." }
  else { $notes += "input: dragging the title band to the top edge of the screen did not maximize the window" }

  $client = Get-ClientArea $Process
  if (-not $client) { return $notes + "input: the window was gone after the snap" }
  Send-Drag ($client.X + [int]($client.Width * 0.6)) ($client.Y + [int](16 * $client.Scale)) 0 160 300
  Start-Sleep -Milliseconds 700
  $after = Get-WindowRect $Process
  if ([ArdiaInput]::IsZoomed($handle)) { $notes += "input: dragging the maximized window's title band down did not restore it" }
  elseif ($after) {
    $width = $after.Right - $after.Left
    $height = $after.Bottom - $after.Top
    $wasWidth = $restored.Right - $restored.Left
    $wasHeight = $restored.Bottom - $restored.Top
    if ([Math]::Abs($width - $wasWidth) -le 24 -and [Math]::Abs($height - $wasHeight) -le 24) { Write-Host "Input: dragging the maximized window down restored it to $width by $height." }
    else { $notes += "input: dragging the maximized window down restored it to $width by $height, not $wasWidth by $wasHeight" }
  }

  $systemMoved = (Count-LogLines $Log "^window \d+ system move began") - $systemMoves
  $appMoved = Count-LogLines $Log "^window \d+ drag began on"
  Write-Host "Input: Windows moved the window $systemMoved times; the app moved it itself $appMoved times in this launch."
  if ($systemMoved -lt 2) { $notes += "input: the snap drags were not system moves ($systemMoved of 2), so the title band was not a caption region under the pointer" }
  return $notes
}

function Get-LastLogLine([string]$Log, [string]$Pattern) {
  if (-not (Test-Path $Log)) { return "" }
  $found = Select-String -Path $Log -Pattern $Pattern | Select-Object -Last 1
  if ($found) { return $found.Line } else { return "" }
}

function Test-DoubleClick([System.Diagnostics.Process]$Process, [string]$Log) {
  $notes = @()
  $handle = $Process.MainWindowHandle
  $client = Get-ClientArea $Process
  if (-not $client) { return @("input: the window could not be measured before the double clicks") }
  [ArdiaInput]::SetCursorPos($client.X + [int]($client.Width * 0.6), $client.Y + [int](16 * $client.Scale)) | Out-Null
  Start-Sleep -Milliseconds 5
  Send-Press
  Start-Sleep -Milliseconds 90
  Send-Press
  Start-Sleep -Milliseconds 900
  $path = Get-LastLogLine $Log "^window \d+ double click on a drag area"
  if ([ArdiaInput]::IsZoomed($handle)) { Write-Host "Input: a quick double click on the title band right after moving there maximized the window ($path)." }
  else { $notes += "input: a quick double click on the title band right after moving there did not maximize the window (last double click logged: '$path')" }

  $client = Get-ClientArea $Process
  if (-not $client) { return $notes + "input: the window was gone after the first double click" }
  [ArdiaInput]::SetCursorPos($client.X + [int]($client.Width * 0.6), $client.Y + [int](16 * $client.Scale)) | Out-Null
  Start-Sleep -Milliseconds 300
  Send-Press
  Start-Sleep -Milliseconds 90
  Send-Press
  Start-Sleep -Milliseconds 900
  $path = Get-LastLogLine $Log "^window \d+ double click on a drag area"
  if (-not [ArdiaInput]::IsZoomed($handle)) { Write-Host "Input: a double click on the title band after hovering restored the window ($path)." }
  else { $notes += "input: a double click on the title band after hovering did not restore the maximized window (last double click logged: '$path')" }
  return $notes
}

function Test-CaptionEdge([System.Diagnostics.Process]$Process, [string]$Log) {
  $handle = $Process.MainWindowHandle
  $client = Get-ClientArea $Process
  if (-not $client) { return @("input: the window could not be measured before the sidebar button click") }
  $x = $client.X + [int](211 * $client.Scale)
  $seen = @{}
  $edge = $null
  $lastCaption = $null
  foreach ($row in [int](20 * $client.Scale)..[int](53 * $client.Scale)) {
    $y = $client.Y + $row
    [ArdiaInput]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 120
    $hit = Get-HitTest $handle $x $y
    if ($hit -ne 2) {
      Start-Sleep -Milliseconds 200
      $hit = Get-HitTest $handle $x $y
    }
    $seen["$hit"] = 1 + [int]$seen["$hit"]
    if ($hit -eq 2) { $lastCaption = $y; continue }
    if ($null -ne $lastCaption -and $lastCaption -eq $y - 1) { $edge = $y }
  }
  $hits = ($seen.GetEnumerator() | ForEach-Object { "$($_.Key) x$($_.Value)" }) -join ", "
  if ($null -eq $edge) { return @("input: hovering down the toolbar toward the sidebar button found no caption pixel next to it (hit tests: $hits)") }
  Write-Host "Input: the sidebar button's top edge is at client row $($edge - $client.Y); the pixel above it is a caption while hovered."

  $notes = @()
  [ArdiaInput]::SetCursorPos($x, $edge - 1) | Out-Null
  Start-Sleep -Milliseconds 250
  $armed = Get-HitTest $handle $x ($edge - 1)
  if ($armed -ne 2) { $notes += "input: the pixel above the sidebar button was not a caption after hovering it (hit test $armed)" }
  $watches = Count-LogLines $Log "^window \d+ sidebar edge watch on"
  [ArdiaInput]::SetCursorPos($x, $edge) | Out-Null
  $onEdge = Get-HitTest $handle $x $edge
  Send-Press
  if ($onEdge -eq 2) { $notes += "input: the caption armed above the sidebar button also covered the button's edge pixel" }
  Start-Sleep -Milliseconds 1500
  Save-Screenshot (Join-Path $Out "browser-sidebar-hidden.png")
  if ((Count-LogLines $Log "^window \d+ sidebar edge watch on") -gt $watches) { Write-Host "Input: a click on the sidebar button's edge pixel, coming from an armed caption, hid the sidebar." }
  else { $notes += "input: a click on the sidebar button's edge pixel, coming from an armed caption above it, did not reach the button" }
  return $notes
}

function Test-Input([System.Diagnostics.Process]$Process, [string]$Log) {
  $notes = @()
  $before = Get-WindowRect $Process
  if (-not $before) { return @("input: the app has no main window to drive") }
  [ArdiaInput]::SetForegroundWindow($Process.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 300
  $width = $before.Right - $before.Left
  $height = $before.Bottom - $before.Top

  Send-Drag ($before.Left + [int]($width * 0.6)) ($before.Top + 16) 70 50
  $after = Get-WindowRect $Process
  if ($after) {
    $movedX = $after.Left - $before.Left
    $movedY = $after.Top - $before.Top
    if ([Math]::Abs($movedX - 70) -le 12 -and [Math]::Abs($movedY - 50) -le 12) { Write-Host "Input: dragging the title band moved the window by $movedX, $movedY." }
    else { $notes += "input: dragging the title band by 70, 50 moved the window by $movedX, $movedY" }
  } else {
    $notes += "input: the window was gone after the drag"
    return $notes
  }

  Enable-WindowSnapping
  $snapNotes = @(Test-Snap $Process $Log)
  $notes += $snapNotes
  $doubleNotes = @(Test-DoubleClick $Process $Log)
  $notes += $doubleNotes
  $after = Get-WindowRect $Process
  if (-not $after) { return $notes + "input: the window was gone after the snap drags" }
  $width = $after.Right - $after.Left
  $height = $after.Bottom - $after.Top

  Send-Click ($after.Left + [int]($width * 0.55)) ($after.Top + [int]($height * 0.42))
  Start-Sleep -Milliseconds 900
  Send-Text "ardia"
  Save-Screenshot (Join-Path $Out "browser-typed.png")

  Send-Chord @(0x11) 0x54
  $commanded = (Test-Path $Log) -and (Select-String -Path $Log -Pattern "^command \d+ newTab" -Quiet)
  if ($commanded) { Write-Host "Input: Ctrl+T matched newTab and was sent to the UI." } else { $notes += "input: Ctrl+T matched no command" }
  Save-Screenshot (Join-Path $Out "browser-after-input.png")

  $edgeNotes = @(Test-CaptionEdge $Process $Log)
  $notes += $edgeNotes
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
    if (-not $NoInput) {
      $inputNotes = Test-Input $browser $browserLog
      $inputNotes | ForEach-Object { $failures += $_ }
    }
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
