@echo off
rem Game Radar launcher: starts the local server and opens the dashboard.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20+ is required: https://nodejs.org & pause & exit /b 1)
start "" "http://localhost:4173"
node src\server.mjs
pause
