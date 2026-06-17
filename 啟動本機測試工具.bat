@echo off
chcp 65001 >nul
title 本機測試工具 (testkit local runner)
cd /d "%~dp0"
echo ============================================
echo   本機測試工具 啟動中...
echo   稍候會自動開啟瀏覽器 (http://localhost:4600)
echo   要關閉：直接關掉這個視窗即可
echo ============================================
echo.
rem 背景等 4 秒讓伺服器起來，再開預設瀏覽器
start "" /min cmd /c "timeout /t 4 >nul & explorer http://localhost:4600"
node local.js
echo.
echo 測試工具已停止。按任意鍵關閉視窗。
pause >nul
