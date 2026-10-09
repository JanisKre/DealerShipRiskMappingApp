"""Evaluate a model on the held-out validation sites.

Reports detection quality (mAP50 via Ultralytics) and — what the app
actually uses — per-site vehicle counts: MAE, signed bias, and the share of
sites within 10 % (same metrics as desktop-app/src/main/services/detection-benchmark.ts).

    python evaluate.py
    python evaluate.py --weights yolo11s-obb.pt --dota   # baseline: pretrained model as-is
"""

from __future__ import annotations

import argparse
import os
from collections import defaultdict
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

from ultralytics import YOLO  # noqa: E402

from common import DATA, ROOT, read_obb_labels, site_of  # noqa: E402

DOTA_VEHICLES = {9, 10}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", default=str(ROOT / "runs" / "dealer-obb" / "weights" / "best.pt"))
    ap.add_argument("--dota", action="store_true", help="weights use DOTA classes (baseline)")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default="mps")
    args = ap.parse_args()

    model = YOLO(args.weights)
    if not args.dota:
        metrics = model.val(data=str(ROOT / "dataset.yaml"), imgsz=args.imgsz, device=args.device, verbose=False)
        print(f"mAP50 {metrics.box.map50:.3f}   mAP50-95 {metrics.box.map:.3f}")

    images = sorted((DATA / "dataset" / "images" / "val").glob("*.jpg"))
    labels_dir = DATA / "dataset" / "labels" / "val"
    expected: dict[str, int] = defaultdict(int)
    predicted: dict[str, int] = defaultdict(int)
    # Tiles overlap only within public data; dealership tiles are a disjoint
    # grid, so summing tile counts per site gives the site count.
    for i in range(0, len(images), 16):
        batch = images[i : i + 16]
        for path, res in zip(batch, model.predict(batch, imgsz=args.imgsz, conf=args.conf, device=args.device, verbose=False)):
            site = site_of(path)
            expected[site] += len(read_obb_labels(labels_dir / f"{path.stem}.txt"))
            classes = res.obb.cls.tolist() if res.obb is not None else res.boxes.cls.tolist()
            predicted[site] += sum(1 for c in classes if not args.dota or int(c) in DOTA_VEHICLES)

    rows = sorted(expected)
    if not rows:
        raise SystemExit("no validation tiles — run make_dataset.py first")
    errors = [predicted[s] - expected[s] for s in rows]
    within = [abs(e) <= 0.1 * expected[s] if expected[s] else predicted[s] == 0 for s, e in zip(rows, errors)]
    total = sum(expected.values()) or 1
    print(f"{'site':40} expected predicted")
    for s in rows:
        print(f"{s:40} {expected[s]:8} {predicted[s]:9}")
    print(f"\nsites {len(rows)}   count MAE {sum(map(abs, errors)) / len(rows):.1f}")
    print(f"bias {sum(errors) / total:+.1%}   within 10 %: {sum(within) / len(rows):.0%}")


if __name__ == "__main__":
    main()
