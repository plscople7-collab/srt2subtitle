@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo 音声認識を使う場合だけ実行してください。
echo Python 3.12 とインターネット接続が必要です。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; py -3.12 --version; py -3.12 -m pip install --upgrade pip; py -3.12 -m pip install --upgrade openai-whisper imageio-ffmpeg; py -3.12 -c \"import whisper, imageio_ffmpeg; print('openai-whisper OK'); print(imageio_ffmpeg.get_ffmpeg_exe())\""
echo.
echo 完了しました。初回の文字起こし時にWhisperモデルのダウンロードが入ります。
pause
