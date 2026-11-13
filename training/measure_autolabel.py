"""How much work would autolabel.py + review.py have left you on sites you already labelled?

    python autolabel.py --eval && python measure_autolabel.py
    python measure_autolabel.py --grid      # also try other bucket thresholds

Compares the buckets in data/autolabel-eval/ with your corrected labels of the
validation sites (the model has not trained on them) and reports:

* precision of every bucket - how often a `sure` box is wrong decides whether
  auto-accepting is safe
* where your vehicles ended up - sure / check / candidate / not found at all
* your work per tile: yes/no answers plus vehicles you would still add by hand,
  next to what correcting today's suggestions in data/labels/ costs
  (deleting wrong boxes plus drawing missed ones)
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import replace
from pathlib import Path

from autolabel import AUTOLABEL_EVAL, BUCKETS, Buckets, match, read_tile
from common import RAW, corrected_labels


def load(eval_dir: Path):
    tiles = []
    for path in sorted(eval_dir.glob("*.json")):
        tile = read_tile(path)
        image = RAW / tile["image"]
        gt = corrected_labels(image)
        model_boxes = [b for b in tile["boxes"] if b.get("origin") == "model"]
        matched = match([b["corners"] for b in model_boxes], [c for _, c in gt])
        tiles.append((image, model_boxes, matched, gt))
    return tiles


def report(tiles, buckets: Buckets, verbose: bool) -> dict:
    per_bucket = Counter()
    per_bucket_tp = Counter()
    class_errors = 0
    gt_total = 0
    gt_where = Counter()
    for _, boxes, matched, gt in tiles:
        gt_total += len(gt)
        found = {}
        for b, j in zip(boxes, matched):
            bucket = buckets.of(b["score"], b["votes"])
            if bucket is None:
                continue
            per_bucket[bucket] += 1
            if j >= 0:
                per_bucket_tp[bucket] += 1
                found[j] = bucket
                if bucket == "sure" and gt[j][0] != b["cls"]:
                    class_errors += 1
        for j in range(len(gt)):
            gt_where[found.get(j, "missed")] += 1
    n_tiles = len(tiles)
    questions = per_bucket["check"] + per_bucket["candidate"]
    sure_wrong = per_bucket["sure"] - per_bucket_tp["sure"]
    result = {
        "questions": questions / n_tiles,
        "manual": gt_where["missed"] / n_tiles,
        "sure_wrong": sure_wrong,
        "sure_precision": per_bucket_tp["sure"] / max(1, per_bucket["sure"]),
        "auto_share": gt_where["sure"] / max(1, gt_total),
    }
    if verbose:
        print(f"{n_tiles} tiles, {gt_total} labelled vehicles\n")
        print(f"{'bucket':10} {'boxes':>6} {'correct':>8} {'precision':>10}")
        for name in ("sure", "check", "candidate"):
            n, tp = per_bucket[name], per_bucket_tp[name]
            print(f"{name:10} {n:6} {tp:8} {tp / max(1, n):10.1%}")
        print(f"\nwhere your vehicles ended up:")
        for name in ("sure", "check", "candidate", "missed"):
            print(f"  {name:10} {gt_where[name]:6}  {gt_where[name] / max(1, gt_total):6.1%}")
        print(f"\nsure boxes with the wrong class (car / large_vehicle): {class_errors}")
        print(f"wrong sure boxes you must spot on the tile check: {sure_wrong} ({sure_wrong / n_tiles:.2f} per tile)")
    return result


def baseline(tiles, device: str) -> tuple[float, float, float]:
    """Round 1 of today's workflow: correct prelabel.py's DOTA suggestions → deletions + drawings per tile."""
    from ultralytics import YOLO

    from prelabel import DOTA_TO_OURS

    model = YOLO("yolo11s-obb.pt")
    deletions = drawings = 0
    for image, _, _, gt in tiles:
        res = model.predict(str(image), imgsz=448, conf=0.15, device=device, verbose=False)[0]
        sugg = []
        if res.obb is not None:
            for cls, poly in zip(res.obb.cls.cpu().numpy().astype(int), res.obb.xyxyxyxy.cpu().numpy()):
                if cls in DOTA_TO_OURS:
                    sugg.append(poly.tolist())
        matched = match(sugg, [c for _, c in gt])
        deletions += sum(1 for j in matched if j < 0)
        drawings += len(gt) - sum(1 for j in matched if j >= 0)
    n = len(tiles)
    return deletions / n, drawings / n, (deletions + drawings) / n


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=str(AUTOLABEL_EVAL))
    ap.add_argument("--grid", action="store_true", help="try other bucket thresholds")
    ap.add_argument("--device", default="mps")
    args = ap.parse_args()

    tiles = load(Path(args.dir))
    if not tiles:
        raise SystemExit("nothing to measure — run autolabel.py --eval first")
    r = report(tiles, BUCKETS, verbose=True)
    d, a, total = baseline(tiles, args.device)
    print("\nyour work per tile")
    print(f"  with autolabel + review: {r['questions']:.1f} yes/no answers + {r['manual']:.1f} vehicles to add by hand")
    print(f"  round 1 today (DOTA suggestions): {d:.1f} deletions + {a:.1f} vehicles to draw = {total:.1f} edits")
    if not args.grid:
        return
    # Votes barely matter: a mean score ≥ 0.45 over 8 passes already needs most passes.
    print(f"\n{'sure ≥':>7} {'cand ≥':>7} {'auto':>6} {'sure prec':>10} {'wrong/tile':>11} {'yes/no':>7} {'by hand':>8}")
    for sure_score in (0.45, 0.5, 0.55, 0.6, 0.65):
        for cand in (0.08, 0.12, 0.16):
            b = replace(BUCKETS, sure_score=sure_score, candidate_score=cand)
            g = report(tiles, b, verbose=False)
            print(
                f"{sure_score:7.2f} {cand:7.2f} {g['auto_share']:6.1%} "
                f"{g['sure_precision']:10.1%} {g['sure_wrong'] / len(tiles):11.2f} {g['questions']:7.1f} {g['manual']:8.1f}"
            )


if __name__ == "__main__":
    main()
