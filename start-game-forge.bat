@echo off
setlocal
rem Starts Game Forge on http://localhost:5173 and opens it in your browser.
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
cd /d "%~dp0"
set OPEN_BROWSER=1
node server.js
pause
