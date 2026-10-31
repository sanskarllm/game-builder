"""Isolated local SAM worker. Never downloads weights or executes model-written code."""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import sys
import uuid
import tempfile


def check(three=False, repo=None, body=False):
    if repo:
        sys.path.insert(0, str(Path(repo).resolve()))
    result = {"python": sys.version.split()[0], "samInstalled": importlib.util.find_spec("sam3") is not None,
              "torchInstalled": importlib.util.find_spec("torch") is not None, "cuda": False}
    if body:
        result["missingBodyDependencies"] = [name for name in ["sam_3d_body", "trimesh", "cv2", "torchvision", "einops", "yacs"] if importlib.util.find_spec(name) is None]
    if three:
        result["missing3DDependencies"] = [name for name in ["sam3d_objects", "kaolin", "spconv", "pytorch3d", "gsplat", "hydra", "moge"] if importlib.util.find_spec(name) is None]
        source = Path(repo or ".") / "sam3d_objects/pipeline/inference_pipeline.py"
        result["stageOffloadingFound"] = source.is_file() and "_temporary_move_to_gpu" in source.read_text()
    if result["torchInstalled"]:
        import torch
        result.update(torch=torch.__version__, cuda=torch.cuda.is_available())
        if result["cuda"]:
            result.update(gpu=torch.cuda.get_device_name(0), vramGB=round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1))
            try:
                # Exercise a real kernel: merely seeing a Blackwell GPU is insufficient.
                probe = torch.ones((32, 32), device="cuda")
                result["cudaKernelWorks"] = float((probe @ probe)[0, 0].item()) == 32.0
                result["freeVramGB"] = round(torch.cuda.mem_get_info()[0] / 1024**3, 1)
                del probe
            except Exception as exc:
                result["cudaKernelWorks"] = False
                result["cudaError"] = str(exc)[:500]
    print(json.dumps(result))


