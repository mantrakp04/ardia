param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$LaunchSeconds = 60,
  [string[]]$Only = @()
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path -LiteralPath $Out).Path
$tourFile = Join-Path $Out "tour.md"

$script:Lines = [System.Collections.Generic.List[string]]::new()
$script:Sessions = [System.Collections.Generic.List[object]]::new()
$script:StopNumber = 0
$script:PreviousSignature = $null
$script:UiaReady = $null
$script:LightBrightness = $null
$script:Started = Get-Date

if (-not ([System.Management.Automation.PSTypeName]"ArdiaTour").Type) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ArdiaTour {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }

  public class TopWindow {
    public IntPtr Handle;
    public string Title;
    public string ClassName;
    public int Left, Top, Width, Height;
  }

  private delegate bool EnumWindowsCallback(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(IntPtr window, StringBuilder text, int max);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);

  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint MapVirtualKeyW(uint code, uint mapType);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

  public static string TitleOf(IntPtr window) {
    StringBuilder text = new StringBuilder(512);
    GetWindowTextW(window, text, text.Capacity);
    return text.ToString();
  }

  public static string ClassOf(IntPtr window) {
    StringBuilder text = new StringBuilder(256);
    GetClassNameW(window, text, text.Capacity);
    return text.ToString();
  }

  public static bool IsCloaked(IntPtr window) {
    int value;
    return DwmGetWindowAttribute(window, 14, out value, 4) == 0 && value != 0;
  }

  public static int DarkModeOf(IntPtr window) {
    int value;
    return DwmGetWindowAttribute(window, 20, out value, 4) == 0 ? value : -1;
  }

  public static uint ProcessOf(IntPtr window) {
    uint processId;
    GetWindowThreadProcessId(window, out processId);
    return processId;
  }

  public static TopWindow[] VisibleWindowsOf(uint processId) {
    List<TopWindow> found = new List<TopWindow>();
    EnumWindowsCallback callback = delegate (IntPtr window, IntPtr data) {
      if (ProcessOf(window) != processId) return true;
      if (!IsWindowVisible(window) || IsCloaked(window)) return true;
      Rect rect;
      if (!GetWindowRect(window, out rect)) return true;
      if (rect.Right - rect.Left <= 0 || rect.Bottom - rect.Top <= 0) return true;
      TopWindow entry = new TopWindow();
      entry.Handle = window;
      entry.Title = TitleOf(window);
      entry.ClassName = ClassOf(window);
      entry.Left = rect.Left;
      entry.Top = rect.Top;
      entry.Width = rect.Right - rect.Left;
      entry.Height = rect.Bottom - rect.Top;
      found.Add(entry);
      return true;
    };
    EnumWindows(callback, IntPtr.Zero);
    GC.KeepAlive(callback);
    return found.ToArray();
  }
}
"@
}

[ArdiaTour]::SetProcessDPIAware() | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function Write-Tour {
  $header = @(
    "# Ardia on Windows: screenshot tour",
    "",
    "Every line is one stop: what the tour did, what it expected, and whether a fact the script can check says it happened (yes, no, or unverified when there is nothing to check). A screen that looks wrong is reported here and never fails the job; only a crash or an exit does.",
    "",
    "Screen: $([System.Windows.Forms.SystemInformation]::PrimaryMonitorSize.Width) by $([System.Windows.Forms.SystemInformation]::PrimaryMonitorSize.Height), work area $([System.Windows.Forms.SystemInformation]::WorkingArea.Width) by $([System.Windows.Forms.SystemInformation]::WorkingArea.Height). Started $($script:Started.ToString('u')).",
    ""
  )
  $footer = [System.Collections.Generic.List[string]]::new()
  foreach ($session in $script:Sessions) {
    $footer.Add("")
    $footer.Add("## Launch: $($session.Name)")
    $footer.Add("")
    $footer.Add("Log: [$($session.Name).log]($($session.Name).log). $($session.Summary)")
    if ($session.Fatal.Count) {
      $footer.Add("")
      $footer.Add("Crash lines from the launch log:")
      $footer.Add("")
      $footer.Add('```')
      foreach ($line in $session.Fatal) { $footer.Add($line) }
      $footer.Add('```')
    }
    if ($session.Errors.Count) {
      $footer.Add("")
      $footer.Add("Error lines from the launch log:")
      $footer.Add("")
      $footer.Add('```')
      foreach ($line in ($session.Errors | Select-Object -First 40)) { $footer.Add($line) }
      $footer.Add('```')
    }
  }
  $missing = @($script:Sessions | ForEach-Object { $_.Missing } | Sort-Object -Unique)
  if ($missing.Count) {
    $footer.Add("")
    $footer.Add("## Reached with no Windows version yet")
    $footer.Add("")
    foreach ($name in $missing) { $footer.Add("- $name") }
  }
  try {
    Set-Content -LiteralPath $tourFile -Value (@($header) + @($script:Lines) + @($footer)) -Encoding utf8NoBOM
  } catch {
    Write-Host "[tour] could not write tour.md: $($_.Exception.Message)"
  }
}

function Read-LogLines([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return @() }
  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
    try {
      $reader = [System.IO.StreamReader]::new($stream)
      $text = $reader.ReadToEnd()
    } finally {
      $stream.Dispose()
    }
    return @($text -split "`r?`n" | Where-Object { $_ -ne "" })
  } catch {
    return @()
  }
}

function Get-LinesSince($Session, [int]$Mark, [string]$Pattern) {
  return @(Read-LogLines $Session.Log | Select-Object -Skip $Mark | Where-Object { $_ -match $Pattern })
}

function Get-LogCount($Session) {
  return @(Read-LogLines $Session.Log).Count
}

function Test-Running($Session) {
  if ($Session.Process.HasExited) { throw "the app is no longer running (exit code $($Session.Process.ExitCode))" }
}

function Wait-Until($Session, [scriptblock]$Test, [int]$Milliseconds) {
  $deadline = (Get-Date).AddMilliseconds($Milliseconds)
  while ($true) {
    if (& $Test) { return $true }
    Test-Running $Session
    if ((Get-Date) -ge $deadline) { return $false }
    Start-Sleep -Milliseconds 150
  }
}

function Get-TopWindows($Session) {
  try { return @([ArdiaTour]::VisibleWindowsOf([uint32]$Session.Process.Id)) } catch { return @() }
}

function Get-BigWindows($Session) {
  return @(Get-TopWindows $Session | Where-Object { $_.ClassName -ne "#32768" -and $_.Width -ge 300 -and $_.Height -ge 200 })
}

function Get-MenuWindows($Session) {
  return @(Get-TopWindows $Session | Where-Object { $_.ClassName -eq "#32768" })
}

function Get-NewWindows($Session, $Before) {
  $known = @($Before | ForEach-Object { $_.Handle.ToInt64() })
  return @(Get-TopWindows $Session | Where-Object { $known -notcontains $_.Handle.ToInt64() })
}

function Format-Windows($Windows) {
  $list = @($Windows)
  if (-not $list.Count) { return "none" }
  return ($list | ForEach-Object { "'$($_.Title)' ($($_.ClassName), $($_.Width) by $($_.Height) at $($_.Left), $($_.Top))" }) -join "; "
}

function Get-Client([IntPtr]$Window) {
  if ($Window -eq [IntPtr]::Zero -or -not [ArdiaTour]::IsWindow($Window)) { return $null }
  $origin = New-Object ArdiaTour+Point
  $size = New-Object ArdiaTour+Rect
  if (-not [ArdiaTour]::ClientToScreen($Window, [ref]$origin)) { return $null }
  if (-not [ArdiaTour]::GetClientRect($Window, [ref]$size)) { return $null }
  $dpi = [ArdiaTour]::GetDpiForWindow($Window)
  $scale = 1.0
  if ($dpi) { $scale = $dpi / 96.0 }
  return [pscustomobject]@{ X = $origin.X; Y = $origin.Y; Width = $size.Right; Height = $size.Bottom; Scale = $scale }
}

function Get-Frame([IntPtr]$Window) {
  $rect = New-Object ArdiaTour+Rect
  if (-not [ArdiaTour]::GetWindowRect($Window, [ref]$rect)) { return $null }
  return [pscustomobject]@{ Left = $rect.Left; Top = $rect.Top; Width = $rect.Right - $rect.Left; Height = $rect.Bottom - $rect.Top }
}

function Test-ForegroundIsOurs($Session) {
  $foreground = [ArdiaTour]::GetForegroundWindow()
  if ($foreground -eq [IntPtr]::Zero) { return $false }
  return [ArdiaTour]::ProcessOf($foreground) -eq [uint32]$Session.Process.Id
}

