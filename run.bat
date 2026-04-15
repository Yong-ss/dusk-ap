@echo off
title Dusk - Dev Mode
cd /d "%~dp0"

echo =============================
echo   Dusk - Disk Space Analyzer
echo =============================
echo.

:: Check node_modules
if not exist "node_modules\" (
    echo [1/2] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo ERROR: npm install failed.
        pause
        exit /b 1
    )
) else (
    echo [1/2] Dependencies OK.
)

echo [2/2] Starting Tauri dev server...
echo.
call npm run tauri dev

if errorlevel 1 (
    echo.
    echo ERROR: Tauri dev failed. Make sure Rust is installed.
    pause
)
