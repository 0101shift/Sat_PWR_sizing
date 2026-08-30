@echo off
setlocal EnableExtensions
title ORBIT.PWR Local Dashboard
cd /d "%~dp0"

set "NODE_VERSION=24.20.0"
set "NODE_ARCH=x64"
if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NODE_ARCH=arm64"
if /I "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "NODE_ARCH=arm64"

if /I "%PROCESSOR_ARCHITECTURE%"=="x86" if "%PROCESSOR_ARCHITEW6432%"=="" (
  echo ORBIT.PWR requires 64-bit Windows.
  pause
  exit /b 1
)

set "NODE_DIST=node-v%NODE_VERSION%-win-%NODE_ARCH%"
set "LOCAL_RUNTIME_ROOT=%CD%\.orbit-pwr-runtime"
set "LOCAL_NODE_DIR=%LOCAL_RUNTIME_ROOT%\%NODE_DIST%"
set "NODE_ZIP=%LOCAL_RUNTIME_ROOT%\%NODE_DIST%.zip"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/%NODE_DIST%.zip"
set "NODE_SHA256=6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba"
if /I "%NODE_ARCH%"=="arm64" set "NODE_SHA256=31c6799744de8a54601643098040c68c3697e56c94e407d61d0e5fa5f34191d7"

rem Reuse a compatible complete system installation when one is available.
set "SYSTEM_NODE_READY="
where node >nul 2>nul
if not errorlevel 1 (
  node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(Math.max(0, Math.sign(22013 - (major * 1000 + minor))))" >nul 2>nul
  if not errorlevel 1 (
    where npm.cmd >nul 2>nul
    if not errorlevel 1 set "SYSTEM_NODE_READY=1"
  )
)
if defined SYSTEM_NODE_READY goto node_ready

rem Otherwise use, or automatically install, the project-private portable runtime.
if exist "%LOCAL_NODE_DIR%\node.exe" if exist "%LOCAL_NODE_DIR%\npm.cmd" (
  set "PATH=%LOCAL_NODE_DIR%;%PATH%"
  goto node_ready
)

echo.
echo Node.js is not installed, is too old, or does not include npm.
echo Downloading the private ORBIT.PWR Node.js %NODE_VERSION% LTS runtime...
echo This is a one-time download from nodejs.org and needs no administrator access.
echo.

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; New-Item -ItemType Directory -Force -Path $env:LOCAL_RUNTIME_ROOT | Out-Null; Invoke-WebRequest -Uri $env:NODE_URL -OutFile $env:NODE_ZIP; $sha=[System.Security.Cryptography.SHA256]::Create(); $stream=[System.IO.File]::OpenRead($env:NODE_ZIP); try { $actual=([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose(); $sha.Dispose() }; if ($actual -ne $env:NODE_SHA256) { throw ('Node.js download integrity check failed. Expected ' + $env:NODE_SHA256 + ', received ' + $actual) }; Expand-Archive -LiteralPath $env:NODE_ZIP -DestinationPath $env:LOCAL_RUNTIME_ROOT -Force; Remove-Item -LiteralPath $env:NODE_ZIP -Force"
if errorlevel 1 (
  echo.
  echo The automatic Node.js download failed.
  echo Check the internet connection and run this file again.
  pause
  exit /b 1
)

if not exist "%LOCAL_NODE_DIR%\node.exe" (
  echo.
  echo Node.js downloaded, but the portable runtime could not be prepared.
  echo Run this file again. If the issue continues, check antivirus permissions.
  pause
  exit /b 1
)

set "PATH=%LOCAL_NODE_DIR%;%PATH%"

:node_ready
for /f "delims=" %%V in ('node --version') do set "ACTIVE_NODE_VERSION=%%V"
echo Using Node.js %ACTIVE_NODE_VERSION%.

where node >nul 2>nul
if errorlevel 1 (
  echo The ORBIT.PWR Node.js runtime could not be started.
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
    echo npm was not found in the active Node.js runtime.
    echo Run this file again to repair the private runtime.
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

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
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
echo Keep this window open. Press Ctrl+C to stop the dashboard.
echo.
call "node_modules\.bin\vinext.CMD" dev --port %DASHBOARD_PORT%

endlocal
