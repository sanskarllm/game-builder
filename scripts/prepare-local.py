"""Prepare pinned SAM source folders. No model downloads, installs or inference."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

SOURCES = {
    "sam-3d-body": ("https://github.com/facebookresearch/sam-3d-body.git", "b5c765a0d89d789985e186d396315e7590887b94"),
    "sam3": ("https://github.com/facebookresearch/sam3.git", "f1647e8d0c1d280991f4d1b7d974c2704537fe66"),
    "sam-3d-low-vram": ("https://github.com/AshadowZ/sam-3d-low-vram.git", "d20c5a5a669c7085231ad2089f2a3868ce720e96"),
}

def git(args, folder=None):
    env = dict(os.environ, GIT_LFS_SKIP_SMUDGE="1", GIT_TERMINAL_PROMPT="0")
    return subprocess.check_output(["git", *args], cwd=folder, env=env, text=True, stderr=subprocess.STDOUT, timeout=300).strip()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fetch-sources", action="store_true")
    parser.add_argument("--root", default=str(Path.home() / "script-sprite-models"))
    args = parser.parse_args()
    if sys.platform != "linux":
        raise SystemExit("Run this preparation script inside WSL Linux.")
    root = Path(args.root).expanduser().resolve()
    if root == Path("/") or root == Path.home():
        raise SystemExit("Use a dedicated model folder.")
    report = {"root": str(root), "python": sys.version.split()[0], "gpuExposedToWSL": Path("/dev/dxg").exists(),
              "pipAvailable": importlib.util.find_spec("pip") is not None,
              "torchInstalled": importlib.util.find_spec("torch") is not None, "sources": {},
              "status": "Prepared source profile only. Inference has NOT been verified.",
              "remaining": ["Install isolated CUDA 12.8+ / PyTorch 2.7+ compatible environments for this Blackwell GPU.",
                            "Port and test the 3D fork's older CUDA 12.1 / Torch 2.5 dependencies, including sparse and rendering extensions.",
                            "Obtain approved SAM 3, SAM 3D Body and SAM 3D Objects weights through your own Hugging Face account.",
                            "Run an image cutout and then one simple-object reconstruction; measure peak VRAM and RAM."]}
    if args.fetch_sources:
        if not shutil.which("git"):
            raise SystemExit("Git is required inside WSL.")
        root.mkdir(parents=True, exist_ok=True)
        for name, (url, revision) in SOURCES.items():
            folder = root / name
            if folder.exists():
                actual = git(["rev-parse", "HEAD"], folder)
                if actual != revision:
                    raise SystemExit(f"{folder} is a different revision. Existing files were left unchanged.")
            else:
                print(f"Preparing {name} at {revision[:12]}...", file=sys.stderr, flush=True)
                git(["init", str(folder)])
                git(["remote", "add", "origin", url], folder)
                git(["fetch", "--depth", "1", "origin", revision], folder)
                git(["checkout", "--detach", "FETCH_HEAD"], folder)
            report["sources"][name] = {"path": str(folder), "revision": revision}
        (root / "preparation.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
