@echo off
rem Starts the SAM 3D Body service for Game Forge on http://127.0.0.1:8000
rem (installed in C:\Users\aires\sam3d, outside OneDrive).
set SAM3D_BODY_REPO=C:\Users\aires\sam3d\sam-3d-body
set SAM3D_BODY_HF=facebook/sam-3d-body-dinov3
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
rem Plain HTTP downloads: the hf_xet helper can fail when Windows is low on commit memory.
set HF_HUB_DISABLE_XET=1
rem Max performance: MoGe2 camera-FOV estimator on, models preloaded at start.
set SAM3D_BODY_FOV=moge2
set SAM3D_PRELOAD=1
"C:\Users\aires\sam3d\.venv\Scripts\python.exe" "%~dp0server.py"
pause
