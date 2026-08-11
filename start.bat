@echo off
title Excelarated Launcher
color 0B

echo.
echo  ======================================================
echo         EXCELARATED - AI Excel Assistant
echo  ======================================================
echo.
echo   All processing runs 100%% locally in your browser.
echo   No server backend or software installation required!
echo.

:: Kill anything on port 8000 already running
for /f "tokens=5" %%a in ('netstat -aon ^| find ":8000" ^| find "LISTENING" 2^>nul') do taskkill /F /PID %%a >nul 2>&1

echo Starting local web viewer on port 8000...
echo.

:: Open browser automatically
start http://localhost:8000

:: Start python built-in server on port 8000 serving the built frontend dist directory
python -m http.server 8000 --directory frontend/dist
