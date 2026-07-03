@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale o Node.js e tente novamente.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing http://localhost:5173/api/health -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
if not errorlevel 1 (
  start "" "http://localhost:5173"
  echo Sistema ja esta em execucao em http://localhost:5173
  pause
  exit /b 0
)

start "" "http://localhost:5173"
node server.js

echo.
echo O servidor foi encerrado.
pause
