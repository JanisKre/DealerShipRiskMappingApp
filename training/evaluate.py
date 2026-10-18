"""Evaluate a model on the held-out validation sites.

Reports detection quality (mAP50 via Ultralytics) and — what the app
actually uses — per-site vehicle counts: MAE, signed bias, and the share of
sites within 10 % (same metrics as desktop-app/src/main/services/detection-benchmark.ts),
overall and per native imagery resolution. Hard-negative sites (select_negatives.py)
are left out of those metrics and reported as false detections per tile instead.

    python evaluate.py
    python evaluate.py --weights yolo11s-obb.pt --dota   # baseline: pretrained model as-is
    python evaluate.py --sweep                           # count metrics at several confidence thresholds
"""

from __future__ import annotations

import argparse
import os
from collections import defaultdict
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

from ultralytics import YOLO  # noqa: E402

from common import DATA, ROOT, is_negative_site, native_gsd, read_obb_labels, site_of  # noqa: E402

DOTA_VEHICLES = {9, 10}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", default=str(ROOT / "runs" / "dealer-obb" / "weights" / "best.pt"))
    ap.add_argument("--dota", action="store_true", help="weights use DOTA classes (baseline)")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--sweep", action="store_true", help="count metrics for several thresholds instead of per-site rows")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default="mps")
    args = ap.parse_args()

    model = YOLO(args.weights)
    if not args.dota:
        metrics = model.val(data=str(ROOT / "dataset.yaml"), imgsz=args.imgsz, device=args.device, verbose=False)
        print(f"mAP50 {metrics.box.map50:.3f}   mAP50-95 {metrics.box.map:.3f}")

    images = sorted((DATA / "dataset" / "images" / "val").glob("*.jpg"))
    labels_dir = DATA / "dataset" / "labels" / "val"
    thresholds = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65] if args.sweep else [args.conf]
    expected: dict[str, int] = defaultdict(int)
    tiles: dict[str, int] = defaultdict(int)
    predicted: dict[float, dict[str, int]] = {t: defaultdict(int) for t in thresholds}
    # Tiles overlap only within public data; dealership tiles are a disjoint
    # grid, so summing tile counts per site gives the site count.
    for i in range(0, len(images), 16):
        batch = images[i : i + 16]
        for path, res in zip(batch, model.predict(batch, imgsz=args.imgsz, conf=min(thresholds), device=args.device, verbose=False)):
            site = site_of(path)
            tiles[site] += 1
            expected[site] += len(read_obb_labels(labels_dir / f"{path.stem}.txt"))
            part = res.obb if res.obb is not None else res.boxes
            for c, score in zip(part.cls.tolist(), part.conf.tolist()):
                if not args.dota or int(c) in DOTA_VEHICLES:
                    for t in thresholds:
                        predicted[t][site] += score >= t

    negatives = sorted(s for s in expected if is_negative_site(s))
    rows = sorted(s for s in expected if not is_negative_site(s))
    if not rows:
        raise SystemExit("no validation tiles — run make_dataset.py first")

    def summary(pred: dict[str, int], sites: list[str]) -> tuple[float, float, float]:
        total = sum(expected[s] for s in sites) or 1
        errors = [pred[s] - expected[s] for s in sites]
        within = [abs(e) <= 0.1 * expected[s] if expected[s] else pred[s] == 0 for s, e in zip(sites, errors)]
        return sum(map(abs, errors)) / len(sites), sum(errors) / total, sum(within) / len(sites)

    def false_per_tile(pred: dict[str, int]) -> float:
        """Detections beyond the labelled vehicles on negative tiles, per tile."""
        n = sum(tiles[s] for s in negatives)
        return sum(max(0, pred[s] - expected[s]) for s in negatives) / n if n else 0.0

    by_gsd: dict[float | None, list[str]] = defaultdict(list)
    for s in rows:
        by_gsd[native_gsd(s)].append(s)

    if args.sweep:
        neg_col = f" {'neg FP/tile':>12}" if negatives else ""
        print(f"{'conf':>6} {'MAE':>7} {'bias':>8} {'within 10 %':>12}{neg_col}")
        for t in thresholds:
            mae, bias, within = summary(predicted[t], rows)
            neg = f" {false_per_tile(predicted[t]):12.2f}" if negatives else ""
            print(f"{t:6.2f} {mae:7.1f} {bias:+8.1%} {within:12.0%}{neg}")
        return
    pred = predicted[args.conf]
    print(f"{'site':40} expected predicted")
    for s in rows + negatives:
        print(f"{s:40} {expected[s]:8} {pred[s]:9}")
    mae, bias, within = summary(pred, rows)
    print(f"\nsites {len(rows)}   count MAE {mae:.1f}")
    print(f"bias {bias:+.1%}   within 10 %: {within:.0%}")
    if len(by_gsd) > 1:
        for gsd in sorted(by_gsd, key=lambda g: (g is None, g)):
            mae, bias, within = summary(pred, by_gsd[gsd])
            label = f"native {gsd:.2f} m" if gsd is not None else "native unknown"
            print(f"  {label:15} sites {len(by_gsd[gsd]):3}   MAE {mae:6.1f}   bias {bias:+7.1%}   within 10 % {within:4.0%}")
    if negatives:
        print(f"negatives {len(negatives)} sites   false detections per tile {false_per_tile(pred):.2f}")


if __name__ == "__main__":
    main()
