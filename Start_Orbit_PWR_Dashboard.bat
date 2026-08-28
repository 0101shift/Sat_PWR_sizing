@echo off
setlocal
title ORBIT.PWR Local Dashboard
cd /d "%~dp0"

set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
if exist "%CODEX_NODE%\node.exe" set "PATH=%CODEX_NODE%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 22 or run this dashboard from the Codex desktop environment.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\vinext.CMD" (
  echo.
  echo First-time setup: downloading the dashboard packages...
  echo This requires an internet connection and may take a few minutes.
  echo.

  where npm.cmd >nul 2>nul
  if errorlevel 1 (
    echo npm was not found. A complete Node.js 22 installation is required
    echo for the automatic first-time package download.
    echo Download Node.js from https://nodejs.org/ and run this file again.
    pause
    exit /b 1
  )

  rem Use install rather than ci here because shared/extracted dashboard copies may
  rem contain a package-lock created before the latest package.json update. npm ci
  rem rejects that recoverable mismatch with EUSAGE; npm install reconciles the
  rem lockfile and still installs the requested dashboard dependencies.
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo The automatic package download failed.
    echo Check the internet connection and run this file again.
    pause
    exit /b 1
  )

  if not exist "node_modules\.bin\vinext.CMD" (
    echo.
    echo Package installation completed, but the dashboard launcher is missing.
    echo Run this file again or reinstall Node.js 22 if the issue continues.
    pause
    exit /b 1
  )

  echo.
  echo Dashboard packages installed successfully.
)

set "DASHBOARD_PORT=3000"

powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo The dashboard port 3000 is already active.
  echo Opening the existing local service instead of starting a second copy.
  if /I not "%~1"=="--no-browser" start "" "http://localhost:3000/"
  echo If this is not ORBIT.PWR, close the application using port 3000 and run this file again.
  exit /b 0
)

set "WRANGLER_LOG_PATH=.wrangler\wrangler.log"

if /I not "%~1"=="--no-browser" start "" "http://localhost:%DASHBOARD_PORT%/"
echo.
echo Starting the live local development server...
echo Main dashboard:  http://localhost:%DASHBOARD_PORT%/
echo EO inventory:    http://localhost:%DASHBOARD_PORT%/satellite-inventory
echo Integration lab: http://localhost:%DASHBOARD_PORT%/satellite-integration-lab
echo Keep this window open. Press Ctrl+C to stop the dashboard.
echo.
call "node_modules\.bin\vinext.CMD" dev --port %DASHBOARD_PORT%

endlocal
