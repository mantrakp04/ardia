param(
  [Parameter(Mandatory = $true)][string]$From,
  [Parameter(Mandatory = $true)][string]$To
)

$ErrorActionPreference = "Stop"

function Find-InWindowsKits {
  $architectures = @()
  if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $architectures += "arm64" }
  $architectures += "x64", "x86"
  $roots = @()
  foreach ($key in "HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows Kits\Installed Roots") {
    $installed = Get-ItemProperty -Path $key -Name KitsRoot10 -ErrorAction SilentlyContinue
    if ($installed -and $installed.KitsRoot10) { $roots += $installed.KitsRoot10 }
  }
  foreach ($programs in ${env:ProgramFiles(x86)}, $env:ProgramFiles) {
    if ($programs) { $roots += (Join-Path $programs "Windows Kits\10") }
  }
  foreach ($root in ($roots | Select-Object -Unique)) {
    $bin = Join-Path $root "bin"
    if (-not (Test-Path $bin)) { continue }
    $versions = Get-ChildItem -Path $bin -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending
    foreach ($version in $versions) {
      foreach ($architecture in $architectures) {
        $candidate = Join-Path $version.FullName (Join-Path $architecture "mt.exe")
        if (Test-Path $candidate) { return $candidate }
      }
    }
  }
  return $null
}

function Find-InPackages {
  $packages = $env:NUGET_PACKAGES
  if (-not $packages -and $env:USERPROFILE) { $packages = Join-Path $env:USERPROFILE ".nuget\packages" }
  if (-not $packages) { return $null }
  $tools = Join-Path $packages "microsoft.windows.sdk.buildtools"
  if (-not (Test-Path $tools)) { return $null }
  $found = Get-ChildItem -Path $tools -Recurse -Filter mt.exe -ErrorAction SilentlyContinue | Where-Object { $_.Directory.Name -eq "x64" } | Sort-Object FullName -Descending | Select-Object -First 1
  if ($found) { return $found.FullName }
  return $null
}

