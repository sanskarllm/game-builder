"""SAM 3D service for Game Forge — Meta's SAM 3D Body and SAM 3D Objects.

Turns an image into a .glb mesh Game Forge can use:

  body     SAM 3D Body (facebook/sam-3d-body-dinov3): a posed human body mesh
           (Momentum Human Rig) from a photo or drawing of a person.
           ~840M params — runs on a 12 GB consumer GPU, Windows or Linux.
  objects  SAM 3D Objects (facebook/sam-3d-objects): a textured mesh of any
           cut-out object. Needs Linux + a 32 GB+ GPU.

Endpoints
    GET  /health                    -> {"ok", "mode", "kinds": [...], "loaded": [...]}
    POST /reconstruct  (multipart)  -> model/gltf-binary
         image:    PNG/JPG. Transparent pixels = background (used as the mask/crop).
         mask:     optional PNG, white = subject (overrides alpha)
         kind:     "body" or "objects" (default: the first available)
         seed:     objects only, int (default 42)
         format:   objects only, "glb" (default) or "ply" (Gaussian splat)
         textured: objects only, "1" to bake a texture (slower)

Environment
    SAM3D_BODY_REPO     path to the sam-3d-body code (default: the bundled ./sam-3d-body)
    SAM3D_BODY_HF       HF repo id (default facebook/sam-3d-body-dinov3)
    SAM3D_BODY_CKPT     optional local folder holding model.ckpt + assets/mhr_model.pt
    SAM3D_OBJECTS_REPO  path to a facebookresearch/sam-3d-objects clone (enables "objects";
                        defaults to the current folder if it has checkpoints/hf/pipeline.yaml)
    SAM3D_TOKEN         if set, requests must send "Authorization: Bearer <token>"
    SAM3D_FAKE=1        no model: answer with a placeholder cube (to test the wiring)
    HOST / PORT         default 127.0.0.1:8000
"""

import io
import json
import os
import struct
import sys
import tempfile
import threading
import time

import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image

TOKEN = os.environ.get("SAM3D_TOKEN", "")
FAKE = os.environ.get("SAM3D_FAKE") == "1"
MAX_SIDE = int(os.environ.get("SAM3D_MAX_SIDE", "1024"))
_BUNDLED_BODY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sam-3d-body")
BODY_REPO = os.environ.get("SAM3D_BODY_REPO", "") or (_BUNDLED_BODY if os.path.isdir(os.path.join(_BUNDLED_BODY, "sam_3d_body")) else "")
BODY_HF = os.environ.get("SAM3D_BODY_HF", "facebook/sam-3d-body-dinov3")
BODY_CKPT = os.environ.get("SAM3D_BODY_CKPT", "")
BODY_FOV = os.environ.get("SAM3D_BODY_FOV", "moge2")  # camera-FOV estimator; "" to skip (less VRAM, less accurate)
PRELOAD = os.environ.get("SAM3D_PRELOAD", "1") == "1"  # load models at startup so the first request is fast
OBJECTS_REPO = os.environ.get("SAM3D_OBJECTS_REPO", "" if not os.path.exists("checkpoints/hf/pipeline.yaml") else os.getcwd())

KINDS = (["body"] if BODY_REPO else []) + (["objects"] if OBJECTS_REPO else [])
if FAKE and not KINDS:
    KINDS = ["body", "objects"]

app = FastAPI(title="SAM 3D for Game Forge")
_models = {}
_gpu = threading.Lock()  # one reconstruction at a time on a single GPU


# ---------------------------------------------------------------- models
def fast_gpu():
    """Speed over memory: TF32 tensor cores. cuDNN autotuning stays off by
    default because it re-tunes for every new image size (5-8 s each), and
    uploads come in all sizes; SAM3D_CUDNN_BENCHMARK=1 turns it on."""
    import torch

    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = os.environ.get("SAM3D_CUDNN_BENCHMARK") == "1"
    torch.set_float32_matmul_precision("high")


def body_model():
    if "body" not in _models:
        fast_gpu()
        sys.path.insert(0, BODY_REPO)
        from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body, load_sam_3d_body_hf

        if BODY_CKPT:
            model, cfg = load_sam_3d_body(os.path.join(BODY_CKPT, "model.ckpt"), "cuda",
                                          os.path.join(BODY_CKPT, "assets", "mhr_model.pt"))
        else:
            model, cfg = load_sam_3d_body_hf(BODY_HF)
        # MoGe2 estimates the camera's field of view, which gives better body
        # proportions and pose than the default FOV.
        fov = None
        if BODY_FOV:
            try:
                from tools.build_fov_estimator import FOVEstimator

                fov = FOVEstimator(name=BODY_FOV, device="cuda")
            except Exception as e:
                print(f"FOV estimator '{BODY_FOV}' unavailable, using default FOV: {e}")
        # No person detector: we pass the person's box ourselves, which also
        # avoids the detectron2 dependency (hard to build on Windows).
        _models["body"] = SAM3DBodyEstimator(sam_3d_body_model=model, model_cfg=cfg, fov_estimator=fov)
        _models["body_fov"] = BODY_FOV if fov else ""
    return _models["body"]