function Describe-Foreground {
  $foreground = [ArdiaTour]::GetForegroundWindow()
  if ($foreground -eq [IntPtr]::Zero) { return "no window" }
  $owner = [ArdiaTour]::ProcessOf($foreground)
  $name = "process $owner"
  try { $name = (Get-Process -Id $owner -ErrorAction Stop).ProcessName } catch { }
  return "'$([ArdiaTour]::TitleOf($foreground))' ($([ArdiaTour]::ClassOf($foreground)), $name)"
}

function Send-Click([int]$X, [int]$Y, [switch]$Right) {
  $down = 2
  $up = 4
  if ($Right) {
    $down = 8
    $up = 16
  }
  [ArdiaTour]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 120
  [ArdiaTour]::mouse_event([uint32]$down, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [ArdiaTour]::mouse_event([uint32]$up, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 300
}

function Send-Key([byte]$Key, [uint32]$Flags) {
  $scan = [byte]([ArdiaTour]::MapVirtualKeyW([uint32]$Key, 0) -band 0xFF)
  [ArdiaTour]::keybd_event($Key, $scan, $Flags, [UIntPtr]::Zero)
}

function Send-Chord([byte[]]$Modifiers, [byte]$Key) {
  foreach ($modifier in $Modifiers) { Send-Key $modifier 0 }
  Start-Sleep -Milliseconds 50
  Send-Key $Key 0
  Start-Sleep -Milliseconds 50
  Send-Key $Key 2
  foreach ($modifier in $Modifiers) { Send-Key $modifier 2 }
  Start-Sleep -Milliseconds 450
}

function Send-Escape {
  Send-Chord @() 0x1B
}

function Send-Text([string]$Text) {
  foreach ($character in $Text.ToUpperInvariant().ToCharArray()) {
    $key = [byte][char]$character
    if ($character -eq '.') { $key = 0xBE }
    Send-Key $key 0
    Send-Key $key 2
    Start-Sleep -Milliseconds 60
  }
  Start-Sleep -Milliseconds 300
}

function Focus-Window($Session, [IntPtr]$Window, $Stop, [switch]$ClickBand) {
  if (-not [ArdiaTour]::IsWindow($Window)) { throw "the window to focus is gone" }
  if ([ArdiaTour]::IsIconic($Window)) { [ArdiaTour]::ShowWindow($Window, 9) | Out-Null }
  if ([ArdiaTour]::GetForegroundWindow() -eq $Window) { return $true }
  if (-not (Test-ForegroundIsOurs $Session)) {
    Send-Key 0x12 0
    Send-Key 0x12 2
  }
  [ArdiaTour]::SetForegroundWindow($Window) | Out-Null
  [ArdiaTour]::BringWindowToTop($Window) | Out-Null
  Start-Sleep -Milliseconds 300
  if ([ArdiaTour]::GetForegroundWindow() -eq $Window) { return $true }
  if ($ClickBand) {
    $client = Get-Client $Window
    if ($client) {
      Send-Click ($client.X + [int]($client.Width * 0.6)) ($client.Y + [int](16 * $client.Scale))
      Start-Sleep -Milliseconds 300
      if ([ArdiaTour]::GetForegroundWindow() -eq $Window) { return $true }
    }
  }
  if ($Stop) { $Stop.Facts.Add("could not bring the window forward; the foreground is $(Describe-Foreground)") }
  return $false
}

function Close-Dialogs($Session, $Stop) {
  foreach ($dialog in @(Get-TopWindows $Session | Where-Object { $_.ClassName -eq "#32770" })) {
    $Stop.Facts.Add("closed a dialog left open from before: '$($dialog.Title)'")
    [ArdiaTour]::PostMessageW($dialog.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    Start-Sleep -Milliseconds 400
  }
}

function Close-Menus($Session) {
  for ($i = 0; $i -lt 3; $i++) {
    if (-not @(Get-MenuWindows $Session).Count) { return }
    Send-Escape
    Start-Sleep -Milliseconds 200
  }
}

function Get-Signature([System.Drawing.Bitmap]$Bitmap, [System.Drawing.Rectangle]$Screen, $Frame) {
  $columns = 48
  $rows = 32
  $left = [Math]::Max(0, $Frame.Left - $Screen.X)
  $top = [Math]::Max(0, $Frame.Top - $Screen.Y)
  $right = [Math]::Min($Bitmap.Width, $Frame.Left - $Screen.X + $Frame.Width)
  $bottom = [Math]::Min($Bitmap.Height, $Frame.Top - $Screen.Y + $Frame.Height)
  if ($right - $left -lt $columns -or $bottom - $top -lt $rows) { return $null }
  $values = [int[]]::new($columns * $rows)
  $brightness = 0.0
  for ($row = 0; $row -lt $rows; $row++) {
    $y = [int]($top + ($row + 0.5) * ($bottom - $top) / $rows)
    for ($column = 0; $column -lt $columns; $column++) {
      $x = [int]($left + ($column + 0.5) * ($right - $left) / $columns)
      $pixel = $Bitmap.GetPixel($x, $y)
      $values[$row * $columns + $column] = ([int]$pixel.R -shl 16) -bor ([int]$pixel.G -shl 8) -bor [int]$pixel.B
      $brightness += 0.299 * $pixel.R + 0.587 * $pixel.G + 0.114 * $pixel.B
    }
  }
  return [pscustomobject]@{ Values = $values; Brightness = [Math]::Round($brightness / ($columns * $rows)); Key = "$($Frame.Left),$($Frame.Top),$($Frame.Width),$($Frame.Height)" }
}

function Compare-Signatures($Before, $After) {
  if (-not $Before -or -not $After -or $Before.Key -ne $After.Key) { return $null }
  $changed = 0
  for ($i = 0; $i -lt $After.Values.Length; $i++) {
    $a = $Before.Values[$i]
    $b = $After.Values[$i]
    if ($a -eq $b) { continue }
    $red = [Math]::Abs((($a -shr 16) -band 0xFF) - (($b -shr 16) -band 0xFF))
    $green = [Math]::Abs((($a -shr 8) -band 0xFF) - (($b -shr 8) -band 0xFF))
    $blue = [Math]::Abs(($a -band 0xFF) - ($b -band 0xFF))
    if ([Math]::Max($red, [Math]::Max($green, $blue)) -gt 24) { $changed++ }
  }
  return [Math]::Round(100.0 * $changed / $After.Values.Length, 1)
}

function Measure-Screen([string]$Path, [IntPtr]$Window) {
  $result = [pscustomobject]@{ Saved = $false; Brightness = $null; Changed = $null; Problem = $null }
  try {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
      if ($Path) {
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
        $result.Saved = $true
      }
      if ($Window -ne [IntPtr]::Zero -and [ArdiaTour]::IsWindow($Window)) {
        $frame = Get-Frame $Window
        if ($frame) {
          $signature = Get-Signature $bitmap $bounds $frame
          if ($signature) {
            $result.Brightness = $signature.Brightness
            $result.Changed = Compare-Signatures $script:PreviousSignature $signature
            $script:PreviousSignature = $signature
          }
        }
      }
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  } catch {
    $result.Problem = $_.Exception.Message
  }
  return $result
}

function Save-Shot($Stop, [IntPtr]$Window) {
  $result = Measure-Screen $Stop.Shot $Window
  if ($result.Saved) { $Stop.ShotSaved = $true }
  if ($result.Problem) { $Stop.Facts.Add("no screenshot: $($result.Problem)") }
  if ($null -ne $result.Brightness) {
    $note = "window brightness $($result.Brightness) of 255"
    if ($null -ne $result.Changed) { $note += ", $($result.Changed)% of the window changed since the previous shot" }
    $Stop.Facts.Add($note)
  }
  return $result
}

function Initialize-Uia {
  if ($null -ne $script:UiaReady) { return $script:UiaReady }
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $script:UiaReady = $true
  } catch {
    $script:UiaReady = $false
    Write-Host "[tour] UI Automation is not available: $($_.Exception.Message)"
  }
  return $script:UiaReady
}

function Find-Named([IntPtr]$Window, [string]$Name) {
  if (-not (Initialize-Uia)) { return @() }
  $found = @()
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($Window)
    $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    foreach ($element in $elements) {
      try {
        $box = $element.Current.BoundingRectangle
        if ($box.IsEmpty -or $box.Width -le 0 -or $box.Height -le 0 -or $element.Current.IsOffscreen) { continue }
        $found += [pscustomobject]@{ X = [int]($box.X + $box.Width / 2); Y = [int]($box.Y + $box.Height / 2); Left = [int]$box.X; Top = [int]$box.Y; Width = [int]$box.Width; Height = [int]$box.Height }
      } catch { }
    }
  } catch {
    Write-Host "[tour] UI Automation search for '$Name' failed: $($_.Exception.Message)"
  }
  return @($found)
}

function New-Stop([string]$Slug) {
  $script:StopNumber++
  $number = "{0:D2}" -f $script:StopNumber
  return [pscustomobject]@{
    Number = $number
    Slug = $Slug
    Shot = Join-Path $Out "$number-$Slug.png"
    ShotSaved = $false
    Did = ""
    Expected = ""
    Seen = "unverified"
    Facts = [System.Collections.Generic.List[string]]::new()
  }
}

function Invoke-Stop($Session, [string]$Slug, [string]$Title, [scriptblock]$Body) {
  $stop = New-Stop $Slug
  Write-Host "[tour] $($stop.Number) $Title"
  $mark = 0
  if ($Session) { $mark = Get-LogCount $Session }
  try {
    if ($Session) { Test-Running $Session }
    if ($Session) { Close-Dialogs $Session $stop }
    & $Body $stop | Out-Null
  } catch {
    $stop.Seen = "error"
    $stop.Facts.Add("error: $($_.Exception.Message)")
  }
  if (-not $stop.ShotSaved) {
    $window = [IntPtr]::Zero
    if ($Session) { $window = $Session.Main }
    Save-Shot $stop $window | Out-Null
  }
  if ($Session) {
    $new = @(Read-LogLines $Session.Log | Select-Object -Skip $mark)
    $missing = @($new | Where-Object { $_ -match "no Windows version yet: (.+)$" } | ForEach-Object { $Matches[1].Trim() })
    if ($missing.Count) { $stop.Facts.Add("first reached with no Windows version: $($missing -join ', ')") }
    $errors = @($new | Where-Object { $_ -match "^(js-error|error|fatal) " })
    if ($errors.Count) { $stop.Facts.Add("log errors during this stop: $(($errors | Select-Object -First 3) -join ' | ')") }
    if ($Session.Process.HasExited -and -not $Session.Stopping) {
      $stop.Seen = "crashed"
      $stop.Facts.Add("the app exited during this stop (exit code $($Session.Process.ExitCode))")
    }
  }
  $facts = ""
  if ($stop.Facts.Count) { $facts = " Facts: " + ($stop.Facts -join "; ") + "." }
  $shotName = Split-Path -Leaf $stop.Shot
  $shotLink = "no screenshot"
  if (Test-Path -LiteralPath $stop.Shot) { $shotLink = "[$shotName]($shotName)" }
  $script:Lines.Add("- **$($stop.Number) $Title** ($shotLink). Did: $($stop.Did) Expected: $($stop.Expected) Seen: **$($stop.Seen)**.$facts")
  Write-Host "[tour] $($stop.Number) -> $($stop.Seen)"
  Write-Tour
  return $stop
}

function Set-Seen($Stop, [bool]$Seen) {
  if ($Seen) { $Stop.Seen = "yes" } else { $Stop.Seen = "no" }
}

function Start-Ardia([string]$Name, [switch]$Onboarded, [hashtable]$Settings) {
  $data = Join-Path (Join-Path $Out "data") $Name
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $data
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  if ($Onboarded) {
    Set-Content -LiteralPath (Join-Path $data "onboarding.json") -Value '{"completedAt":1700000000000,"version":1}' -Encoding utf8NoBOM
  }
  if ($Settings) {
    $config = Join-Path $data "config"
    New-Item -ItemType Directory -Force -Path $config | Out-Null
    Set-Content -LiteralPath (Join-Path $config "config.json") -Value (@{ settings = $Settings } | ConvertTo-Json -Depth 5) -Encoding utf8NoBOM
  }
  $log = Join-Path $Out "$Name.log"
  Remove-Item -Force -ErrorAction SilentlyContinue $log
  $env:ARDIA_DATA_DIR = $data
  $env:ARDIA_BACKGROUND = ""
  Write-Host "[tour] launching '$Name' with data in $data"
  $process = Start-Process -FilePath $App -ArgumentList "--log-file=`"$log`"" -PassThru
  $null = $process.Handle
  $session = [pscustomobject]@{
    Name = $Name
    Process = $process
    Log = $log
    Data = $data
    Main = [IntPtr]::Zero
    Stopping = $false
    Started = Get-Date
    FirstWindowMs = $null
    Fatal = @()
    Errors = @()
    Missing = @()
    Summary = ""
    Crashed = $false
  }
  $script:Sessions.Add($session)
  $deadline = (Get-Date).AddSeconds($LaunchSeconds)
  while ((Get-Date) -lt $deadline -and -not $process.HasExited) {
    $first = @(Read-LogLines $log | Where-Object { $_ -match "^\w+ (\d+) .*\[ardia windows\] first window" } | Select-Object -First 1)
    $windows = @(Get-BigWindows $session)
    if ($first.Count -and $windows.Count) {
      if ($first[0] -match "^\w+ (\d+) ") { $session.FirstWindowMs = [int64]$Matches[1] }
      $session.Main = $windows[0].Handle
      break
    }
    Start-Sleep -Milliseconds 250
  }
  Start-Sleep -Milliseconds 1500
  return $session
}

function Stop-Ardia($Session) {
  if (-not $Session) { return }
  $exitedOnItsOwn = $Session.Process.HasExited
  $Session.Stopping = $true
  if (-not $exitedOnItsOwn) {
    try {
      Stop-Process -Id $Session.Process.Id -Force -ErrorAction Stop
      $Session.Process.WaitForExit(10000) | Out-Null
    } catch {
      Write-Host "[tour] could not stop '$($Session.Name)': $($_.Exception.Message)"
    }
  }
  Start-Sleep -Milliseconds 300
  $lines = @(Read-LogLines $Session.Log)
  $Session.Fatal = @($lines | Where-Object { $_ -match "^fatal " })
  $Session.Errors = @($lines | Where-Object { $_ -match "^(js-error|error) " })
  $Session.Missing = @($lines | Where-Object { $_ -match "no Windows version yet: (.+)$" } | ForEach-Object { $Matches[1].Trim() })
  $first = "never logged its first window"
  if ($null -ne $Session.FirstWindowMs) { $first = "first window $($Session.FirstWindowMs) ms after the process started" }
  if ($exitedOnItsOwn) {
    $Session.Summary = "The app exited on its own (exit code $($Session.Process.ExitCode)); $first."
    $Session.Crashed = $true
  } else {
    $Session.Summary = "Stopped by the tour; $first."
  }
  if ($Session.Fatal.Count -and -not $exitedOnItsOwn) { $Session.Summary += " The log has fatal lines although the app kept running (a fault it survived)." }
  Write-Host "[tour] '$($Session.Name)': $($Session.Summary)"
  foreach ($line in $Session.Fatal) { Write-Host $line }
  Write-Tour
}

function Test-Usable($Session) {
  return $Session -and -not $Session.Process.HasExited -and $Session.Main -ne [IntPtr]::Zero
}

function Get-TitleBand($Session) {
  $last = @(Read-LogLines $Session.Log | Where-Object { $_ -match "^window \d+ title band of \S+ is (caption|content)" } | Select-Object -Last 1)
  if (-not $last.Count) { return "content (never switched)" }
  if ($last[0] -match " is (caption|content)") { return $Matches[1] }
  return "unknown"
}

function Wait-Command($Session, [int]$Mark, [string]$Command, [int]$Milliseconds = 2500) {
  return Wait-Until $Session { (Get-LinesSince $Session $Mark "^command \d+ $([regex]::Escape($Command))$").Count -gt 0 } $Milliseconds
}

function Read-Onboarding($Session) {
  $path = Join-Path $Session.Data "onboarding.json"
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    try {
      if (-not (Test-Path -LiteralPath $path)) { return $null }
      $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
      try {
        $text = [System.IO.StreamReader]::new($stream).ReadToEnd()
      } finally {
        $stream.Dispose()
      }
      $document = $text | ConvertFrom-Json
      $step = "none"
      $sub = 0
      $completed = $null
      if ($document.PSObject.Properties.Name -contains "step" -and $document.step) { $step = [string]$document.step }
      if ($document.PSObject.Properties.Name -contains "sub" -and $null -ne $document.sub) { $sub = [int]$document.sub }
      if ($document.PSObject.Properties.Name -contains "completedAt" -and $document.completedAt) { $completed = $document.completedAt }
      return [pscustomobject]@{ Step = $step; Sub = $sub; Completed = $completed; Key = "$step/$sub/$completed" }
    } catch {
      Start-Sleep -Milliseconds 150
    }
  }
  return $null
}

function Get-OnboardingCard($Client) {
  $scale = $Client.Scale
  $width = [Math]::Min(880 * $scale, $Client.Width - 80 * $scale)
  $height = [Math]::Min(560 * $scale, $Client.Height - 80 * $scale)
  $left = $Client.X + ($Client.Width - $width) / 2
  $top = $Client.Y + ($Client.Height - $height) / 2
  return [pscustomobject]@{ Left = $left; Top = $top; Width = $width; Height = $height; Bottom = $top + $height; Scale = $scale }
}

function Invoke-OnboardingAdvance($Session, $State, $Stop) {
  $client = Get-Client $Session.Main
  if (-not $client) { throw "the onboarding window could not be measured" }
  $card = Get-OnboardingCard $client
  $scale = $card.Scale
  $hasBack = $State.Step -ne "source"
  $primaryLeft = $card.Left + 24 * $scale
  if ($hasBack) { $primaryLeft += (36 + 10) * $scale }
  $rowY = [int]($card.Bottom - 42 * $scale)
  $primaryNames = @("Continue")
  if ($State.Step -eq "outro") { $primaryNames = @("Get Started") }
  $attempts = [System.Collections.Generic.List[object]]::new()
  if ($State.Step -ne "source") {
    foreach ($name in $primaryNames) { $attempts.Add([pscustomobject]@{ Label = "'$name' found by UI Automation"; Name = $name; X = 0; Y = 0; Keys = $false }) }
    $attempts.Add([pscustomobject]@{ Label = "the primary button by position"; Name = ""; X = [int]($primaryLeft + 28 * $scale); Y = $rowY; Keys = $false })
  }
  if ($State.Step -ne "outro") {
    $attempts.Add([pscustomobject]@{ Label = "'Skip' found by UI Automation"; Name = "Skip"; X = 0; Y = 0; Keys = $false })
    $attempts.Add([pscustomobject]@{ Label = "Skip by position"; Name = ""; X = [int]($primaryLeft + (96 + 10 + 29) * $scale); Y = $rowY; Keys = $false })
  }
  $attempts.Add([pscustomobject]@{ Label = "Tab then Enter"; Name = ""; X = 0; Y = 0; Keys = $true })
  foreach ($attempt in $attempts) {
    Focus-Window $Session $Session.Main $null | Out-Null
    if ($attempt.Keys) {
      Send-Chord @() 0x09
      Send-Chord @() 0x0D
    } elseif ($attempt.Name) {
      $hits = @(Find-Named $Session.Main $attempt.Name)
      if (-not $hits.Count) { continue }
      Send-Click $hits[0].X $hits[0].Y
    } else {
      Send-Click $attempt.X $attempt.Y
    }
    $moved = Wait-Until $Session { $now = Read-Onboarding $Session; $now -and $now.Key -ne $State.Key } 2500
    if ($moved) {
      $now = Read-Onboarding $Session
      $Stop.Facts.Add("advanced with $($attempt.Label) to $($now.Step) $($now.Sub)")
      return $true
    }
    $Stop.Facts.Add("$($attempt.Label) did not advance")
  }
  return $false
}

function Invoke-OnboardingTour {
  $session = Start-Ardia "onboarding"
  if (-not (Test-Usable $session)) {
    Invoke-Stop $session "onboarding-launch" "Onboarding: first launch" {
      param($stop)
      $stop.Did = "Launched with a fresh data folder."
      $stop.Expected = "a window and the '[ardia windows] first window' log line within $LaunchSeconds s."
      $stop.Seen = "no"
      $stop.Facts.Add("windows: $(Format-Windows (Get-TopWindows $session))")
    } | Out-Null
    Stop-Ardia $session
    return
  }
  Invoke-Stop $session "onboarding-intro" "Onboarding: intro animation" {
    param($stop)
    $stop.Did = "Launched with a fresh data folder and shot the intro while it plays."
    $stop.Expected = "onboarding.json at the intro step."
    Focus-Window $session $session.Main $stop | Out-Null
    $state = Read-Onboarding $session
    Save-Shot $stop $session.Main | Out-Null
    if ($state) {
      Set-Seen $stop ($state.Step -eq "intro" -or $state.Step -eq "source")
      $stop.Facts.Add("onboarding.json step is $($state.Step)")
    } else {
      $stop.Seen = "no"
      $stop.Facts.Add("onboarding.json was not written")
    }
    $stop.Facts.Add("foreground is ours: $(Test-ForegroundIsOurs $session)")
  } | Out-Null

  Invoke-Stop $session "onboarding-intro-ends" "Onboarding: intro hands over to the first question" {
    param($stop)
    $stop.Did = "Waited up to 8 s for the intro to finish on its own, then clicked its Skip button."
    $stop.Expected = "onboarding.json moves to the source step."
    $ended = Wait-Until $session { $now = Read-Onboarding $session; $now -and $now.Step -ne "intro" } 8000
    if (-not $ended) {
      $client = Get-Client $session.Main
      $hits = @(Find-Named $session.Main "Skip")
      if ($hits.Count) { Send-Click $hits[0].X $hits[0].Y; $stop.Facts.Add("clicked Skip found by UI Automation") }
      elseif ($client) { Send-Click ($client.X + $client.Width - [int](57 * $client.Scale)) ($client.Y + $client.Height - [int](46 * $client.Scale)); $stop.Facts.Add("clicked Skip by position") }
      $ended = Wait-Until $session { $now = Read-Onboarding $session; $now -and $now.Step -ne "intro" } 3000
    } else {
      $stop.Facts.Add("the intro ended on its own")
    }
    Start-Sleep -Milliseconds 1200
    Set-Seen $stop $ended
  } | Out-Null

  $seenKeys = @{}
  for ($screen = 0; $screen -lt 32; $screen++) {
    if (-not (Test-Usable $session)) { break }
    $state = Read-Onboarding $session
    if (-not $state -or $state.Completed) { break }
    if ($seenKeys.ContainsKey($state.Key) -and $seenKeys[$state.Key] -ge 2) { break }
    $seenKeys[$state.Key] = 1 + [int]$seenKeys[$state.Key]
    $slug = "onboarding-$($state.Step)-$($state.Sub + 1)"
    $result = Invoke-Stop $session $slug "Onboarding: $($state.Step), question $($state.Sub + 1)" {
      param($stop)
      $stop.Did = "Shot the screen, then pressed its primary button (Skip on the source step, whose Continue waits for a choice)."
      $stop.Expected = "onboarding.json moves to the next question."
      Start-Sleep -Milliseconds 900
      Focus-Window $session $session.Main $stop | Out-Null
      Save-Shot $stop $session.Main | Out-Null
      Set-Seen $stop (Invoke-OnboardingAdvance $session $state $stop)
      Start-Sleep -Milliseconds 500
    }
    if ($result.Seen -ne "yes") { break }
  }

  Invoke-Stop $session "onboarding-done" "Onboarding: finished, the browser behind it" {
    param($stop)
    $stop.Did = "Waited for the onboarding to close after its last screen."
    $stop.Expected = "onboarding.json has completedAt."
    $done = Wait-Until $session { $now = Read-Onboarding $session; $now -and $now.Completed } 3000
    Start-Sleep -Milliseconds 1500
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop $done
    $now = Read-Onboarding $session
    if ($now) { $stop.Facts.Add("onboarding.json is at $($now.Step) $($now.Sub), completedAt $($now.Completed)") }
  } | Out-Null
  Stop-Ardia $session
}

function Invoke-ContextMenuStop($Session, [string]$Slug, [string]$Title, [string]$Where, [scriptblock]$Point, [switch]$NoArea) {
  Invoke-Stop $Session $Slug $Title {
    param($stop)
    Focus-Window $Session $Session.Main $stop | Out-Null
    Close-Menus $Session
    $target = & $Point
    $stop.Did = "Right-clicked $Where at $($target.X), $($target.Y) ($($target.How))."
    if ($NoArea) {
      $stop.Expected = "one 'context menu area: right press' line and no showMenu, since nothing there has a menu without the engine."
    } else {
      $stop.Expected = "the log lines 'context menu area: right press on ... opening its menu', 'menu showMenu asked' and 'menu pop-up menu shown'."
    }
    $mark = Get-LogCount $Session
    Send-Click $target.X $target.Y -Right
    $shown = Wait-Until $Session { (Get-LinesSince $Session $mark '^menu \d+ pop-up menu (shown|not shown)').Count -gt 0 } 2500
    Start-Sleep -Milliseconds 400
    Save-Shot $stop $Session.Main | Out-Null
    $area = @(Get-LinesSince $Session $mark 'context menu area: right press')
    $asked = @(Get-LinesSince $Session $mark '^menu \d+ showMenu asked')
    $popped = @(Get-LinesSince $Session $mark '^menu \d+ pop-up menu shown')
    if ($NoArea) {
      Set-Seen $stop ($area.Count -gt 0 -and $asked.Count -eq 0)
    } else {
      Set-Seen $stop ($shown -and $area.Count -gt 0 -and $asked.Count -gt 0 -and $popped.Count -gt 0)
    }
    $stop.Facts.Add("area line: $(if ($area.Count) { $area[0] } else { 'none' })")
    $stop.Facts.Add("showMenu asked: $(if ($asked.Count) { $asked[0] } else { 'none' })")
    $stop.Facts.Add("pop-up shown: $(if ($popped.Count) { $popped[0] } else { 'none' })")
    if ($popped.Count) {
      Send-Escape
      $closed = Wait-Until $Session { (Get-LinesSince $Session $mark '^menu \d+ pop-up menu (dismissed|chose|failed)').Count -gt 0 } 2000
      $result = @(Get-LinesSince $Session $mark '^menu \d+ pop-up menu (dismissed|chose|failed)')
      $stop.Facts.Add("after Escape: $(if ($closed -and $result.Count) { $result[0] } else { 'no result line' })")
    }
    Close-Menus $Session
  } | Out-Null
}

function Get-RegionBrightness([int]$Left, [int]$Top, [int]$Width, [int]$Height) {
  if ($Width -le 0 -or $Height -le 0) { return $null }
  try {
    $bitmap = New-Object System.Drawing.Bitmap $Width, $Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($Left, $Top, 0, 0, $bitmap.Size)
      $sum = 0.0
      $count = 0
      for ($y = 0; $y -lt $Height; $y += 2) {
        for ($x = 0; $x -lt $Width; $x += 2) {
          $pixel = $bitmap.GetPixel($x, $y)
          $sum += 0.299 * $pixel.R + 0.587 * $pixel.G + 0.114 * $pixel.B
          $count++
        }
      }
      if ($count -eq 0) { return $null }
      return [Math]::Round($sum / $count, 1)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  } catch {
    return $null
  }
}

function Get-SidebarTabRows($Session) {
  $client = Get-Client $Session.Main
  if (-not $client) { return @() }
  $sidebarRight = $client.X + [int](190 * $client.Scale)
  $hits = @(Find-Named $Session.Main "New Tab" | Where-Object { $_.X -lt $sidebarRight -and $_.Y -gt $client.Y + [int](12 * $client.Scale) } | Sort-Object Y)
  $rows = @()
  foreach ($hit in $hits) {
    $rows += [pscustomobject]@{
      X = $hit.X
      Y = $hit.Y
      Left = $client.X + [int](20 * $client.Scale)
      Top = $hit.Y - [int](12 * $client.Scale)
      Width = [int](140 * $client.Scale)
      Height = [int](24 * $client.Scale)
    }
  }
  return @($rows)
}

function Invoke-TabClickStop($Session) {
  Invoke-Stop $Session "tab-left-click" "Left click on an unselected sidebar tab" {
    param($stop)
    Focus-Window $Session $Session.Main $stop | Out-Null
    Close-Menus $Session
    $rows = @(Get-SidebarTabRows $Session)
    $stop.Expected = "the clicked row turns into the selected card (brighter) and the row that was selected loses it (darker); no context menu line."
    if ($rows.Count -lt 2) {
      $stop.Did = "Looked for at least two 'New Tab' rows in the sidebar with UI Automation."
      $stop.Seen = "no"
      $stop.Facts.Add("found $($rows.Count) rows")
      return
    }
    $brightness = @($rows | ForEach-Object { Get-RegionBrightness $_.Left $_.Top $_.Width $_.Height })
    $selected = 0
    for ($i = 1; $i -lt $rows.Count; $i++) { if ($brightness[$i] -gt $brightness[$selected]) { $selected = $i } }
    $pick = 0
    if ($selected -eq 0) { $pick = 1 }
    $target = $rows[$pick]
    $stop.Did = "Left-clicked sidebar row $($pick + 1) of $($rows.Count) at $($target.X), $($target.Y); row $($selected + 1) looked selected."
    $mark = Get-LogCount $Session
    Send-Click $target.X $target.Y
    Start-Sleep -Milliseconds 900
    Save-Shot $stop $Session.Main | Out-Null
    $pickAfter = Get-RegionBrightness $target.Left $target.Top $target.Width $target.Height
    $was = $rows[$selected]
    $wasAfter = Get-RegionBrightness $was.Left $was.Top $was.Width $was.Height
    $menuLines = @(Get-LinesSince $Session $mark 'context menu area: right press')
    $stop.Facts.Add("row brightness before: $($brightness -join ', ')")
    $stop.Facts.Add("clicked row $($brightness[$pick]) -> $pickAfter, previously selected row $($brightness[$selected]) -> $wasAfter")
    if ($menuLines.Count) { $stop.Facts.Add("a left click was read as a right press: $($menuLines[0])") }
    $became = $null -ne $pickAfter -and $null -ne $brightness[$pick] -and $pickAfter -gt $brightness[$pick] + 6
    $lost = $null -ne $wasAfter -and $null -ne $brightness[$selected] -and $wasAfter -lt $brightness[$selected] - 6
    Set-Seen $stop ($became -and $lost -and -not $menuLines.Count)
  } | Out-Null
}

function Invoke-ShortcutStop($Session, [string]$Slug, [string]$Title, [string]$Keys, [byte[]]$Modifiers, [byte]$Key, [string]$Command, [string]$Expected, [switch]$WatchBand, [switch]$ClosesOnEscape, [switch]$EscapeCaptured) {
  Invoke-Stop $Session $Slug $Title {
    param($stop)
    $stop.Did = "Pressed $Keys."
    $stop.Expected = $Expected
    Focus-Window $Session $Session.Main $stop | Out-Null
    Close-Menus $Session
    $mark = Get-LogCount $Session
    $before = @(Get-TopWindows $Session)
    Send-Chord $Modifiers $Key
    $commanded = Wait-Command $Session $mark $Command
    Start-Sleep -Milliseconds 900
    $new = @(Get-NewWindows $Session $before)
    Save-Shot $stop $Session.Main | Out-Null
    Set-Seen $stop $commanded
    $stop.Facts.Add("command $Command logged: $commanded")
    if ($new.Count) { $stop.Facts.Add("new windows: $(Format-Windows $new)") }
    if ($WatchBand) { $stop.Facts.Add("title band is now $(Get-TitleBand $Session) (a popover or panel makes it content)") }
    $bandBefore = Get-TitleBand $Session
    $captureOn = (Get-LinesSince $Session $mark '^keys \d+ escape capture on$').Count -gt 0
    if ($EscapeCaptured) { $stop.Facts.Add("native Escape capture turned on: $captureOn") }
    Close-Menus $Session
    $escapeMark = Get-LogCount $Session
    Send-Escape
    Start-Sleep -Milliseconds 500
    foreach ($window in $new) {
      if ([ArdiaTour]::IsWindow($window.Handle) -and $window.ClassName -ne "#32768" -and $window.Width -ge 300) {
        [ArdiaTour]::PostMessageW($window.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
      }
    }
    Start-Sleep -Milliseconds 400
    if ($WatchBand) { $stop.Facts.Add("after Escape the title band is $(Get-TitleBand $Session)") }
    if ($ClosesOnEscape) {
      $bandAfter = Get-TitleBand $Session
      $closed = $bandBefore -eq "content" -and $bandAfter -eq "caption"
      $stop.Facts.Add("closed by Escape (the band went from content back to caption): $closed")
      $seen = $commanded -and $closed
      if ($EscapeCaptured) {
        $sent = (Get-LinesSince $Session $escapeMark '^keys \d+ escape sent to the open popover or drag$').Count -gt 0
        $stop.Facts.Add("native code took the Escape and sent it to the popover: $sent")
        $seen = $seen -and $captureOn -and $sent
      }
      Set-Seen $stop $seen
    }
  } | Out-Null
}

function Find-SettingsWindow($Session) {
  $others = @(Get-BigWindows $Session | Where-Object { $_.Handle -ne $Session.Main })
  $titled = @($others | Where-Object { $_.Title -eq "Settings" })
  if ($titled.Count) { return @($titled[0]) }
  return @($others | Select-Object -First 1)
}

function Invoke-SettingsStops($Session, [string]$Suffix, [string]$Label, [switch]$Panes) {
  Invoke-Stop $Session "settings-general$Suffix" "Settings window, General$Label" {
    param($stop)
    $stop.Did = "Pressed Ctrl+, in the browser window."
    $stop.Expected = "a second top-level window of ours, titled Settings."
    Focus-Window $Session $Session.Main $stop | Out-Null
    $mark = Get-LogCount $Session
    Send-Chord @(0x11) 0xBC
    $opened = Wait-Until $Session { @(Find-SettingsWindow $Session).Count -gt 0 } 5000
    $stop.Facts.Add("command openSettings logged: $((Get-LinesSince $Session $mark '^command \d+ openSettings$').Count -gt 0)")
    if ($opened) {
      $found = (Find-SettingsWindow $Session)[0]
      $script:SettingsWindow = $found.Handle
      $stop.Facts.Add("the new window is titled '$($found.Title)'")
      Focus-Window $Session $script:SettingsWindow $stop | Out-Null
      Start-Sleep -Milliseconds 1500
      $frame = Get-Frame $script:SettingsWindow
      $stop.Facts.Add("Settings is $($frame.Width) by $($frame.Height) at $($frame.Left), $($frame.Top)")
      $dark = [ArdiaTour]::DarkModeOf($script:SettingsWindow)
      if ($dark -ge 0) { $stop.Facts.Add("DWM dark title bar: $dark") }
      Save-Shot $stop $script:SettingsWindow | Out-Null
    } else {
      $stop.Facts.Add("windows: $(Format-Windows (Get-TopWindows $Session))")
    }
    Set-Seen $stop $opened
  } | Out-Null
  if (-not $script:SettingsWindow -or -not [ArdiaTour]::IsWindow($script:SettingsWindow)) { return }
  if ($Panes) {
    foreach ($pane in @(@{ Name = "Appearance"; Slug = "settings-appearance"; Row = 4 }, @{ Name = "Keyboard Shortcuts"; Slug = "settings-shortcuts"; Row = 11 })) {
      Invoke-Stop $Session $pane.Slug "Settings window, $($pane.Name)" {
        param($stop)
        $stop.Expected = "the pane changes (more than 5% of the Settings window changes)."
        Focus-Window $Session $script:SettingsWindow $stop | Out-Null
        $client = Get-Client $script:SettingsWindow
        $hits = @(Find-Named $script:SettingsWindow $pane.Name | Where-Object { $client -and $_.X -lt $client.X + [int](214 * $client.Scale) })
        Measure-Screen "" $script:SettingsWindow | Out-Null
        if ($hits.Count) {
          Send-Click $hits[0].X $hits[0].Y
          $stop.Did = "Clicked '$($pane.Name)' in the Settings sidebar, found by UI Automation at $($hits[0].X), $($hits[0].Y)."
        } elseif ($client) {
          $x = $client.X + [int](100 * $client.Scale)
          $y = $client.Y + [int]((52 + 30 * $pane.Row + 15) * $client.Scale)
          Send-Click $x $y
          $stop.Did = "Clicked where '$($pane.Name)' should be in the Settings sidebar ($x, $y, estimated: UI Automation did not find it)."
        } else {
          throw "the Settings window could not be measured"
        }
        Start-Sleep -Milliseconds 1200
        $after = Save-Shot $stop $script:SettingsWindow
        if ($null -ne $after.Changed) { Set-Seen $stop ($after.Changed -gt 5) }
      } | Out-Null
    }
  }
  Invoke-Stop $Session "settings-closed$Suffix" "Settings window closed$Label" {
    param($stop)
    $stop.Did = "Sent WM_CLOSE to the Settings window."
    $stop.Expected = "the Settings window goes away and the app keeps running."
    [ArdiaTour]::PostMessageW($script:SettingsWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    $closed = Wait-Until $Session { -not [ArdiaTour]::IsWindow($script:SettingsWindow) -or -not [ArdiaTour]::IsWindowVisible($script:SettingsWindow) } 4000
    Start-Sleep -Milliseconds 600
    Focus-Window $Session $Session.Main $stop | Out-Null
    Save-Shot $stop $Session.Main | Out-Null
    Set-Seen $stop ($closed -and -not $Session.Process.HasExited)
  } | Out-Null
  $script:SettingsWindow = [IntPtr]::Zero
}

function Invoke-MainTour {
  $session = Start-Ardia "browser" -Onboarded
  Invoke-Stop $session "main-window" "Main window, onboarding done" {
    param($stop)
    $stop.Did = "Launched with onboarding.json marked done and waited for the first window."
    $stop.Expected = "one big window of ours, the first-window log line, the page card at the top of the window with the app's own window buttons in its toolbar, and caption regions marked for Windows."
    if (-not (Test-Usable $session)) { $stop.Seen = "no"; return }
    Focus-Window $session $session.Main $stop -ClickBand | Out-Null
    Start-Sleep -Milliseconds 600
    $shot = Save-Shot $stop $session.Main
    $script:LightBrightness = $shot.Brightness
    $band = Get-TitleBand $session
    Set-Seen $stop ($band -eq "caption")
    $stop.Facts.Add("title band is $band")
    $stop.Facts.Add("windows: $(Format-Windows (Get-TopWindows $session))")
    $stop.Facts.Add("foreground is ours: $(Test-ForegroundIsOurs $session)")
    $stop.Facts.Add("DWM dark title bar: $([ArdiaTour]::DarkModeOf($session.Main))")
  } | Out-Null
  if (-not (Test-Usable $session)) { Stop-Ardia $session; return }

  Invoke-Stop $session "new-tabs" "Three new tabs" {
    param($stop)
    $stop.Did = "Pressed Ctrl+T three times."
    $stop.Expected = "three newTab commands in the log."
    Focus-Window $session $session.Main $stop | Out-Null
    $mark = Get-LogCount $session
    foreach ($i in 1..3) {
      Send-Chord @(0x11) 0x54
      Start-Sleep -Milliseconds 500
    }
    Start-Sleep -Milliseconds 800
    $count = (Get-LinesSince $session $mark '^command \d+ newTab$').Count
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop ($count -eq 3)
    $stop.Facts.Add("$count newTab commands logged")
  } | Out-Null

  Invoke-Stop $session "command-bar" "Command bar with text typed" {
    param($stop)
    $stop.Did = "Pressed Ctrl+L and typed 'ardia'."
    $stop.Expected = "a focusCommandBar command in the log."
    Focus-Window $session $session.Main $stop | Out-Null
    $mark = Get-LogCount $session
    Send-Chord @(0x11) 0x4C
    $commanded = Wait-Command $session $mark "focusCommandBar"
    Start-Sleep -Milliseconds 500
    Send-Text "ardia"
    Start-Sleep -Milliseconds 700
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop $commanded
    $stop.Facts.Add("command focusCommandBar logged: $commanded")
    $stop.Facts.Add("title band is $(Get-TitleBand $session) (an open command panel makes it content)")
    Send-Escape
    Send-Escape
    Start-Sleep -Milliseconds 500
    $stop.Facts.Add("after Escape the title band is $(Get-TitleBand $session)")
  } | Out-Null

  Invoke-ContextMenuStop $session "menu-sidebar-tab" "Context menu on a sidebar tab" "a tab in the sidebar" {
    $client = Get-Client $session.Main
    $sidebarRight = $client.X + [int](190 * $client.Scale)
    $hits = @(Find-Named $session.Main "New Tab" | Where-Object { $_.X -lt $sidebarRight -and $_.Y -gt $client.Y + [int](12 * $client.Scale) } | Sort-Object Y)
    if ($hits.Count) {
      $pick = $hits[[int][Math]::Floor($hits.Count / 2)]
      return [pscustomobject]@{ X = $pick.X; Y = $pick.Y; How = "the middle of $($hits.Count) 'New Tab' labels UI Automation found in the sidebar" }
    }
    return [pscustomobject]@{ X = $client.X + [int](95 * $client.Scale); Y = $client.Y + [int]($client.Height * 0.3); How = "estimated: UI Automation found no 'New Tab' label in the sidebar" }
  }

  Invoke-ContextMenuStop $session "menu-page" "Context menu on the page area" "the middle of the page area" {
    $client = Get-Client $session.Main
    $sidebar = [int](190 * $client.Scale)
    return [pscustomobject]@{ X = $client.X + $sidebar + [int](($client.Width - $sidebar) / 2); Y = $client.Y + [int]($client.Height * 0.68); How = "position" }
  } -NoArea

  Invoke-TabClickStop $session

  Invoke-Stop $session "sidebar-hidden" "Sidebar hidden" {
    param($stop)
    $stop.Did = "Pressed Ctrl+S (Auto-Hide Tabs)."
    $stop.Expected = "the log says the sidebar edge watch turned on, which happens when the sidebar hides."
    Focus-Window $session $session.Main $stop | Out-Null
    $mark = Get-LogCount $session
    Send-Chord @(0x11) 0x53
    $hidden = Wait-Until $session { (Get-LinesSince $session $mark '^window \d+ sidebar edge watch on').Count -gt 0 } 3000
    Start-Sleep -Milliseconds 900
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop $hidden
    $stop.Facts.Add("command toggleSidebar logged: $((Get-LinesSince $session $mark '^command \d+ toggleSidebar$').Count -gt 0)")
  } | Out-Null

  Invoke-Stop $session "sidebar-shown" "Sidebar shown again" {
    param($stop)
    $stop.Did = "Pressed Ctrl+S again."
    $stop.Expected = "the log says the sidebar edge watch turned off."
    Focus-Window $session $session.Main $stop | Out-Null
    $mark = Get-LogCount $session
    Send-Chord @(0x11) 0x53
    $shown = Wait-Until $session { (Get-LinesSince $session $mark '^window \d+ sidebar edge watch off').Count -gt 0 } 3000
    Start-Sleep -Milliseconds 900
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop $shown
  } | Out-Null

  Invoke-ShortcutStop $session "downloads" "Downloads popover" "Ctrl+J" @(0x11) 0x4A "downloads" "a downloads command in the log, the title band turning to content while the popover is open, native code taking Escape for it, and the popover closing on Escape so the band is a caption again." -WatchBand -ClosesOnEscape -EscapeCaptured
  Invoke-ShortcutStop $session "search-tabs" "Search tabs" "Ctrl+Shift+A" @(0x11, 0x10) 0x41 "searchTabs" "a searchTabs command in the log." -WatchBand
  Invoke-ShortcutStop $session "profile-menu" "Profiles menu" "Ctrl+Shift+M" @(0x11, 0x10) 0x4D "openProfileMenu" "an openProfileMenu command in the log."
  Invoke-ShortcutStop $session "task-manager" "Task manager" "Shift+Escape" @(0x10) 0x1B "taskManager" "a taskManager command in the log."

  Invoke-SettingsStops $session "" "" -Panes

  Invoke-Stop $session "little-ardia" "Little Ardia window" {
    param($stop)
    $stop.Did = "Pressed Ctrl+Alt+N."
    $stop.Expected = "a newLittleArdia command, a new top-level window of ours, and its command panel drawn whole below the bar's field rather than cut off 24 points down, with the window buttons on the bare bar."
    Focus-Window $session $session.Main $stop | Out-Null
    $mark = Get-LogCount $session
    $before = @(Get-BigWindows $session)
    Send-Chord @(0x11, 0x12) 0x4E
    $commanded = Wait-Command $session $mark "newLittleArdia"
    $opened = Wait-Until $session { @(Get-NewWindows $session $before | Where-Object { $_.ClassName -ne "#32768" -and $_.Width -ge 300 }).Count -gt 0 } 5000
    Start-Sleep -Milliseconds 1500
    $new = @(Get-NewWindows $session $before | Where-Object { $_.ClassName -ne "#32768" -and $_.Width -ge 300 })
    $target = $session.Main
    if ($new.Count) { $target = $new[0].Handle }
    Save-Shot $stop $target | Out-Null
    Set-Seen $stop $opened
    $stop.Facts.Add("command newLittleArdia logged: $commanded")
    $stop.Facts.Add("new windows: $(Format-Windows $new)")
    $client = $null
    if ($new.Count) { $client = Get-Client $target }
    if ($client) {
      $scale = $client.Scale
      $panel = Get-RegionBrightness ($client.X + [int](400 * $scale)) ($client.Y + [int](25 * $scale)) ([int](240 * $scale)) ([int](10 * $scale))
      $caption = Get-RegionBrightness ($client.X + $client.Width - [int](128 * $scale)) ($client.Y + [int](4 * $scale)) ([int](118 * $scale)) ([int](24 * $scale))
      $whole = $null -ne $panel -and $panel -ge 240
      $bare = $null -ne $caption -and $caption -lt 240
      $stop.Facts.Add("command panel brightness at 400 to 640 by 25 to 35 points: $panel (240 or more is the panel; the bare band is darker)")
      $stop.Facts.Add("caption buttons' area brightness: $caption (under 240 is the bare band)")
      Set-Seen $stop ($opened -and $whole -and $bare)
    }
    foreach ($window in $new) { [ArdiaTour]::PostMessageW($window.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
    Start-Sleep -Milliseconds 800
  } | Out-Null

  $restoreFrame = $null
  if (Test-Usable $session) { $restoreFrame = Get-Frame $session.Main }

  Invoke-Stop $session "maximized" "Main window maximized" {
    param($stop)
    $stop.Did = "Maximized the main window with ShowWindow."
    $stop.Expected = "the window reports maximized."
    Focus-Window $session $session.Main $stop | Out-Null
    [ArdiaTour]::ShowWindow($session.Main, 3) | Out-Null
    $zoomed = Wait-Until $session { [ArdiaTour]::IsZoomed($session.Main) } 2000
    Start-Sleep -Milliseconds 1200
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop $zoomed
    $frame = Get-Frame $session.Main
    $stop.Facts.Add("frame $($frame.Width) by $($frame.Height) at $($frame.Left), $($frame.Top)")
    [ArdiaTour]::ShowWindow($session.Main, 9) | Out-Null
    Start-Sleep -Milliseconds 800
  } | Out-Null

  Invoke-Stop $session "small" "Main window at a small size" {
    param($stop)
    $client = Get-Client $session.Main
    $scale = 1.0
    if ($client) { $scale = $client.Scale }
    $width = [int](640 * $scale)
    $height = [int](460 * $scale)
    $stop.Did = "Resized the main window to $width by $height with SetWindowPos."
    $stop.Expected = "the window frame is that size (within 8 px)."
    [ArdiaTour]::SetWindowPos($session.Main, [IntPtr]::Zero, 40, 40, $width, $height, 0x0014) | Out-Null
    Start-Sleep -Milliseconds 1500
    $frame = Get-Frame $session.Main
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop ($frame -and [Math]::Abs($frame.Width - $width) -le 8 -and [Math]::Abs($frame.Height - $height) -le 8)
    $stop.Facts.Add("frame $($frame.Width) by $($frame.Height)")
    if ($restoreFrame) { [ArdiaTour]::SetWindowPos($session.Main, [IntPtr]::Zero, $restoreFrame.Left, $restoreFrame.Top, $restoreFrame.Width, $restoreFrame.Height, 0x0014) | Out-Null }
    Start-Sleep -Milliseconds 500
  } | Out-Null

  Stop-Ardia $session
}

function Wait-Title($Session, [string]$Pattern, [int]$Milliseconds = 25000) {
  return Wait-Until $Session { [ArdiaTour]::TitleOf($Session.Main) -match $Pattern } $Milliseconds
}

function Open-Page($Session, $Stop, [string]$Address, [string]$TitlePattern) {
  Focus-Window $Session $Session.Main $Stop | Out-Null
  $mark = Get-LogCount $Session
  Send-Chord @(0x11) 0x54
  $opened = Wait-Command $Session $mark "newTab"
  Start-Sleep -Milliseconds 700
  Send-Text $Address
  Start-Sleep -Milliseconds 500
  Send-Key 0x0D 0
  Send-Key 0x0D 2
  $loaded = Wait-Title $Session $TitlePattern
  Start-Sleep -Milliseconds 3500
  $Stop.Facts.Add("newTab command logged: $opened")
  $Stop.Facts.Add("window title: '$([ArdiaTour]::TitleOf($Session.Main))'")
  return $loaded
}

function Invoke-PagesTour {
  $session = Start-Ardia "pages" -Onboarded
  Invoke-Stop $session "page-loads" "A page loads in a tab" {
    param($stop)
    $stop.Did = "Pressed Ctrl+T, typed example.com and pressed Enter."
    $stop.Expected = "the window's title names the page's site, and the page shows in the card."
    if (-not (Test-Usable $session)) { $stop.Seen = "no"; return }
    $loaded = Open-Page $session $stop "example.com" "example\.com"
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop $loaded
    $stop.Facts.Add("windows: $(Format-Windows (Get-TopWindows $session))")
  } | Out-Null
  if (-not (Test-Usable $session)) { Stop-Ardia $session; return }

  Invoke-Stop $session "page-find" "Find in the page" {
    param($stop)
    $stop.Did = "Pressed Ctrl+F with the page showing and typed 'domain'."
    $stop.Expected = "a findInPage command in the log, and the find bar over the page."
    $mark = Get-LogCount $session
    Send-Chord @(0x11) 0x46
    $commanded = Wait-Command $session $mark "findInPage"
    Start-Sleep -Milliseconds 600
    Send-Text "domain"
    Start-Sleep -Milliseconds 1200
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop $commanded
    $stop.Facts.Add("command findInPage logged: $commanded")
    Send-Escape
    Start-Sleep -Milliseconds 500
  } | Out-Null

  Invoke-Stop $session "page-command-bar" "The command bar over a page" {
    param($stop)
    $stop.Did = "Pressed Ctrl+L with the page showing."
    $stop.Expected = "a focusCommandBar command in the log, and the command bar drawn over the page."
    $mark = Get-LogCount $session
    Send-Chord @(0x11) 0x4C
    $commanded = Wait-Command $session $mark "focusCommandBar"
    Start-Sleep -Milliseconds 1200
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop $commanded
    $stop.Facts.Add("command focusCommandBar logged: $commanded")
    Send-Escape
    Send-Escape
    Start-Sleep -Milliseconds 500
  } | Out-Null

  Invoke-Stop $session "page-second-tab" "A second page in a second tab" {
    param($stop)
    $stop.Did = "Pressed Ctrl+T, typed developer.mozilla.org and pressed Enter."
    $stop.Expected = "the window's title names the second page's site."
    $loaded = Open-Page $session $stop "developer.mozilla.org" "developer\.mozilla\.org"
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop $loaded
  } | Out-Null

  Invoke-Stop $session "page-back-to-first" "Back to the first tab" {
    param($stop)
    $stop.Did = "Pressed Ctrl+Tab to go to the tab used before this one."
    $stop.Expected = "the window's title names the first page's site again."
    Send-Chord @(0x11) 0x09
    $back = Wait-Title $session "example\.com" 8000
    Start-Sleep -Milliseconds 800
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop $back
    $stop.Facts.Add("window title: '$([ArdiaTour]::TitleOf($session.Main))'")
  } | Out-Null

  Invoke-Stop $session "page-history" "History lists the pages" {
    param($stop)
    $stop.Did = "Pressed Ctrl+H."
    $stop.Expected = "the window's title names History, and the page lists the two sites."
    Focus-Window $session $session.Main $stop | Out-Null
    Send-Chord @(0x11) 0x48
    $shown = Wait-Title $session "History" 8000
    Start-Sleep -Milliseconds 1500
    Save-Shot $stop $session.Main | Out-Null
    Set-Seen $stop $shown
    $stop.Facts.Add("window title: '$([ArdiaTour]::TitleOf($session.Main))'")
  } | Out-Null

  Invoke-Stop $session "page-private" "A page in a private window" {
    param($stop)
    $stop.Did = "Pressed Ctrl+Shift+N, typed example.com in the new window and pressed Enter."
    $stop.Expected = "a second window of ours, dark, whose title names the page's site."
    Focus-Window $session $session.Main $stop | Out-Null
    $before = @(Get-TopWindows $session)
    Send-Chord @(0x11, 0x10) 0x4E
    $ours = { @(Get-NewWindows $session $before | Where-Object { $_.ClassName -notmatch "^(#32768|Chrome_)" -and $_.Width -ge 300 -and $_.Height -ge 200 }) }
    $opened = Wait-Until $session { (& $ours).Count -gt 0 } 8000
    if (-not $opened) {
      $stop.Facts.Add("windows: $(Format-Windows (Get-TopWindows $session))")
      Set-Seen $stop $false
      return
    }
    $private = (& $ours)[0].Handle
    Focus-Window $session $private $stop | Out-Null
    Start-Sleep -Milliseconds 1200
    Send-Text "example.com"
    Start-Sleep -Milliseconds 500
    Send-Key 0x0D 0
    Send-Key 0x0D 2
    $loaded = Wait-Until $session { [ArdiaTour]::TitleOf($private) -match "example\.com" } 25000
    Start-Sleep -Milliseconds 3500
    Save-Shot $stop $private | Out-Null
    Set-Seen $stop $loaded
    $stop.Facts.Add("the new window is titled '$([ArdiaTour]::TitleOf($private))'")
  } | Out-Null
  Stop-Ardia $session
}

function Invoke-LayoutTour([string]$Name, [hashtable]$Settings, [string]$Title, [string]$Expected) {
  $session = Start-Ardia $Name -Onboarded -Settings $Settings
  Invoke-Stop $session $Name $Title {
    param($stop)
    $stop.Did = "Launched with $(($Settings.GetEnumerator() | ForEach-Object { "$($_.Key) = $($_.Value)" }) -join ', ') in config.json, then pressed Ctrl+T twice."
    $stop.Expected = $Expected
    if (-not (Test-Usable $session)) { $stop.Seen = "no"; return }
    Focus-Window $session $session.Main $stop | Out-Null
    $mark = Get-LogCount $session
    Send-Chord @(0x11) 0x54
    Send-Chord @(0x11) 0x54
    Start-Sleep -Milliseconds 1200
    Save-Shot $stop $session.Main | Out-Null
    $band = Get-TitleBand $session
    Set-Seen $stop ($band -eq "caption")
    $stop.Facts.Add("title band is $band")
    $stop.Facts.Add("$((Get-LinesSince $session $mark '^command \d+ newTab$').Count) newTab commands logged")
    $problems = @(Read-LogLines $session.Log | Where-Object { $_ -match "\[config\]" })
    if ($problems.Count) { $stop.Facts.Add("config log lines: $(($problems | Select-Object -First 3) -join ' | ')") }
  } | Out-Null
  Stop-Ardia $session
}

function Invoke-DarkTour {
  $session = Start-Ardia "dark" -Onboarded -Settings @{ appearance = "dark" }
  Invoke-Stop $session "dark-main" "Dark mode, main window" {
    param($stop)
    $stop.Did = "Launched with appearance = dark in config.json."
    $stop.Expected = "the window's DWM dark mode attribute is on, and the window is darker than the light main window."
    if (-not (Test-Usable $session)) { $stop.Seen = "no"; return }
    Focus-Window $session $session.Main $stop | Out-Null
    Start-Sleep -Milliseconds 800
    $shot = Save-Shot $stop $session.Main
    $dark = [ArdiaTour]::DarkModeOf($session.Main)
    $darker = $null
    if ($null -ne $shot.Brightness -and $null -ne $script:LightBrightness) {
      $darker = $shot.Brightness -lt ($script:LightBrightness - 30)
      $stop.Facts.Add("brightness $($shot.Brightness) against $($script:LightBrightness) in light mode")
    }
    $stop.Facts.Add("DWM dark title bar: $dark (-1 means it could not be read)")
    if ($dark -eq 1 -or $darker -eq $true) { $stop.Seen = "yes" }
    elseif ($dark -eq 0 -or $darker -eq $false) { $stop.Seen = "no" }
  } | Out-Null
  if (Test-Usable $session) { Invoke-SettingsStops $session "-dark" ", dark mode" }
  Stop-Ardia $session
}

$script:SettingsWindow = [IntPtr]::Zero

if (-not (Test-Path -LiteralPath $App)) {
  $script:Lines.Add("- No app at '$App': nothing to tour (did the build fail?).")
  Write-Tour
  Write-Host "[tour] no app at $App"
  exit 0
}
$App = (Resolve-Path -LiteralPath $App).Path

$tours = @(
  @{ Name = "onboarding"; Run = { Invoke-OnboardingTour } },
  @{ Name = "browser"; Run = { Invoke-MainTour } },
  @{ Name = "top tabs"; Run = { Invoke-LayoutTour "top-tabs" @{ tabLayout = "top" } "Tabs in a top strip" "the window buttons sit at the end of the strip, and the gap beside them is a caption region." } },
  @{ Name = "sidebar on the right"; Run = { Invoke-LayoutTour "sidebar-right" @{ sidebarSide = "right" } "Sidebar on the right" "the window buttons sit in the sidebar's header, and the gap beside them is a caption region." } },
  @{ Name = "dark"; Run = { Invoke-DarkTour } }
)

if (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $App) "chrome.dll")) {
  $tours += @{ Name = "pages"; Run = { Invoke-PagesTour } }
}

if ($Only.Count) {
  $tours = @($tours | Where-Object { $Only -contains $_.Name })
  if (-not $tours.Count) { throw "no part of the tour is named $($Only -join ', ')" }
}

foreach ($tour in $tours) {
  Write-Host "[tour] === $($tour.Name) ==="
  try {
    & $tour.Run
  } catch {
    $script:Lines.Add("- The $($tour.Name) part stopped early: $($_.Exception.Message)")
    Write-Host "[tour] the $($tour.Name) part stopped early: $($_.Exception.Message)"
  } finally {
    foreach ($session in @($script:Sessions | Where-Object { -not $_.Stopping })) { Stop-Ardia $session }
  }
}

$env:ARDIA_DATA_DIR = ""
Write-Tour
$elapsed = [Math]::Round(((Get-Date) - $script:Started).TotalSeconds)
$crashed = @($script:Sessions | Where-Object { $_.Crashed })
Write-Host "[tour] $($script:StopNumber) stops in $elapsed s; tour.md and the screenshots are in $Out"
if ($crashed.Count) {
  foreach ($session in $crashed) { Write-Host "::error::the app crashed or exited on its own during the '$($session.Name)' launch: $($session.Summary)" }
  exit 1
}
exit 0
