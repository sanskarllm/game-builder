@echo off
setlocal
rem One-click installer for Game Forge's SAM 3D Body service.
rem Needs: Windows, an NVIDIA GPU with a recent driver, internet, and git.
rem Installs into %USERPROFILE%\sam3d\.venv, outside OneDrive and this repo.

set "ENV=%USERPROFILE%\sam3d\.venv"
set "HERE=%~dp0"
echo == Game Forge: SAM 3D Body installer ==
echo.

where nvidia-smi >nul 2>nul || (echo [!] No NVIDIA driver found. SAM 3D Body needs an NVIDIA GPU. & goto fail)
where git >nul 2>nul || (echo [!] git is not installed. Get it from https://git-scm.com and run this again. & goto fail)

where uv >nul 2>nul
if errorlevel 1 (
  echo Installing uv, the Python manager from Astral...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex" || goto fail
  set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)

if not exist "%ENV%\Scripts\python.exe" (
  echo Creating a Python 3.11 environment in %ENV%...
  uv venv --python 3.11 "%ENV%" || goto fail
)

echo Installing PyTorch for CUDA 12.8 - about 3 GB the first time...
uv pip install --python "%ENV%\Scripts\python.exe" torch torchvision --index-url https://download.pytorch.org/whl/cu128 || goto fail

echo Installing SAM 3D Body dependencies...
uv pip install --python "%ENV%\Scripts\python.exe" -r "%HERE%requirements-body.txt" || goto fail

echo Checking the GPU...
"%ENV%\Scripts\python.exe" -c "import torch; assert torch.cuda.is_available(), 'PyTorch cannot see a CUDA GPU'; print('GPU OK:', torch.cuda.get_device_name(0))" || goto fail

"%ENV%\Scripts\hf.exe" auth whoami >nul 2>nul
if errorlevel 1 (
  echo.
  echo Sign in to Hugging Face. First request access at:
  echo   https://huggingface.co/facebook/sam-3d-body-dinov3
  "%ENV%\Scripts\hf.exe" auth login || goto fail
)

echo Downloading the SAM 3D Body checkpoint - 2.7 GB the first time...
set HF_HUB_DISABLE_XET=1
"%ENV%\Scripts\hf.exe" download facebook/sam-3d-body-dinov3 >nul || goto fail

echo.
echo All set. Start the service with start-body.bat
pause
exit /b 0

:fail
echo.
echo Install stopped - see the message above.
pause
exit /b 1
