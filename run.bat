@echo off
setlocal enabledelayedexpansion
title cinnamon-print - repl
REM Launches an agentic composition session inside the nix container
REM (the Windows equivalent of the Makefile's `make repl`), and tears the
REM container down when the session ends.

cd /d "%~dp0"
REM Full repo path without a trailing backslash (safe for docker -v).
for %%I in ("%~dp0.") do set "REPO=%%~fI"

echo ============================================
echo  cinnamon-print - agentic repl (docker)
echo ============================================
echo.

REM ---- prerequisites -------------------------------------------------------
where docker >nul 2>nul
if errorlevel 1 (
    echo [ERROR] docker not found. run requirements.bat first, then re-open
    echo         this file ^(or install Docker Desktop manually^).
    goto :fail
)

REM If the engine is not running, try to start Docker Desktop and wait.
docker info >nul 2>nul
if errorlevel 1 (
    echo docker engine not running - starting Docker Desktop...
    if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
        start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    ) else (
        echo [ERROR] docker installed but the engine is unreachable and
        echo         Docker Desktop.exe was not found in its default location.
        goto :fail
    )
    set /a tries=0
    :waitengine
    timeout /t 3 /nobreak >nul
    docker info >nul 2>nul
    if errorlevel 1 (
        set /a tries+=1
        if !tries! lss 20 (
            echo   waiting for the docker engine... !tries!/20
            goto :waitengine
        )
        echo [ERROR] docker engine did not come up in time - start Docker
        echo         Desktop manually, wait for it to settle, re-run run.bat
        goto :fail
    )
)
echo docker engine is up.

where make >nul 2>nul
if errorlevel 1 (
    echo [WARN] make not found - falling back to the direct docker commands
    echo        ^(run requirements.bat to install GNU Make^).
    goto :fallback
)

REM ---- primary path: make repl --------------------------------------------
REM `make repl` builds the image on first run (stamped in .image-built), then
REM runs the interactive container. The container removes itself on exit
REM (--rm) - that is the teardown.
echo.
echo starting repl session via make ^(first run builds the nix image - be patient^)...
make repl
if errorlevel 1 (
    echo.
    echo [WARN] make repl failed - trying the direct docker commands...
    goto :fallback
)
goto :teardown

REM ---- fallback: same commands, no make ------------------------------------
:fallback
echo.
echo building the image ^(first run downloads nix - this takes a while^)...
docker build -t cinnamon-print .
if errorlevel 1 (
    echo [ERROR] image build failed - see the output above.
    goto :fail
)
docker run --rm -it --init -v "%REPO%":/work -w /work -p 8899:8899 cinnamon-print bash -c "node ./scripts/serve.mjs & server=$!; opencode; rc=$?; kill $server 2>/dev/null; exit $rc"

REM ---- teardown ------------------------------------------------------------
:teardown
echo.
echo session ended - tearing down...
REM --rm already removed the session container; sweep any stragglers from
REM earlier crashed runs so nothing lingers.
for /f "tokens=*" %%c in ('docker ps -a --filter "ancestor=cinnamon-print" --format "{{.ID}}" 2^>nul') do (
    echo   removing leftover container %%c
    docker rm -f %%c >nul 2>nul
)
echo container torn down. preview artifacts live in project\output\.
echo.
pause
exit /b 0

:fail
echo.
echo [FAILED] fix the errors above and re-run run.bat
pause
exit /b 1
