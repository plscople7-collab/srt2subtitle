$ErrorActionPreference = "Stop"
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $AppRoot

function Invoke-Step {
  param([scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

Write-Host "Checking Python 3.12."
Invoke-Step { py -3.12 --version }

Write-Host "Installing Whisper and ffmpeg runtime."
Invoke-Step { py -3.12 -m pip install --upgrade pip }
Invoke-Step { py -3.12 -m pip install --upgrade openai-whisper imageio-ffmpeg }

Write-Host "Checking imports."
Invoke-Step { py -3.12 -c "import whisper, imageio_ffmpeg; print('openai-whisper OK'); print(imageio_ffmpeg.get_ffmpeg_exe())" }

Write-Host ""
Write-Host "Done. Whisper downloads the selected model on first transcription."
