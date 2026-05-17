param(
  [string]$PythonLauncher = "py",
  [string]$PythonVersion = "-3.12"
)

$ErrorActionPreference = "Stop"

function Invoke-Step {
  param([scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

Write-Host "Python runtime:"
Invoke-Step { & $PythonLauncher $PythonVersion --version }

Write-Host "Dependency check:"
Invoke-Step { & $PythonLauncher $PythonVersion -c "import whisper; print('openai-whisper OK')" }
Invoke-Step { & $PythonLauncher $PythonVersion -c "import imageio_ffmpeg; print('imageio-ffmpeg OK'); print(imageio_ffmpeg.get_ffmpeg_exe())" }
