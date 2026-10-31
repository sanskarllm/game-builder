# Local SAM setup — experimental RTX 5070 profile

Prepared 31 October 2026. This is a source/worker preparation, not a verified working 3D installation.

## SAM 3D Body — separate human-character route

Game Builder has a separate Body adapter and Settings fields. It directly loads a local Body checkpoint plus MHR model, uses one full-frame human design, and skips the optional detector, segmentor and FOV models. It uses the body decoder (no extra hand refinement) and exports an untextured body GLB. It does not export clothing, hair, an animation rig or a textured likeness. Use one full-body human image, not a group or a creature.

Official source: https://github.com/facebookresearch/sam-3d-body
Pinned revision: b5c765a0d89d789985e186d396315e7590887b94
The preparation script also downloads this source under ~/game-builder-models/sam-3d-body.

Request the Body weights separately at https://huggingface.co/facebook/sam-3d-body-vith or https://huggingface.co/facebook/sam-3d-body-dinov3. Keep model.ckpt, model_config.yaml and assets/mhr_model.pt together. Configure a separate compatible Python environment, the repository directory, checkpoint and MHR file in Settings. Follow the official INSTALL.md; the adapter additionally needs trimesh for GLB export. Avoid the optional notebook model-download helpers when running offline.

The Body adapter has no 32 GB hardware gate: that requirement belongs to the Objects setup. A community Body workflow reports ~3.5 GB peak for one person (https://github.com/tori29umai0123/ComfyUI-SAM3DBody_utills/blob/main/README.en.md), but this adapter's memory and RTX 5070 compatibility have not been tested with weights. Do not treat that measurement as a guarantee for every checkpoint, precision or input.

## Current machine

- Windows, NVIDIA RTX 5070: 12,227 MiB total VRAM; roughly 32 GB system RAM.
- WSL 2 distribution: PCMClawUbuntu. Python 3.12.3 and the WSL GPU device are present.
- At preparation time this WSL distro had no PyTorch, pip, conda, CUDA compiler or SAM package. Seeing /dev/dxg does not prove CUDA kernels will run.
- The distro has no /mnt/c mount. The studio transfers selected input images and results through a local pipe instead.

## 1. Pinned sources

From PowerShell in the studio folder:

    powershell -NoProfile -File scripts/Prepare-Local.ps1 -CheckOnly
    powershell -NoProfile -File scripts/Prepare-Local.ps1

The second command prepares source folders under ~/game-builder-models inside WSL and writes preparation.json. It does not run repository setup code or download model weights. Existing folders at different revisions are left untouched.

Official SAM 3 source:
https://github.com/facebookresearch/sam3
Revision: f1647e8d0c1d280991f4d1b7d974c2704537fe66

Experimental 3D source:
https://github.com/AshadowZ/sam-3d-low-vram
Revision: d20c5a5a669c7085231ad2089f2a3868ce720e96

The community author reports ~12 GB peak by moving stages between CPU RAM and GPU. That is not an official Meta hardware guarantee. Official SAM 3D Objects documents at least 32 GB VRAM:
https://github.com/facebookresearch/sam-3d-objects/blob/main/doc/setup.md

## 2. Dependency compatibility is still required

Use separate isolated Python environments for SAM 3 and SAM 3D. Do not change the system Python or install the fork's requirements into an existing application environment.

The fork inherits CUDA 12.1, Torch 2.5.1, spconv-cu121, Kaolin 0.17 and old xformers dependencies. These are NOT a validated RTX 5070 stack. Blackwell support began with PyTorch 2.7 / CUDA 12.8:
https://pytorch.org/blog/pytorch-2-7/

For SAM 3, follow its official installation instructions in the pinned source, using a Blackwell-compatible CUDA PyTorch build. Its current guide uses Python 3.12 and CUDA 12.8 wheels. The Python environment must import torch, torchvision, PIL, numpy and sam3 successfully.

For the 3D fork, updating PyTorch alone is insufficient: spconv, Kaolin, PyTorch3D, gsplat and any attention/CUDA extensions must be compatible with the same PyTorch/CUDA/SM120 combination. They need appropriate wheels or source builds with a compatible CUDA compiler. This compatibility port and a real reconstruction remain unfinished; the app does not pretend otherwise or automatically install the old stack.

Keep compilation disabled, use one job at a time and close other GPU-heavy programs. CPU offloading reduces VRAM pressure but increases RAM use and transfers. No 12 GB success or fixed processing time is guaranteed.

## 3. Approved model weights

Request access with your own Hugging Face account and accept the applicable terms yourself:

- https://huggingface.co/facebook/sam3
- https://huggingface.co/facebook/sam-3d-objects

Download SAM 3's checkpoint and the full SAM 3D Objects checkpoint/config tree after approval. Keep the 3D folder structure intact because pipeline.yaml refers to other files. Never paste a Hugging Face token into project prompts or chat; use the provider's login on your PC. The preparation scripts do not log in or download gated weights.

## 4. Connect the local environments

In studio Settings choose “WSL Linux on this PC” and distribution PCMClawUbuntu. Enter absolute Linux paths, for example after you have actually created these environments and downloaded the models:

SAM Python: /home/sanskar/sam3-env/bin/python
SAM repository: /home/sanskar/game-builder-models/sam3
SAM checkpoint: /home/sanskar/models/sam3.pt

3D Python: /home/sanskar/sam3d-env/bin/python
3D repository: /home/sanskar/game-builder-models/sam-3d-low-vram
3D pipeline: /home/sanskar/models/sam-3d-objects/checkpoints/pipeline.yaml
Memory profile: Experimental — stage offloading

These environment/checkpoint paths are examples, not installed files. Use the actual paths on your machine. Save settings and run both environment checks. The check executes a small CUDA matrix operation, lists missing packages, and detects the offloading implementation. Model inference is a separate test.

## 5. Verify one real asset

1. Import a simple, clearly separated object image with an appropriate object label.
2. Run SAM cutout. Check the transparent PNG and mask actually match that object.
3. Run Create 3D with the experimental profile. Check Activity for errors.
4. Open the exported GLB in Blender or your game engine; verify geometry/materials, not just file existence.
5. Measure GPU and system memory while it runs. Reload the app and check the files still exist.

If it runs out of VRAM, the app keeps the source image and previously completed outputs. The honest fallback is a larger GPU or a different, lighter 3D model. Renting a GPU would move that processing off this PC and needs separate configuration; no rental has been started.
