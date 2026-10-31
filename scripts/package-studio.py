"""Create a portable source ZIP without user data, keys, dependencies or models."""
from pathlib import Path
import argparse
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("destination", type=Path)
args = parser.parse_args()
destination = args.destination.resolve()
destination.parent.mkdir(parents=True, exist_ok=True)
files = [root / name for name in ["package.json", "server.mjs", "README.md", "VALIDATION.md", ".gitignore", ".gitattributes", "Start-Studio.cmd", "Stop-Studio.cmd"]]
for name in ["lib", "public", "workers", "scripts", "tests"]:
    files.extend(p for p in (root / name).rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc")
with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, "Script-and-Sprite-Asset-Studio/" + file.relative_to(root).as_posix())
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert all(not ({"data", "runtime", ".qa-data", ".test-runs", ".git", "node_modules"} & set(Path(n).parts)) for n in archive.namelist())
    print(f"Verified {len(archive.namelist())} files: {destination}")