def objects_model():
    if "objects" not in _models:
        os.chdir(OBJECTS_REPO)
        sys.path.append(os.path.join(OBJECTS_REPO, "notebook"))
        from inference import Inference  # from the sam-3d-objects repo

        _models["objects"] = Inference(os.path.join(OBJECTS_REPO, "checkpoints/hf/pipeline.yaml"), compile=False)
    return _models["objects"]


# ---------------------------------------------------------------- inputs
def check_auth(authorization):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "Missing or wrong SAM3D_TOKEN")


def read_inputs(image_bytes, mask_bytes, need_mask):
    img = Image.open(io.BytesIO(image_bytes))
    scale = min(1.0, MAX_SIDE / max(img.size))
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    rgba = np.array(img.convert("RGBA"), dtype=np.uint8)
    mask = None
    if mask_bytes:
        m = Image.open(io.BytesIO(mask_bytes)).convert("L").resize(img.size, Image.NEAREST)
        mask = np.array(m) > 127
    elif has_alpha and (rgba[..., 3] < 128).any():
        mask = rgba[..., 3] > 127
    if mask is not None and mask.sum() < 64:
        raise HTTPException(400, "The mask is empty — nothing to reconstruct.")
    if need_mask and mask is None:
        raise HTTPException(400, "The image has no transparent background and no mask was sent. "
                                 "Cut the object out first (PNG with transparency) or upload a mask.")
    rgb = rgba[..., :3].copy()
    if mask is not None:  # flatten the cut-out onto grey so the model sees a clean subject
        rgb[~mask] = 128
    return rgb, mask


def bbox_of(mask, w, h, pad=0.08):
    if mask is None:
        return np.array([[0, 0, w, h]], dtype=np.float32)
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    px, py = (x1 - x0) * pad, (y1 - y0) * pad
    return np.array([[max(0, x0 - px), max(0, y0 - py), min(w, x1 + px), min(h, y1 + py)]], dtype=np.float32)


def to_list(v):
    try:
        v = v.detach().cpu().numpy() if hasattr(v, "detach") else np.asarray(v)
        return np.round(v.astype(np.float64).reshape(-1), 5).tolist()
    except Exception:
        return None


# ---------------------------------------------------------------- routes
def vram():
    try:
        import torch

        if torch.cuda.is_available():
            return {"gpu": torch.cuda.get_device_name(0),
                    "vram_used_gb": round(torch.cuda.memory_allocated() / 2**30, 2),
                    "vram_peak_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2)}
    except Exception:
        pass
    return {}


@app.on_event("startup")
def preload():
    if not (PRELOAD and not FAKE and KINDS):
        return

    def load():
        with _gpu:
            try:
                (body_model if KINDS[0] == "body" else objects_model)()
                if KINDS[0] == "body":
                    # One throwaway pass so CUDA/cuDNN autotuning happens now,
                    # not on the user's first click (~28 s -> under 1 s).
                    dummy = np.full((512, 384, 3), 128, dtype=np.uint8)
                    _models["body"].process_one_image(dummy, bboxes=np.array([[0, 0, 384, 512]], dtype=np.float32))
                print(f"Model ready: {KINDS[0]} · {vram()}", flush=True)
            except Exception as e:
                _models["error"] = f"{type(e).__name__}: {e}"
                print("Preload failed:", _models["error"])

    threading.Thread(target=load, daemon=True).start()


@app.get("/health")
def health():
    loaded = [k for k in ("body", "objects") if k in _models]
    return {"ok": True, "mode": "fake" if FAKE else "sam3d", "kinds": KINDS, "loaded": loaded,
            "fov": _models.get("body_fov"), "error": _models.get("error"), **vram()}


@app.post("/reconstruct")
async def reconstruct(
    image: UploadFile = File(...),
    mask: UploadFile | None = File(None),
    kind: str = Form(""),
    seed: int = Form(42),
    format: str = Form("glb"),
    textured: str = Form("0"),
    authorization: str | None = Header(None),
):
    check_auth(authorization)
    kind = kind or (KINDS[0] if KINDS else "")
    if kind not in KINDS:
        raise HTTPException(400, f"This service does not run '{kind}'. Available: {', '.join(KINDS) or 'none'}.")
    rgb, m = read_inputs(await image.read(), await mask.read() if mask else None, need_mask=(kind == "objects"))
    started = time.time()

    if FAKE:
        return Response(fake_cube_glb(), media_type="model/gltf-binary",
                        headers={"X-Pose": json.dumps({"fake": True, "kind": kind}), "X-Seconds": "0"})

    if kind == "body":
        return run_body(rgb, m, started)
    return run_objects(rgb, m, seed, format, textured == "1", started)


def run_body(rgb, m, started):
    import trimesh

    h, w = rgb.shape[:2]
    with _gpu:
        est = body_model()
        outputs = est.process_one_image(rgb, bboxes=bbox_of(m, w, h))
        faces = est.faces
    if not outputs:
        raise HTTPException(400, "SAM 3D Body found no person in this image.")
    person = outputs[0]
    verts = np.asarray(person["pred_vertices"], dtype=np.float32)
    mesh = trimesh.Trimesh(verts, np.asarray(faces), process=False)
    mesh.visual.vertex_colors = np.tile(np.array([166, 189, 219, 255], dtype=np.uint8), (len(verts), 1))
    # Camera space (y down, z forward) -> glTF y-up: same 180° X turn the repo's exporter uses.
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0]))
    pose = {"kind": "body", "keypoints_3d": to_list(person.get("pred_keypoints_3d")),
            "cam_t": to_list(person.get("pred_cam_t")), "focal_length": to_list(person.get("focal_length"))}
    return Response(mesh.export(file_type="glb"), media_type="model/gltf-binary",
                    headers={"X-Pose": json.dumps({k: v for k, v in pose.items() if k != "keypoints_3d"}),
                             "X-Seconds": f"{time.time() - started:.1f}",
                             "X-VRAM": json.dumps(vram())})


