@echo off
setlocal

set "ROOT=%~dp0"

echo Starting VolleyOps...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Please install Node.js 20.x and try again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found on PATH. Please reinstall Node.js 20.x and try again.
  pause
  exit /b 1
)

if not exist "%ROOT%backend\node_modules" (
  echo Installing backend dependencies...
  pushd "%ROOT%backend"
  call npm install
  if errorlevel 1 (
    popd
    echo Backend dependency installation failed.
    pause
    exit /b 1
  )
  popd
)

if not exist "%ROOT%frontend\node_modules" (
  echo Installing frontend dependencies...
  pushd "%ROOT%frontend"
  call npm install
  if errorlevel 1 (
    popd
    echo Frontend dependency installation failed.
    pause
    exit /b 1
  )
  popd
)

echo Starting backend on port 3001...
start "VolleyOps Backend" cmd /k "cd /d ""%ROOT%backend"" && npm start"

timeout /t 2 /nobreak >nul

echo Starting frontend on port 3000...
start "VolleyOps Frontend" cmd /k "cd /d ""%ROOT%frontend"" && npm run dev"

echo.
echo VolleyOps is starting up!
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:3001
echo.
echo Default admin account:
echo   Email:    admin@volleyops.com
echo   Password: Admin123!
echo.
pause
