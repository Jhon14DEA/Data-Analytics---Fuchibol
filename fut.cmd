@echo off
setlocal
cd /d "%~dp0"
set "FUT_NODE_DIR=%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.22_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v22.23.2-win-x64"
if exist "%FUT_NODE_DIR%\node.exe" set "PATH=%FUT_NODE_DIR%;%PATH%"
node -e "if (process.versions.node.split('.')[0] !== '22') process.exit(1)" >nul 2>&1
if errorlevel 1 (
  echo FUT necesita Node.js 22. Instala OpenJS.NodeJS.22 o activa Node 22 antes de continuar.
  exit /b 1
)
if "%~1"=="build" goto run
if "%~1"=="dev" goto run
if "%~1"=="start" goto run
if "%~1"=="test:training" goto build
if "%~1"=="test:training:db" goto run
if "%~1"=="prisma:deploy" goto run
if "%~1"=="prisma:generate" goto build
if "%~1"=="prisma:validate" goto build
if "%~1"=="dataset:status" goto run
if "%~1"=="historical:backfill" goto run
if "%~1"=="historical:epl-backfill" goto run
echo Uso: fut.cmd build ^| dev ^| start ^| prisma:deploy ^| prisma:generate ^| prisma:validate ^| test:training ^| test:training:db ^| dataset:status
exit /b 1

:run
docker compose up -d --wait postgres
if errorlevel 1 exit /b 1
if "%~1"=="build" goto build
if "%~1"=="test:training:db" goto build
if "%~1"=="prisma:deploy" goto build
if "%~1"=="dataset:status" goto build
if "%~1"=="historical:backfill" goto build
if "%~1"=="historical:epl-backfill" goto build
call npm.cmd run %* -- --hostname 127.0.0.1
exit /b %errorlevel%

:build
call npm.cmd run %*
exit /b %errorlevel%
