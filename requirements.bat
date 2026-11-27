@echo off
setlocal enabledelayedexpansion
title cinnamon-print - requirements installer
REM Installs the build prerequisites via winget: GNU Make and Docker Desktop.
REM Run once; re-running is safe (already-installed items are skipped).

set "WINGET_ARGS=-e --accept-package-agreements --accept-source-agreements --silent"

echo ============================================
echo  cinnamon-print - installing requirements
echo ============================================
echo.

where winget >nul 2>nul
if errorlevel 1 (
    echo [ERROR] winget not found.
    echo         winget ships with Windows 10 1709+ / Windows 11 - install "App Installer"
    echo         from the Microsoft Store, then re-run this script.
    goto :fail
)

REM ---- GNU Make -----------------------------------------------------------
echo [1/2] Checking GNU Make...
where make >nul 2>nul
if not errorlevel 1 (
    echo       make already installed - skipping.
) else (
    echo       installing GNU Make via winget...
    winget install --id GnuWin32.Make %WINGET_ARGS%
    if errorlevel 1 (
        echo       [WARN] GnuWin32.Make failed - trying ezwinports.make...
        winget install --id ezwinports.make %WINGET_ARGS%
        if errorlevel 1 (
            echo       [ERROR] could not install make automatically.
            goto :fail
        )
    )
    echo       make installed. NOTE: open a NEW terminal so PATH refreshes.
)

REM ---- Docker Desktop ------------------------------------------------------
echo [2/2] Checking Docker Desktop...
where docker >nul 2>nul
if not errorlevel 1 (
    echo       docker already installed - skipping.
) else (
    echo       installing Docker Desktop via winget...
    winget install --id Docker.DockerDesktop %WINGET_ARGS%
    if errorlevel 1 (
        echo       [ERROR] could not install Docker Desktop automatically.
        echo               install it manually: https://docs.docker.com/desktop/setup/install/windows-install/
        goto :fail
    )
    echo       Docker Desktop installed - launch it once from the Start Menu
    echo       and complete its first-run setup (WSL2 backend) if prompted.
)

echo.
echo ============================================
echo  done. next step: double-click run.bat
echo  ^(or run it from a NEW terminal^)
echo ============================================
pause
exit /b 0

:fail
echo.
echo [FAILED] fix the errors above and re-run requirements.bat
pause
exit /b 1
