"""Fine-tune a DOTA-pretrained oriented-box YOLO on dealership tiles — locally on Apple silicon.

    caffeinate -i python train.py                 # ~2–4 h on a MacBook Air M4 (16 GB)
    caffeinate -i python train.py --resume        # continue after an interruption
    python train.py --epochs 3 --fraction 0.1     # smoke test (minutes)

MacBook Air notes: it has no fan and throttles on long runs — keep it on the
charger, close other heavy apps, and don't use it for other work meanwhile.
batch 8 at 640 px fits comfortably in 16 GB unified memory. Ops missing on
MPS fall back to the CPU (PYTORCH_ENABLE_MPS_FALLBACK); if training still
fails on MPS, try `--model yolo11n-obb.pt` or `--device cpu` for a smoke test.
"""

from __future__ import annotations

import argparse
import os

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

from ultralytics import YOLO  # noqa: E402

from common import ROOT  # noqa: E402

RUN_DIR = ROOT / "runs"
RUN_NAME = "dealer-obb"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="yolo11s-obb.pt", help="DOTA-pretrained start weights (e.g. yolo26s-obb.pt)")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--fraction", type=float, default=1.0, help="share of the training set, for smoke tests")
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    if args.resume:
        YOLO(str(RUN_DIR / RUN_NAME / "weights" / "last.pt")).train(resume=True)
        return

    YOLO(args.model).train(
        data=str(ROOT / "dataset.yaml"),
        imgsz=args.imgsz,
        batch=args.batch,
        epochs=args.epochs,
        device=args.device,
        fraction=args.fraction,
        workers=2,
        cache="disk",
        patience=15,
        close_mosaic=10,
        # Nadir imagery has no "up": any rotation and flip is a valid sample.
        degrees=180,
        flipud=0.5,
        fliplr=0.5,
        # Keep scale jitter moderate — the app feeds the model a fixed 0.10 m/px.
        scale=0.3,
        project=str(RUN_DIR),
        name=RUN_NAME,
        exist_ok=True,
    )


if __name__ == "__main__":
    main()
