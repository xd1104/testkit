@echo off
title testkit local runner
cd /d "%~dp0"
echo ============================================
echo   Local Test Tool is starting...
echo   A browser will open at http://localhost:4600
echo   To STOP: just close this window.
echo ============================================
echo.
where node >nul 2>nul || (echo [ERROR] Node.js not found in PATH. & pause & exit /b)
start "" /min cmd /c "timeout /t 4 >nul & explorer http://localhost:4600"
node local.js
echo.
echo Server stopped. Press any key to close this window.
pause >nul
