@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=8002; $lines=netstat -ano | Select-String \":$port\" | Select-String 'LISTENING'; if(-not $lines){ Write-Host '起動中のアプリはありません。'; exit 0 }; foreach($line in $lines){ $pidText=($line.ToString().Trim() -split '\s+')[-1]; if($pidText -match '^\d+$'){ Stop-Process -Id ([int]$pidText) -Force; Write-Host \"停止しました。\" } }"
pause
