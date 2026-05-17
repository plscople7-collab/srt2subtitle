param(
  [int]$Port = 8002
)

$ErrorActionPreference = "SilentlyContinue"
$lines = netstat -ano | Select-String ":$Port" | Select-String "LISTENING"
if (-not $lines) {
  Write-Host "No running srt2subtitle server was found."
  exit 0
}

foreach ($line in $lines) {
  $pidText = ($line.ToString().Trim() -split "\s+")[-1]
  if ($pidText -match "^\d+$") {
    Stop-Process -Id ([int]$pidText) -Force
    Write-Host "Stopped: PID $pidText"
  }
}