function Find-WithVisualStudio([string]$scratch) {
  $programs = ${env:ProgramFiles(x86)}
  if (-not $programs) { return $null }
  $vswhere = Join-Path $programs "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) { return $null }
  $install = & $vswhere -latest -products * -property installationPath | Select-Object -First 1
  if (-not $install) { return $null }
  $developerPrompt = Join-Path $install "Common7\Tools\VsDevCmd.bat"
  if (-not (Test-Path $developerPrompt)) { return $null }
  $probe = Join-Path $scratch "find-mt.cmd"
  Set-Content -Path $probe -Encoding ascii -Value @("@echo off", "call `"$developerPrompt`" -no_logo >nul 2>nul", "where mt.exe 2>nul")
  $found = & $env:ComSpec /d /c $probe | Select-Object -First 1
  if ($found -and (Test-Path $found)) { return $found }
  return $null
}

function Find-ManifestTool([string]$scratch) {
  $onPath = Get-Command mt.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($onPath) { return $onPath.Source }
  $found = Find-InWindowsKits
  if (-not $found) { $found = Find-InPackages }
  if (-not $found) { $found = Find-WithVisualStudio $scratch }
  if (-not $found) { throw "mt.exe was not found: install the Windows SDK, or run from a Visual Studio developer prompt" }
  return $found
}

function Read-EmbeddedManifest([string]$tool, [string]$binary, [int[]]$ids, [string]$out) {
  foreach ($id in $ids) {
    if (Test-Path $out) { Remove-Item $out -Force }
    $said = & $tool -nologo "-inputresource:$binary;#$id" "-out:$out" | Out-String
    if ($LASTEXITCODE -eq 0 -and (Test-Path $out)) { return $id }
    $script:lastToolOutput = $said
  }
  return 0
}

function Read-Xml([string]$path) {
  $document = New-Object System.Xml.XmlDocument
  $document.PreserveWhitespace = $false
  $document.Load($path)
  if (-not $document.DocumentElement -or $document.DocumentElement.LocalName -ne "assembly") { throw "'$path' is not an application manifest" }
  return $document
}

function Get-Registrations($document) {
  return @($document.DocumentElement.ChildNodes | Where-Object { $_.NodeType -eq [System.Xml.XmlNodeType]::Element -and $_.LocalName -eq "file" })
}

function Get-ClassNames($files) {
  $names = @()
  foreach ($file in $files) {
    foreach ($entry in $file.ChildNodes) {
      if ($entry.NodeType -eq [System.Xml.XmlNodeType]::Element -and $entry.LocalName -eq "activatableClass") { $names += $entry.GetAttribute("name") }
    }
  }
  return $names
}

$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("ardia-host-manifest-" + [guid]::NewGuid().ToString("N"))
$failed = $null
try {
  if (-not (Test-Path -LiteralPath $From -PathType Leaf)) { throw "'$From' does not exist" }
  if (-not (Test-Path -LiteralPath $To -PathType Leaf)) { throw "'$To' does not exist" }
  $source = (Resolve-Path -LiteralPath $From).Path
  $target = (Resolve-Path -LiteralPath $To).Path
  if ([System.IO.Path]::GetExtension($target) -ne ".exe") { throw "'$To' is not an .exe: Windows reads these entries from the process's own executable" }
  New-Item -ItemType Directory -Path $scratch -Force | Out-Null

  $tool = Find-ManifestTool $scratch
  Write-Host "host-manifest: using $tool"

  $sourceManifest = Join-Path $scratch "source.manifest"
  $sourceExtension = [System.IO.Path]::GetExtension($source).ToLowerInvariant()
  if ($sourceExtension -eq ".dll" -or $sourceExtension -eq ".exe") {
    $order = if ($sourceExtension -eq ".dll") { 2, 1 } else { 1, 2 }
    $sourceId = Read-EmbeddedManifest $tool $source $order $sourceManifest
    if ($sourceId -eq 0) { throw "'$From' has no embedded manifest. $script:lastToolOutput" }
    Write-Host "host-manifest: read manifest resource $sourceId of $source"
  } else {
    Copy-Item -LiteralPath $source -Destination $sourceManifest
    Write-Host "host-manifest: read $source"
  }
  $sourceDocument = Read-Xml $sourceManifest
  $sourceFiles = @(Get-Registrations $sourceDocument)
  $sourceClasses = @(Get-ClassNames $sourceFiles)
  if ($sourceFiles.Count -eq 0 -or $sourceClasses.Count -eq 0) { throw "'$From' has no registration-free WinRT entries" }

  $working = Join-Path $scratch "target.exe"
  Copy-Item -LiteralPath $target -Destination $working
  $targetManifest = Join-Path $scratch "target.manifest"
  $targetDocument = New-Object System.Xml.XmlDocument
  $targetId = Read-EmbeddedManifest $tool $working @(1) $targetManifest
  if ($targetId -eq 0) {
    $targetDocument.LoadXml('<?xml version="1.0" encoding="utf-8" standalone="yes"?><assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1"></assembly>')
    Write-Host "host-manifest: $target has no manifest yet"
  } else {
    $targetDocument = Read-Xml $targetManifest
  }

  $incoming = @{}
  foreach ($file in $sourceFiles) { $incoming[$file.GetAttribute("name").ToLowerInvariant()] = $true }
  $replaced = 0
  $kept = 0
  foreach ($existing in @(Get-Registrations $targetDocument)) {
    if ($incoming.ContainsKey($existing.GetAttribute("name").ToLowerInvariant())) {
      [void]$targetDocument.DocumentElement.RemoveChild($existing)
      $replaced += 1
    } else {
      $kept += 1
    }
  }
  foreach ($file in $sourceFiles) { [void]$targetDocument.DocumentElement.AppendChild($targetDocument.ImportNode($file, $true)) }

  $mergedManifest = Join-Path $scratch "merged.manifest"
  $settings = New-Object System.Xml.XmlWriterSettings
  $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
  $settings.Indent = $true
  $writer = [System.Xml.XmlWriter]::Create($mergedManifest, $settings)
  try { $targetDocument.Save($writer) } finally { $writer.Close() }

  $said = & $tool -nologo -manifest $mergedManifest "-outputresource:$working;#1" | Out-String
  if ($LASTEXITCODE -ne 0) { throw "mt.exe could not write the manifest (exit code $LASTEXITCODE). $said" }

  $writtenManifest = Join-Path $scratch "written.manifest"
  if ((Read-EmbeddedManifest $tool $working @(1) $writtenManifest) -eq 0) { throw "the manifest written to '$To' could not be read back. $script:lastToolOutput" }
  $writtenFiles = @(Get-Registrations (Read-Xml $writtenManifest))
  $writtenClasses = @{}
  foreach ($name in @(Get-ClassNames $writtenFiles)) { $writtenClasses[$name] = $true }
  $missing = @($sourceClasses | Where-Object { -not $writtenClasses.ContainsKey($_) })
  if ($missing.Count -gt 0) { throw "$($missing.Count) classes are missing from the written manifest, the first is $($missing[0])" }
  $seen = @{}
  foreach ($file in $writtenFiles) {
    $name = $file.GetAttribute("name").ToLowerInvariant()
    if ($seen.ContainsKey($name)) { throw "the written manifest lists $name twice" }
    $seen[$name] = $true
  }

  Copy-Item -LiteralPath $working -Destination $target -Force
  Write-Host "host-manifest: wrote $($sourceFiles.Count) libraries with $($sourceClasses.Count) classes to manifest resource 1 of $target, replacing $replaced and keeping $kept of its own library entries and everything else it declared"
} catch {
  $failed = $_.Exception.Message
} finally {
  if (Test-Path $scratch) { Remove-Item -Path $scratch -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($failed) {
  Write-Host "host-manifest: failed: $failed"
  exit 1
}
exit 0
