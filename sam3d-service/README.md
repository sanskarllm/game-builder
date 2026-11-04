# SAM 3D service (image → 3D for Game Forge)

One small FastAPI service, two Meta models:

| Kind | Model | What you get | Hardware |
|---|---|---|---|
| `body` | [SAM 3D Body](https://github.com/facebookresearch/sam-3d-body) (`facebook/sam-3d-body-dinov3`) | Posed human body mesh (Momentum Human Rig, untextured) from a photo or drawing of one person | Any recent NVIDIA GPU — roughly 3 GB VRAM for the model, a few more with the MoGe2 FOV estimator. Windows or Linux |
| `objects` | [SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects) (`facebook/sam-3d-objects`) | Textured mesh of any cut-out object | Linux + NVIDIA GPU with 32 GB+ VRAM (cloud GPU) |

Game Forge uses it from **3D Assets → From image · SAM 3D** and from the cube
button (**Make 3D**) on every character.

## SAM 3D Body on Windows (one click, RTX 50-series OK)

Meta's SAM 3D Body code is bundled in [`sam-3d-body/`](sam-3d-body/) under the
SAM License (see its `LICENSE` and `NOTICE.md`). Only the model weights are
downloaded, from Hugging Face.

1. Request access to the weights at https://huggingface.co/facebook/sam-3d-body-dinov3
2. Double-click **`install-body.bat`**. It checks for an NVIDIA GPU and git,
   installs `uv` if needed, creates a Python 3.11 environment in
   `%USERPROFILE%\sam3d\.venv` (outside OneDrive and this repo), installs
   PyTorch for CUDA 12.8 and [`requirements-body.txt`](requirements-body.txt),
   asks you to sign in to Hugging Face once, and downloads the 2.7 GB checkpoint.
3. Double-click **`start-body.bat`**. The model loads and warms up in about a
   minute ("Model ready"). On first start PyTorch also fetches the DINOv3
   backbone code from GitHub.

Not needed: detectron2 (Game Forge passes the person's box itself), SAM3, pyrender.

It listens on `http://127.0.0.1:8000`, which Game Forge uses by default.
`GET /health` reports the GPU and VRAM in use.

Performance settings (in `start-body.bat`):
- `SAM3D_BODY_FOV=moge2` — MoGe2 estimates the camera field of view for more
  accurate proportions and pose (set it empty to skip).
- `SAM3D_PRELOAD=1` — load the model and run one warm-up pass at startup so
  the first request is fast.
- TF32 tensor cores are on. cuDNN autotuning is off by default because it
  re-tunes for every new image size (5–8 s each); set `SAM3D_CUDNN_BENCHMARK=1`
  if all your images are the same size.

Measured on an RTX 5070 (12 GB): about **0.7–0.8 s per image** at any size,
**4.5 GB VRAM** at rest and **7.2 GB peak**, mesh of 18,439 vertices.

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
