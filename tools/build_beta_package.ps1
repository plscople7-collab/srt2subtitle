param(
  [string]$Version = "beta",
  [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DistRoot = Join-Path $Root $OutputDir
$PackageName = "srt2subtitle-$Version"
$Stage = Join-Path $DistRoot "$PackageName.package"
$ZipPath = Join-Path $DistRoot "$PackageName.zip"
$SelfExtractLabel = -join ([char[]](0x81EA, 0x5DF1, 0x89E3, 0x51CD))
$ReadmeName = (-join ([char[]](0x306F, 0x3058, 0x3081, 0x306B, 0x8AAD, 0x3093, 0x3067, 0x304F, 0x3060, 0x3055, 0x3044))) + ".txt"
$StartName = (-join ([char[]](0x8D77, 0x52D5))) + ".bat"
$StopName = (-join ([char[]](0x505C, 0x6B62))) + ".bat"
$WhisperSetupName = (-join ([char[]](0x97F3, 0x58F0, 0x8A8D, 0x8B58, 0x005F, 0x521D, 0x56DE, 0x30BB, 0x30C3, 0x30C8, 0x30A2, 0x30C3, 0x30D7))) + ".bat"
$SelfExtractPath = Join-Path $DistRoot "$PackageName-$SelfExtractLabel.bat"

function Copy-ItemStrict {
  param(
    [string]$Source,
    [string]$Destination
  )
  if (-not (Test-Path $Source)) {
    throw "Missing source: $Source"
  }
  $item = Get-Item -LiteralPath $Source
  if ($item.PSIsContainer) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    $result = & robocopy $Source $Destination /E /XD __pycache__ .pytest_cache /XF *.pyc *.pyo /NFL /NDL /NJH /NJS /NC /NS
    if ($LASTEXITCODE -gt 7) {
      throw "robocopy failed: $Source -> $Destination"
    }
    return
  }
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function New-CleanDirectory {
  param([string]$Path)
  if (Test-Path $Path) {
    try {
      Remove-Item -LiteralPath $Path -Recurse -Force
    } catch {
      $Path = Join-Path $DistRoot "$PackageName.package.$([DateTime]::Now.ToString('yyyyMMddHHmmss'))"
    }
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  return $Path
}

New-Item -ItemType Directory -Force -Path $DistRoot | Out-Null
$Stage = New-CleanDirectory $Stage

Copy-ItemStrict (Join-Path $Root "backend") (Join-Path $Stage "backend")
Copy-ItemStrict (Join-Path $Root "frontend") (Join-Path $Stage "frontend")
Copy-ItemStrict (Join-Path $Root "samples") (Join-Path $Stage "samples")
Copy-ItemStrict (Join-Path $Root "docs") (Join-Path $Stage "docs")
Copy-ItemStrict (Join-Path $Root "LICENSE") (Join-Path $Stage "LICENSE")
Copy-ItemStrict (Join-Path $Root "README.md") (Join-Path $Stage "README_DEV.md")

Copy-ItemStrict (Join-Path $Root "tools\beta\START_HERE.txt") (Join-Path $Stage $ReadmeName)
Copy-ItemStrict (Join-Path $Root "tools\beta\START.bat") (Join-Path $Stage $StartName)
Copy-ItemStrict (Join-Path $Root "tools\beta\STOP.bat") (Join-Path $Stage $StopName)
Copy-ItemStrict (Join-Path $Root "tools\beta\SETUP_WHISPER.bat") (Join-Path $Stage $WhisperSetupName)

New-Item -ItemType Directory -Force -Path (Join-Path $Stage "data\v2"), (Join-Path $Stage "data\transcriber_cache"), (Join-Path $Stage ".tmp") | Out-Null

Get-ChildItem -LiteralPath $Stage -Recurse -Directory -Force |
  Where-Object { $_.Name -in @("__pycache__", ".pytest_cache") } |
  Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $Stage -Recurse -File -Force |
  Where-Object { $_.Extension -in @(".pyc", ".pyo") } |
  Remove-Item -Force

if (Test-Path $ZipPath) {
  try {
    Remove-Item -LiteralPath $ZipPath -Force
  } catch {
    $suffix = [DateTime]::Now.ToString("yyyyMMddHHmmss")
    $ZipPath = Join-Path $DistRoot "$PackageName.$suffix.zip"
    $SelfExtractPath = Join-Path $DistRoot "$PackageName.$suffix.$SelfExtractLabel.bat"
  }
}
Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $ZipPath -Force

$zipBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ZipPath))
$base64Lines = ($zipBytes -split "(.{1,76})" | Where-Object { $_ })
$ExtractedMessage = -join ([char[]](0x5C55, 0x958B, 0x3057, 0x307E, 0x3057, 0x305F))
$openStartMessage = (-join ([char[]](0x958B, 0x3044, 0x305F, 0x30D5, 0x30A9, 0x30EB, 0x30C0, 0x306E, 0x0020))) + $StartName + (-join ([char[]](0x0020, 0x3092, 0x30C0, 0x30D6, 0x30EB, 0x30AF, 0x30EA, 0x30C3, 0x30AF, 0x3057, 0x3066, 0x304F, 0x3060, 0x3055, 0x3044)))
$extractorLines = @(
  "@echo off",
  "chcp 65001 >nul",
  "setlocal",
  "cd /d ""%~dp0""",
  "set ""APPDIR=%~dp0$PackageName""",
  "set ""ZIPFILE=%TEMP%\$PackageName.zip""",
  "set ""B64FILE=%TEMP%\$PackageName.b64""",
  "powershell -NoProfile -ExecutionPolicy Bypass -Command ""if(Test-Path '%APPDIR%'){ Remove-Item -LiteralPath '%APPDIR%' -Recurse -Force }; New-Item -ItemType Directory -Force -Path '%APPDIR%' | Out-Null""",
  "break > ""%B64FILE%""",
  "for /f ""tokens=1,* delims=:"" %%A in ('findstr /n ""^__ZIPDATA__"" ""%~f0""') do set DATA_LINE=%%A",
  "more +%DATA_LINE% ""%~f0"" > ""%B64FILE%""",
  "certutil -f -decode ""%B64FILE%"" ""%ZIPFILE%"" >nul",
  "powershell -NoProfile -ExecutionPolicy Bypass -Command ""Expand-Archive -LiteralPath '%ZIPFILE%' -DestinationPath '%APPDIR%' -Force""",
  "echo ${ExtractedMessage}: %APPDIR%",
  "echo $openStartMessage",
  "explorer ""%APPDIR%""",
  "pause",
  "exit /b",
  "__ZIPDATA__"
)
$extractor = ($extractorLines + $base64Lines) -join "`r`n"
[IO.File]::WriteAllText($SelfExtractPath, $extractor, [Text.UTF8Encoding]::new($false))

Write-Host "Package directory: $Stage"
Write-Host "ZIP: $ZipPath"
Write-Host "Self extractor BAT: $SelfExtractPath"
