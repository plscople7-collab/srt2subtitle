param(
  [int]$Port = 8002
)

$ErrorActionPreference = "Stop"
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $AppRoot
$env:PYTHONUTF8 = "1"

function Get-PythonCommand {
  $candidates = @(
    @{ File = "py"; Args = @("-3.12") },
    @{ File = "py"; Args = @("-3") },
    @{ File = "python"; Args = @() }
  )
  foreach ($candidate in $candidates) {
    try {
      & $candidate.File @($candidate.Args + @("--version")) *> $null
      if ($LASTEXITCODE -eq 0) {
        return $candidate
      }
    } catch {
      continue
    }
  }
  throw "Python was not found. Install Python 3.12."
}

function Test-PortOpen {
  param([int]$TargetPort)
  $client = New-Object Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect("127.0.0.1", $TargetPort, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(300, $false)) {
      return $false
    }
    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

$python = Get-PythonCommand
New-Item -ItemType Directory -Force -Path "data", ".tmp" | Out-Null

if (-not (Test-PortOpen -TargetPort $Port)) {
  Write-Host "Starting srt2subtitle beta: http://127.0.0.1:$Port/"
  Start-Process -FilePath $python.File -ArgumentList @($python.Args + @("-m", "backend.main", "--port", "$Port")) -WorkingDirectory $AppRoot -WindowStyle Hidden
  Start-Sleep -Seconds 2
} else {
  Write-Host "Already running: http://127.0.0.1:$Port/"
}

Start-Process "http://127.0.0.1:$Port/"
Write-Host ""
Write-Host "The local server keeps running after the browser is closed. Run stop_srt2subtitle.bat to stop it."
