@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $root=(Get-Location).Path; $port=8002; $env:PYTHONUTF8='1'; function Test-Port($p){ $c=New-Object Net.Sockets.TcpClient; try { $r=$c.BeginConnect('127.0.0.1',$p,$null,$null); if(-not $r.AsyncWaitHandle.WaitOne(300,$false)){ return $false }; $c.EndConnect($r); return $true } catch { return $false } finally { $c.Close() } }; function Py(){ foreach($x in @(@('py','-3.12'),@('py','-3'),@('python',''))){ try { if($x[1]){ & $x[0] $x[1] --version *> $null } else { & $x[0] --version *> $null }; if($LASTEXITCODE -eq 0){ return $x } } catch {} }; throw 'Python was not found. Install Python 3.12.' }; New-Item -ItemType Directory -Force -Path 'data','.tmp' | Out-Null; if(-not (Test-Port $port)){ $p=Py; if($p[1]){ Start-Process -FilePath $p[0] -ArgumentList @($p[1],'-m','backend.main','--port',\"$port\") -WorkingDirectory $root -WindowStyle Hidden } else { Start-Process -FilePath $p[0] -ArgumentList @('-m','backend.main','--port',\"$port\") -WorkingDirectory $root -WindowStyle Hidden }; Start-Sleep -Seconds 2 }; Start-Process \"http://127.0.0.1:$port/\""
echo 起動しました。ブラウザが開かない場合は http://127.0.0.1:8002/ を開いてください。
pause