def process(req):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ.pop("MODEL_API_KEY", None)
    import numpy as np
    from PIL import Image
    import torch
    Image.MAX_IMAGE_PIXELS = 32_000_000
    if not torch.cuda.is_available():
        raise RuntimeError("A working CUDA PyTorch installation is required. Check the local setup guide.")
    prefix = Path(req["outputPrefix"]).resolve()
    image = Image.open(req["image"]).convert("RGB")
    if req.get("repo"):
        sys.path.insert(0, str(Path(req["repo"]).resolve()))
    if req["operation"] == "body":
        if not Path(req["checkpoint"]).is_file() or not Path(req["mhr"]).is_file():
            raise RuntimeError("Download approved SAM 3D Body and MHR checkpoints first.")
        from sam_3d_body import load_sam_3d_body, SAM3DBodyEstimator
        import trimesh
        model, cfg = load_sam_3d_body(checkpoint_path=req["checkpoint"], mhr_path=req["mhr"], device="cuda")
        # The studio supplies an isolated single-person design, so optional
        # detection, segmentation and FOV models are not loaded into VRAM.
        estimator = SAM3DBodyEstimator(model, cfg, human_detector=None, human_segmentor=None, fov_estimator=None)
        with torch.inference_mode():
            results = estimator.process_one_image(np.array(image), inference_type="body")
        if len(results) != 1:
            raise RuntimeError("Use one clearly visible human character in the image.")
        vertices = np.asarray(results[0]["pred_vertices"])
        if vertices.ndim != 2 or vertices.shape[1] != 3 or not np.isfinite(vertices).all():
            raise RuntimeError("SAM 3D Body returned invalid geometry.")
        mesh = prefix.with_suffix(".glb")
        trimesh.Trimesh(vertices=vertices, faces=estimator.faces, process=False).export(str(mesh))
        return {"files": {"bodyModel": mesh.name}}
    if req["operation"] == "cutout":
        checkpoint = Path(req["checkpoint"])
        if not checkpoint.is_file():
            raise RuntimeError("Download an approved SAM 3 checkpoint and set its path in Settings.")
        from sam3.model_builder import build_sam3_image_model
        from sam3.model.sam3_image_processor import Sam3Processor
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            model = build_sam3_image_model(checkpoint_path=str(checkpoint), load_from_HF=False, device="cuda", compile=False)
            processor = Sam3Processor(model)
            state = processor.set_image(image)
            result = processor.set_text_prompt(state=state, prompt=req["label"])
            masks, scores = result["masks"], result["scores"]
            if masks.numel() == 0:
                raise RuntimeError("SAM found no matching object. Edit the object label and try again.")
            # Highest confidence instance, not a merged foreground of unrelated objects.
            index = int(scores.flatten().argmax())
            mask = masks[index].squeeze().detach().cpu().numpy() > 0.5
        alpha = Image.fromarray((mask.astype(np.uint8) * 255), "L")
        if alpha.size != image.size:
            alpha = alpha.resize(image.size, Image.Resampling.NEAREST)
        cutout = image.convert("RGBA")
        cutout.putalpha(alpha)
        output = prefix.with_suffix(".png")
        mask_path = prefix.parent / (str(uuid.uuid4()) + ".png")
        cutout.save(output)
        alpha.save(mask_path)
        return {"files": {"cutout": output.name, "mask": mask_path.name}}
    if req["operation"] == "mesh":
        if sys.platform != "linux":
            raise RuntimeError("Official SAM 3D Objects inference requires Linux.")
        if not req.get("experimental") and torch.cuda.get_device_properties(0).total_memory < 32_000_000_000:
            raise RuntimeError("Official SAM 3D Objects inference requires at least 32 GB VRAM.")
        repo = Path(req["repo"]).resolve()
        if req.get("experimental"):
            source = repo / "sam3d_objects/pipeline/inference_pipeline.py"
            if not source.is_file() or "_temporary_move_to_gpu" not in source.read_text():
                raise RuntimeError("Experimental mode requires the prepared low-memory fork, not the official all-GPU pipeline.")
        sys.path.insert(0, str(repo / "notebook"))
        from inference import Inference
        mask = np.array(Image.open(req["mask"]).convert("L")) > 127
        pipeline = Inference(str(Path(req["pipeline"]).resolve()), compile=False)
        with torch.inference_mode():
            output = pipeline(np.array(image), mask, seed=42)
        if output.get("glb") is None:
            raise RuntimeError("SAM 3D returned no mesh. The image and mask may need improvement.")
        mesh = prefix.with_suffix(".glb")
        output["glb"].export(str(mesh))
        files = {"model": mesh.name}
        if output.get("gs") is not None:
            splat = prefix.with_suffix(".ply")
            output["gs"].save_ply(str(splat))
            files["splat"] = splat.name
        return {"files": files}
    raise RuntimeError("Unknown local operation.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--three", action="store_true")
    parser.add_argument("--body", action="store_true")
    parser.add_argument("--repo")
    parser.add_argument("--stdio", action="store_true")
    parser.add_argument("--request")
    args = parser.parse_args()
    if args.check:
        check(args.three, args.repo, args.body)
    else:
        try:
            if args.stdio:
                # Transfer only selected inputs through pipes. No Windows-drive mount is required.
                req = json.loads(sys.stdin.read(45 * 1024 * 1024))
                with tempfile.TemporaryDirectory(prefix="asset-studio-") as workdir:
                    folder = Path(workdir)
                    image_path = folder / "input.png"
                    image_path.write_bytes(base64.b64decode(req.pop("imageData"), validate=True))
                    req["image"] = str(image_path)
                    if req.get("maskData"):
                        mask_path = folder / "mask.png"
                        mask_path.write_bytes(base64.b64decode(req.pop("maskData"), validate=True))
                        req["mask"] = str(mask_path)
                    req["outputPrefix"] = str(folder / str(uuid.uuid4()))
                    result = process(req)
                    result["files"] = {kind: {"data": base64.b64encode((folder / name).read_bytes()).decode("ascii")} for kind, name in result["files"].items()}
                    print("STUDIO_RESULT " + json.dumps(result))
            else:
                req = json.loads(Path(args.request).read_text(encoding="utf-8"))
                print("STUDIO_RESULT " + json.dumps(process(req)))
        except Exception as exc:
            print("STUDIO_RESULT " + json.dumps({"error": str(exc)[:1000]}))
