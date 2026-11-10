param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Seconds = 25
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$log = Join-Path $Out "launch.log"
$shot = Join-Path $Out "window.png"
Remove-Item -Force -ErrorAction SilentlyContinue $log, $shot

$process = Start-Process -FilePath $App -ArgumentList "--log-file=`"$log`"" -PassThru
Start-Sleep -Seconds $Seconds

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save($shot, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

$exited = $process.HasExited
if (-not $exited) { Stop-Process -Id $process.Id -Force }

if (Test-Path $log) { Get-Content $log } else { Write-Host "no launch log was written" }

$failures = @()
if ($exited) { $failures += "the app exited on its own within $Seconds s (exit code $($process.ExitCode))" }
if (-not (Test-Path $log)) { $failures += "the app wrote no launch log" }
elseif (Select-String -Path $log -Pattern "^(js-error|fatal) " -Quiet) { $failures += "the launch log has JavaScript errors" }
elseif (-not (Select-String -Path $log -Pattern "\[ardia windows\] first window" -Quiet)) { $failures += "the first window never rendered" }

if ($failures.Count) {
  $failures | ForEach-Object { Write-Host "::error::$_" }
  exit 1
}
Write-Host "The app launched, rendered its first window and stayed up for $Seconds s."