def run_objects(rgb, m, seed, fmt, textured, started):
    with _gpu:
        inf = objects_model()
        if textured:
            # Full post-processing + texture baking (private pipeline API; falls
            # back to the public wrapper if this checkout's signature differs).
            try:
                out = inf._pipeline.run(inf.merge_mask_to_rgba(rgb, m), None, seed,
                                        stage1_only=False, with_mesh_postprocess=True,
                                        with_texture_baking=True, with_layout_postprocess=False,
                                        use_vertex_color=False)
            except TypeError:
                out = inf(rgb, m, seed=seed)
        else:
            out = inf(rgb, m, seed=seed)

    pose = {k: to_list(out.get(k)) for k in ("rotation", "translation", "scale") if out.get(k) is not None}
    headers = {"X-Pose": json.dumps({"kind": "objects", **pose}), "X-Seconds": f"{time.time() - started:.1f}"}
    if fmt == "ply":
        with tempfile.NamedTemporaryFile(suffix=".ply", delete=False) as f:
            path = f.name
        try:
            out["gs"].save_ply(path)
            with open(path, "rb") as f:
                data = f.read()
        finally:
            os.remove(path)
        return Response(data, media_type="application/octet-stream", headers=headers)
    glb = out.get("glb")
    if glb is None:
        raise HTTPException(500, "SAM 3D Objects returned no mesh for this image (try format=ply).")
    return Response(glb.export(file_type="glb"), media_type="model/gltf-binary", headers=headers)


@app.exception_handler(Exception)
async def crash(_, exc):
    return JSONResponse({"detail": f"{type(exc).__name__}: {exc}"}, status_code=500)


def fake_cube_glb():
    """Smallest valid GLB: a unit cube, so the pipeline can be tested without a GPU."""
    p = [(-.5, 0, -.5), (.5, 0, -.5), (.5, 1, -.5), (-.5, 1, -.5), (-.5, 0, .5), (.5, 0, .5), (.5, 1, .5), (-.5, 1, .5)]
    idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5, 3, 7, 6, 3, 6, 2, 0, 1, 5, 0, 5, 4]
    pos = b"".join(struct.pack("<3f", *v) for v in p)
    ind = b"".join(struct.pack("<H", i) for i in idx)
    binbuf = pos + ind
    gltf = {
        "asset": {"version": "2.0", "generator": "sam3d-service fake"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "placeholder"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [0.57, 0.52, 0.85, 1], "roughnessFactor": 0.8}}],
        "buffers": [{"byteLength": len(binbuf)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pos)},
                        {"buffer": 0, "byteOffset": len(pos), "byteLength": len(ind)}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 8, "type": "VEC3", "min": [-.5, 0, -.5], "max": [.5, 1, .5]},
                      {"bufferView": 1, "componentType": 5123, "count": len(idx), "type": "SCALAR"}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    binbuf += b"\0" * (-len(binbuf) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binbuf), 0x004E4942) + binbuf
    return struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body


if __name__ == "__main__":
    import uvicorn

    print(f"SAM 3D service · kinds: {', '.join(KINDS) or 'none — set SAM3D_BODY_REPO or SAM3D_OBJECTS_REPO'}"
          f"{' · FAKE mode' if FAKE else ''}")
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")))
