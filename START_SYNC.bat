@echo off
title KINTSUGI NITRO SYNC
color 0b
echo ==========================================
echo   MEMULAI KINTSUGI NITRO SYNC...
echo ==========================================

:: Cek apakah Node.js terinstall
node -v >nul 2>&1
if %errorlevel% neq 0 (
    color 0c
    echo [ERROR] Node.js belum terinstall!
    echo Silakan download dan install dari: https://nodejs.org/
    echo.
    pause
    exit
)

:: Jalankan Script JS Baru (Async Version)
node kintsugi_async.js

pause