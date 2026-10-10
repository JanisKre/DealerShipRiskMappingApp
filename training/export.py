"""Export the trained model to ONNX and write the app's model manifest.

    python export.py                 # runs/dealer-obb/weights/best.pt → export/
    python export.py --install       # …and copy into the app's userData/models

The manifest (`dealer_vehicles.json`) tells the app how to decode the output
and at which resolution to feed imagery; schema in
desktop-app/src/shared/model-manifest.ts. The output layout is read from the
exported graph itself, so raw and NMS-free (end2end) exports both work.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import shutil
from pathlib import Path

import onnxruntime as ort
from ultralytics import YOLO

from common import DATA, ROOT, TARGET_GSD_M

NAME = "dealer_vehicles"
# Model class name → the app's vehicle class
APP_CLASS = {"car": "car", "large_vehicle": "truck"}
# Added to the user's base confidence threshold, per model class name
CLASS_OFFSETS = {"large_vehicle": 0.05}
DEFAULT_INSTALL_DIR = Path.home() / "Library" / "Application Support" / "Dealership Risk Mapping" / "models"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def training_data() -> list[str]:
    """Sources actually in the dataset the model was trained on, for the manifest's provenance.
    Public tiles are the DLR 3K Munich crops (`DLR-*`, see convert_public.py); a hard-coded
    list would claim them even after `make_dataset.py --no-public`."""
    train = sorted((DATA / "dataset" / "images" / "train").glob("*.jpg"))
    if not train:
        raise SystemExit("no data/dataset/images/train — run make_dataset.py, or pass --training-data")
    sources = []
    if any(not p.name.startswith("DLR-") for p in train):
        sources.append("Dealership orthophoto tiles (state DOPs)")
    if any(p.name.startswith("DLR-") for p in train):
        sources.append("DLR 3K Munich Vehicle")
    return sources


def output_format(onnx_path: Path, task: str, nc: int) -> str:
    shape = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"]).get_outputs()[0].shape
    raw_channels = 4 + nc + (1 if task == "obb" else 0)
    if shape[1] == raw_channels:
        return "raw"
    if shape[2] == (7 if task == "obb" else 6):
        return "end2end"
    raise SystemExit(f"unrecognised output shape {shape} for {task} with {nc} classes")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", default=str(ROOT / "runs" / "dealer-obb" / "weights" / "best.pt"))
    ap.add_argument("--version", default=dt.date.today().isoformat())
    ap.add_argument("--training-data", nargs="*", default=None, help="provenance for the manifest (default: read from data/dataset)")
    ap.add_argument("--install", action="store_true")
    ap.add_argument("--install-dir", default=str(DEFAULT_INSTALL_DIR))
    args = ap.parse_args()

    model = YOLO(args.weights)
    task = model.task
    if task not in ("obb", "detect"):
        raise SystemExit(f"unsupported task {task}")
    names: dict[int, str] = model.names
    imgsz = int(model.overrides.get("imgsz", 640))

    exported = Path(model.export(format="onnx", opset=17, imgsz=imgsz, simplify=True, dynamic=False))
    out_dir = ROOT / "export"
    out_dir.mkdir(exist_ok=True)
    onnx_path = out_dir / f"{NAME}.onnx"
    shutil.copy2(exported, onnx_path)

    manifest = {
        "schemaVersion": 1,
        "name": NAME,
        "version": args.version,
        "task": task,
        "outputFormat": output_format(onnx_path, task, len(names)),
        "imgsz": imgsz,
        "gsdM": TARGET_GSD_M,
        "classes": {str(i): n for i, n in names.items()},
        "vehicleClasses": {str(i): APP_CLASS[n] for i, n in names.items() if n in APP_CLASS},
        "classOffsets": {str(i): CLASS_OFFSETS[n] for i, n in names.items() if n in CLASS_OFFSETS},
        "sha256": sha256(onnx_path),
        "trainingData": args.training_data if args.training_data is not None else training_data(),
        "license": "AGPL-3.0 (Ultralytics); training data licences apply",
        "limitations": [
            "Fine-tuned on a limited set of German dealership sites; validate on new regions before relying on counts",
        ],
    }
    if not manifest["vehicleClasses"]:
        raise SystemExit(f"no class in {names} maps to an app vehicle class ({APP_CLASS})")
    manifest_path = out_dir / f"{NAME}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {onnx_path} and {manifest_path} ({manifest['task']}, {manifest['outputFormat']})")

    if args.install:
        dst = Path(args.install_dir)
        dst.mkdir(parents=True, exist_ok=True)
        shutil.copy2(onnx_path, dst / onnx_path.name)
        shutil.copy2(manifest_path, dst / manifest_path.name)
        print(f"installed into {dst} — restart the app to pick it up")


if __name__ == "__main__":
    main()
