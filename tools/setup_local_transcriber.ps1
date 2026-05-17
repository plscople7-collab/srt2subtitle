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

Write-Host "Installing local transcriber dependencies into the Python 3.12 user site-packages"
Invoke-Step { & $PythonLauncher $PythonVersion -m pip install --upgrade pip }
Invoke-Step { & $PythonLauncher $PythonVersion -m pip install --upgrade openai-whisper imageio-ffmpeg }

Write-Host "Checking imports"
Invoke-Step { & $PythonLauncher $PythonVersion -c "import whisper, imageio_ffmpeg; print('whisper OK'); print(imageio_ffmpeg.get_ffmpeg_exe())" }

Write-Host "Done."
