# SAM 3D service (image → 3D for Game Forge)

One small FastAPI service, two Meta models:

| Kind | Model | What you get | Hardware |
|---|---|---|---|
| `body` | [SAM 3D Body](https://github.com/facebookresearch/sam-3d-body) (`facebook/sam-3d-body-dinov3`) | Posed human body mesh (Momentum Human Rig, untextured) from a photo or drawing of one person | Any recent NVIDIA GPU — roughly 3 GB VRAM for the model, a few more with the MoGe2 FOV estimator. Windows or Linux |
| `objects` | [SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects) (`facebook/sam-3d-objects`) | Textured mesh of any cut-out object | Linux + NVIDIA GPU with 32 GB+ VRAM (cloud GPU) |

Game Forge uses it from **3D Assets → From image · SAM 3D** and from the cube
button (**Make 3D**) on every character.

## SAM 3D Body on this PC (Windows, RTX 50-series OK)

Installed outside OneDrive in `C:\Users\aires\sam3d`:

```bash
git clone https://github.com/facebookresearch/sam-3d-body C:\Users\aires\sam3d\sam-3d-body
uv venv --python 3.11 C:\Users\aires\sam3d\.venv
# PyTorch for CUDA 12.8 (needed for RTX 50-series)
uv pip install --python C:\Users\aires\sam3d\.venv\Scripts\python.exe torch torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install --python C:\Users\aires\sam3d\.venv\Scripts\python.exe numpy opencv-python roma pytorch-lightning omegaconf yacs timm einops trimesh huggingface_hub braceexpand pillow scikit-image dill hydra-core pyrootutils loguru optree fvcore fastapi uvicorn python-multipart
uv pip install --python C:\Users\aires\sam3d\.venv\Scripts\python.exe "git+https://github.com/microsoft/MoGe.git"
```

Not needed: detectron2 (Game Forge passes the person's box itself), SAM3, pyrender.

Checkpoints are gated: request access at
https://huggingface.co/facebook/sam-3d-body-dinov3, then sign in once:

```bash
C:\Users\aires\sam3d\.venv\Scripts\hf.exe auth login
```

Start the service (downloads the 2.1 GB checkpoint on first run, then preloads it):

```bash
start-body.bat
```

It listens on `http://127.0.0.1:8000`, which Game Forge uses by default.
`GET /health` reports the GPU and VRAM in use.

Performance settings (in `start-body.bat`):
- `SAM3D_BODY_FOV=moge2` — MoGe2 estimates the camera field of view for more
  accurate proportions and pose (set it empty to skip).
- `SAM3D_PRELOAD=1` — load the model at startup so the first request is fast.
- TF32 tensor cores and cuDNN autotuning are always on.

## SAM 3D Objects on a cloud GPU (Linux, 32 GB+)

```bash
git clone https://github.com/facebookresearch/sam-3d-objects && cd sam-3d-objects
mamba env create -f environments/default.yml && mamba activate sam3d-objects
export PIP_EXTRA_INDEX_URL="https://pypi.ngc.nvidia.com https://download.pytorch.org/whl/cu121"
pip install -e '.[dev]' && pip install -e '.[p3d]'
export PIP_FIND_LINKS="https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.5.1_cu121.html"
pip install -e '.[inference]' && ./patching/hydra
pip install 'huggingface-hub[cli]<1.0' && hf auth login
hf download --repo-type model --local-dir checkpoints/hf-download --max-workers 1 facebook/sam-3d-objects
mv checkpoints/hf-download/checkpoints checkpoints/hf && rm -rf checkpoints/hf-download
pip install -r /path/to/game-forge/sam3d-service/requirements.txt
SAM3D_OBJECTS_REPO=$PWD SAM3D_TOKEN=pick-a-long-secret HOST=0.0.0.0 python /path/to/server.py
```

Then put the server's URL and token in Game Forge → **Meta AI** tab → **SAM 3D**.

## Test the wiring without a model

```bash
SAM3D_FAKE=1 python server.py
```

Every request gets a placeholder cube.

## API

- `GET /health` → `{ ok, mode, kinds, loaded, fov, gpu, vram_used_gb, vram_peak_gb }`
- `POST /reconstruct` (multipart): `image`, optional `mask` (white = subject),
  `kind` (`body` | `objects`), objects only: `seed`, `format` (`glb` | `ply`),
  `textured` (`1` bakes a texture). Returns `model/gltf-binary`, with `X-Pose`,
  `X-Seconds` and `X-VRAM` headers.
