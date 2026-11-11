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
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW")] public static extern bool GetSystemFlag(uint action, uint unused, ref int value, uint flags);
  [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW")] public static extern bool SetSystemFlag(uint action, uint value, IntPtr pointerValue, uint flags);
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

function Get-LastLogLine([string]$Log, [string]$Pattern) {
  if (-not (Test-Path $Log)) { return "" }
  $found = Select-String -Path $Log -Pattern $Pattern | Select-Object -Last 1
  if ($found) { return $found.Line } else { return "" }
}

function Get-MoveCounts([string]$Log) {
  return [pscustomobject]@{ System = Count-LogLines $Log "^window \d+ system move began on"; App = Count-LogLines $Log "^window \d+ drag began on" }
}

function Test-MovedBy([string]$Log, $Counts, [string]$What, [string]$Expected) {
  $now = Get-MoveCounts $Log
  $system = $now.System - $Counts.System
  $app = $now.App - $Counts.App
  if ($Expected -eq "system" -and $system -ge 1 -and $app -eq 0) { Write-Host "Input: $What was moved by Windows ($system system move, no app move)."; return @() }
  if ($Expected -eq "app" -and $app -ge 1 -and $system -eq 0) { Write-Host "Input: $What was moved by the app ($app app move, no system move)."; return @() }
  return @("input: $What should have been moved by $(if ($Expected -eq 'system') { 'Windows' } else { 'the app' }), but the log shows $system system moves and $app app moves")
}

function Get-GrabPoint($Client) {
  return [pscustomobject]@{ X = $Client.X + $Client.Width - [int](124 * $Client.Scale); Y = $Client.Y + [int](30 * $Client.Scale) }
}

function Get-WindowButton($Client, [int]$FromRight) {
  return [pscustomobject]@{ X = $Client.X + $Client.Width - [int]($FromRight * $Client.Scale); Y = $Client.Y + [int](30 * $Client.Scale) }
}

function Test-WindowButtons([System.Diagnostics.Process]$Process, [string]$Log) {
  $notes = @()
  $handle = $Process.MainWindowHandle
  $client = Get-ClientArea $Process
  if (-not $client) { return @("input: the window could not be measured before the window buttons") }
  $maximize = Get-WindowButton $client 60
  Send-Click $maximize.X $maximize.Y
  Start-Sleep -Milliseconds 900
  Save-Screenshot (Join-Path $Out "browser-maximize-button.png")
  if ([ArdiaInput]::IsZoomed($handle)) { Write-Host "Input: the app's maximize button maximized the window." }
  else { $notes += "input: a click on the app's maximize button, 60 points from the right edge, did not maximize the window" }

  $client = Get-ClientArea $Process
  if (-not $client) { return $notes + "input: the window was gone after the maximize button" }
  $restore = Get-WindowButton $client 60
  Send-Click $restore.X $restore.Y
  Start-Sleep -Milliseconds 900
  if (-not [ArdiaInput]::IsZoomed($handle)) { Write-Host "Input: the app's restore button put the window back." }
  else { $notes += "input: a click on the app's restore button did not restore the maximized window" }

  $client = Get-ClientArea $Process
  if (-not $client) { return $notes + "input: the window was gone after the restore button" }
  $minimize = Get-WindowButton $client 93
  Send-Click $minimize.X $minimize.Y
  Start-Sleep -Milliseconds 900
  if ([ArdiaInput]::IsIconic($handle)) { Write-Host "Input: the app's minimize button minimized the window." }
  else { $notes += "input: a click on the app's minimize button, 93 points from the right edge, did not minimize the window" }
  [ArdiaInput]::ShowWindow($handle, 9) | Out-Null
  Start-Sleep -Milliseconds 700
  [ArdiaInput]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 400
  if ([ArdiaInput]::IsIconic($handle)) { $notes += "input: the minimized window did not come back" }
  return $notes
}

function Test-Snap([System.Diagnostics.Process]$Process, [string]$Log) {
  $notes = @()
  $handle = $Process.MainWindowHandle
  $restored = Get-WindowRect $Process
  $client = Get-ClientArea $Process
  if (-not $restored -or -not $client) { return @("input: the window could not be measured before the snap") }
  $screen = [System.Windows.Forms.SystemInformation]::PrimaryMonitorSize

  $counts = Get-MoveCounts $Log
  $grab = Get-GrabPoint $client
  $fromX = $grab.X
  $fromY = $grab.Y
  Send-Drag $fromX $fromY ([int]($screen.Width * 0.15) - $fromX) (0 - $fromY) 600
  Start-Sleep -Milliseconds 700
  Save-Screenshot (Join-Path $Out "browser-maximized.png")
  if ([ArdiaInput]::IsZoomed($handle)) { Write-Host "Input: dragging the gap beside the window buttons to the top edge of the screen maximized the window." }
  else { $notes += "input: dragging the gap beside the window buttons to the top edge of the screen did not maximize the window" }
  $notes += @(Test-MovedBy $Log $counts "the drag to the top edge" "system")

  $client = Get-ClientArea $Process
  if (-not $client) { return $notes + "input: the window was gone after the snap" }
  $counts = Get-MoveCounts $Log
  $grab = Get-GrabPoint $client
  Send-Drag $grab.X $grab.Y -200 160 300
  Start-Sleep -Milliseconds 700
  $after = Get-WindowRect $Process
  if ([ArdiaInput]::IsZoomed($handle)) { $notes += "input: dragging the maximized window down by the gap beside its buttons did not restore it" }
  elseif ($after) {
    $width = $after.Right - $after.Left
    $height = $after.Bottom - $after.Top
    $wasWidth = $restored.Right - $restored.Left
    $wasHeight = $restored.Bottom - $restored.Top
    if ([Math]::Abs($width - $wasWidth) -le 24 -and [Math]::Abs($height - $wasHeight) -le 24) { Write-Host "Input: dragging the maximized window down restored it to $width by $height." }
    else { $notes += "input: dragging the maximized window down restored it to $width by $height, not $wasWidth by $wasHeight" }
  }
  $notes += @(Test-MovedBy $Log $counts "the drag off the maximized window" "system")
  return $notes
}

function Send-DoubleClick([int]$X, [int]$Y, [int]$Settle) {
  [ArdiaInput]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds $Settle
  Send-Press
  Start-Sleep -Milliseconds 90
  Send-Press
  Start-Sleep -Milliseconds 900
}

function Test-DoubleClick([System.Diagnostics.Process]$Process, [string]$Log) {
  $notes = @()
  $handle = $Process.MainWindowHandle
  $client = Get-ClientArea $Process
  if (-not $client) { return @("input: the window could not be measured before the double clicks") }
  $grab = Get-GrabPoint $client
  Send-DoubleClick $grab.X $grab.Y 5
  $path = Get-LastLogLine $Log "^window \d+ double click on"
  if ([ArdiaInput]::IsZoomed($handle)) { Write-Host "Input: a double click on the gap beside the window buttons right after moving there maximized the window ($path)." }
  else { $notes += "input: a double click on the gap beside the window buttons right after moving there did not maximize the window (last double click logged: '$path')" }

  $client = Get-ClientArea $Process
  if (-not $client) { return $notes + "input: the window was gone after the first double click" }
  $grab = Get-GrabPoint $client
  Send-DoubleClick $grab.X $grab.Y 300
  $path = Get-LastLogLine $Log "^window \d+ double click on"
  if (-not [ArdiaInput]::IsZoomed($handle)) { Write-Host "Input: a second double click on the gap beside the window buttons restored the window ($path)." }
  else { $notes += "input: a second double click on the gap beside the window buttons did not restore the maximized window (last double click logged: '$path')" }
  return $notes
}

function Test-AppDrag([System.Diagnostics.Process]$Process, [string]$Log) {
  $before = Get-WindowRect $Process
  $client = Get-ClientArea $Process
  if (-not $before -or -not $client) { return @("input: the window could not be measured before the toolbar drag") }
  $counts = Get-MoveCounts $Log
  Send-Drag ($client.X + [int]($client.Width * 0.6)) ($client.Y + [int](30 * $client.Scale)) 40 30
  $after = Get-WindowRect $Process
  if (-not $after) { return @("input: the window was gone after the toolbar drag") }
  $notes = @()
  $movedX = $after.Left - $before.Left
  $movedY = $after.Top - $before.Top
  if ([Math]::Abs($movedX - 40) -le 12 -and [Math]::Abs($movedY - 30) -le 12) { Write-Host "Input: dragging the toolbar's empty middle moved the window by $movedX, $movedY." }
  else { $notes += "input: dragging the toolbar's empty middle by 40, 30 moved the window by $movedX, $movedY" }
  $notes += @(Test-MovedBy $Log $counts "the toolbar drag" "app")
  return $notes
}

function Test-SidebarButton([System.Diagnostics.Process]$Process, [string]$Log) {
  $client = Get-ClientArea $Process
  if (-not $client) { return @("input: the window was gone before the sidebar button click") }
  $watches = Count-LogLines $Log "^window \d+ sidebar edge watch on"
  Send-Click ($client.X + [int](211 * $client.Scale)) ($client.Y + [int](30 * $client.Scale))
  Start-Sleep -Milliseconds 1500
  Save-Screenshot (Join-Path $Out "browser-sidebar-hidden.png")
  if ((Count-LogLines $Log "^window \d+ sidebar edge watch on") -gt $watches) { Write-Host "Input: the sidebar button took its click and hid the sidebar." }
  else { return @("input: clicking the sidebar button did not hide the sidebar") }
  return @()
}

function Test-SidebarEdge([System.Diagnostics.Process]$Process, [string]$Log) {
  $handle = $Process.MainWindowHandle
  [ArdiaInput]::SetWindowPos($handle, [IntPtr]::Zero, 160, 60, 0, 0, 0x0015) | Out-Null
  Start-Sleep -Milliseconds 400
  $client = Get-ClientArea $Process
  if (-not $client) { return @("input: the window was gone before the sidebar edge check") }
  $y = $client.Y + [int]([Math]::Min(200 * $client.Scale, $client.Height / 2))
  $notes = @()
  $overs = Count-LogLines $Log "^window \d+ sidebar edge over "
  [ArdiaInput]::SetCursorPos($client.X - [int](6 * $client.Scale), $y) | Out-Null
  Start-Sleep -Milliseconds 700
  Save-Screenshot (Join-Path $Out "browser-sidebar-peek.png")
  if ((Count-LogLines $Log "^window \d+ sidebar edge over ") -gt $overs) { Write-Host "Input: the pointer just outside the window's left edge counted as over the hidden sidebar's edge." }
  else { $notes += "input: the pointer 6 points outside the window's left edge, with the sidebar hidden, logged no 'sidebar edge over' line" }
  $aways = Count-LogLines $Log "^window \d+ sidebar edge away "
  [ArdiaInput]::SetCursorPos($client.X + [int]($client.Width * 0.7), $y) | Out-Null
  Start-Sleep -Milliseconds 700
  if ((Count-LogLines $Log "^window \d+ sidebar edge away ") -gt $aways) { Write-Host "Input: moving the pointer into the page counted as away from the sidebar's edge." }
  else { $notes += "input: moving the pointer from the window's edge into the page logged no 'sidebar edge away' line" }
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

  $band = Get-LastLogLine $Log "^window \d+ title band of \S+ is (caption|content)"
  if ($band -match " is caption$") { Write-Host "Input: the default layout marked caption regions for Windows ($band)." }
  else { $notes += "input: the default layout marked no caption region for Windows (last title band line: '$band')" }

  $client = Get-ClientArea $Process
  if (-not $client) { return @("input: the window could not be measured before the first drag") }
  $grab = Get-GrabPoint $client
  $counts = Get-MoveCounts $Log
  Send-Drag $grab.X $grab.Y -70 50
  $after = Get-WindowRect $Process
  if ($after) {
    $movedX = $after.Left - $before.Left
    $movedY = $after.Top - $before.Top
    if ([Math]::Abs($movedX + 70) -le 12 -and [Math]::Abs($movedY - 50) -le 12) { Write-Host "Input: dragging the gap beside the window buttons moved the window by $movedX, $movedY." }
    else { $notes += "input: dragging the gap beside the window buttons by -70, 50 moved the window by $movedX, $movedY" }
  } else {
    $notes += "input: the window was gone after the drag"
    return $notes
  }
  $notes += @(Test-MovedBy $Log $counts "the drag by the gap beside the window buttons" "system")

  Enable-WindowSnapping
  $notes += @(Test-Snap $Process $Log)
  $notes += @(Test-DoubleClick $Process $Log)
  $notes += @(Test-WindowButtons $Process $Log)
  $notes += @(Test-AppDrag $Process $Log)
  $after = Get-WindowRect $Process
  if (-not $after) { return $notes + "input: the window was gone after the drags" }
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

  $sidebarNotes = @(Test-SidebarButton $Process $Log)
  $notes += $sidebarNotes
  if (-not $sidebarNotes.Count) { $notes += @(Test-SidebarEdge $Process $Log) }
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
