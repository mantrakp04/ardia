$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository "apps\browser\macos\Ardia.xcodeproj\project.pbxproj"
$found = Select-String -LiteralPath $project -Pattern 'MARKETING_VERSION = "?([^";]+)"?;' | Select-Object -First 1
if (-not $found) { throw "no MARKETING_VERSION in $project" }
$found.Matches[0].Groups[1].Value
