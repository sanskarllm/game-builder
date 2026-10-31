@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Stop-Game-Builder.ps1"
if errorlevel 1 pause
