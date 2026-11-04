@echo off
setlocal
rem Starts the SAM 3D Body service for Game Forge on http://127.0.0.1:8000
rem Run install-body.bat once first.

set "PY=%USERPROFILE%\sam3d\.venv\Scripts\python.exe"
if not exist "%PY%" (echo SAM 3D Body is not installed yet - run install-body.bat first. & pause & exit /b 1)

rem Meta's SAM 3D Body code is bundled next to this file.
set "SAM3D_BODY_REPO=%~dp0sam-3d-body"
set SAM3D_BODY_HF=facebook/sam-3d-body-dinov3
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
rem Plain HTTP downloads: the hf_xet helper can fail when Windows is low on commit memory.
set HF_HUB_DISABLE_XET=1
rem Max performance: MoGe2 camera-FOV estimator on, model preloaded and warmed up at start.
set SAM3D_BODY_FOV=moge2
set SAM3D_PRELOAD=1

"%PY%" "%~dp0server.py"
pause
