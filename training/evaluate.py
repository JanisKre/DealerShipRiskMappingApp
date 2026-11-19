"""Evaluate a model on the held-out validation sites.

Reports detection quality (mAP50 via Ultralytics) and — what the app
actually uses — per-site vehicle counts: MAE, signed bias, and the share of
sites within 10 % (same metrics as desktop-app/src/main/services/detection-benchmark.ts),
overall and per native imagery resolution. Hard-negative sites (select_negatives.py)
are left out of those metrics and reported as false detections per tile instead.

    python evaluate.py
    python evaluate.py --weights yolo11s-obb.pt --dota   # baseline: pretrained model as-is
    python evaluate.py --sweep                           # count metrics at several confidence thresholds
    python evaluate.py --sweep --json out.json           # …and write them as JSON (studio.py reads these)
    python evaluate.py --sites data/sites-added-2026-11-19.txt   # only these validation sites
    python evaluate.py --weights yolo11m-obb.pt --classes "small vehicle,large vehicle"   # any model, by class name
    python evaluate.py --weights yoloe-11s-seg.pt --prompt "car,van,truck"   # open-vocabulary model, text prompt

The count metrics come with 95 % intervals from a bootstrap over sites: with
20 sites, one badly counted lot moves the MAE a lot, and the interval says how
much. Metrics computed on a test set are only comparable between models
evaluated on the same sites.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
from collections import defaultdict
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import torch  # noqa: E402
from ultralytics import YOLO  # noqa: E402
from ultralytics.utils.metrics import batch_probiou  # noqa: E402
from ultralytics.utils.ops import xyxyxyxy2xywhr  # noqa: E402

from common import DATA, DATASET_YAML, RUNS, SANDBOX, is_negative_site, native_gsd, read_obb_labels, site_of  # noqa: E402

DOTA_VEHICLES = {9, 10}
BOOTSTRAP_ROUNDS = 2000


def count_metrics(expected: dict[str, int], pred: dict[str, int], sites: list[str]) -> tuple[float, float, float]:
    """(MAE, signed bias as share of all vehicles, share of sites within 10 %)."""
    total = sum(expected[s] for s in sites) or 1
    errors = [pred[s] - expected[s] for s in sites]
    within = [abs(e) <= 0.1 * expected[s] if expected[s] else pred[s] == 0 for s, e in zip(sites, errors)]
    return sum(map(abs, errors)) / len(sites), sum(errors) / total, sum(within) / len(sites)


def bootstrap(expected: dict[str, int], pred: dict[str, int], sites: list[str], rounds: int = BOOTSTRAP_ROUNDS, seed: int = 7) -> dict[str, list[float]]:
    """95 % percentile intervals of the count metrics, resampling whole sites."""
    rng = random.Random(seed)
    draws = [count_metrics(expected, pred, rng.choices(sites, k=len(sites))) for _ in range(rounds)]
    lo, hi = int(0.025 * rounds), int(0.975 * rounds) - 1
    return {name: [round(sorted(d[i] for d in draws)[lo], 4), round(sorted(d[i] for d in draws)[hi], 4)] for i, name in enumerate(("mae", "bias", "within10"))}


def greedy_matches(iou, scores: list[float], threshold: float, min_iou: float = 0.5) -> int:
    """True positives: predictions at or above `threshold`, best score first, each
    taking the unmatched label it overlaps most (at least `min_iou`)."""
    taken: set[int] = set()
    for i in sorted((i for i, sc in enumerate(scores) if sc >= threshold), key=lambda i: -scores[i]):
        best, best_iou = -1, min_iou
        for j, v in enumerate(iou[i]):
            if j not in taken and v >= best_iou:
                best, best_iou = j, v
        if best >= 0:
            taken.add(best)
    return len(taken)


def detection_quality(expected: dict[str, int], pred: dict[str, int], hits: dict[str, int], sites: list[str]) -> dict[str, float]:
    """Precision, recall and F1 at probIoU 0.5 over all tiles of `sites`: a count can be
    right by accident when misses and false detections cancel out; these cannot."""
    tp, n_pred, n_true = (sum(d[s] for s in sites) for d in (hits, pred, expected))
    precision = tp / n_pred if n_pred else 0.0
    recall = tp / n_true if n_true else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4)}


def as_xywhr(res):
    """Pixel boxes as (cx, cy, w, h, angle); axis-aligned models get angle 0."""
    if res.obb is not None:
        return res.obb.xywhr
    xywh = res.boxes.xywh
    return torch.cat([xywh, torch.zeros_like(xywh[:, :1])], dim=1)


def vehicle_ids(names: dict[int, str], wanted: str | None, dota: bool) -> set[int] | None:
    """Class ids counted as vehicles; None counts every class (our own models)."""
    if dota:
        return set(DOTA_VEHICLES)
    if not wanted:
        return None
    lookup = {n.lower(): i for i, n in names.items()}
    picked = [w.strip().lower() for w in wanted.split(",") if w.strip()]
    missing = [w for w in picked if w not in lookup]
    if missing:
        raise SystemExit(f"classes {missing} not in the model; it has {sorted(lookup)}")
    return {lookup[w] for w in picked}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", default=str(RUNS / "dealer-obb" / "weights" / "best.pt"))
    ap.add_argument("--dota", action="store_true", help="weights use DOTA classes (baseline)")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--sweep", action="store_true", help="count metrics for several thresholds instead of per-site rows")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--json", help="also write the results to this JSON file")
    ap.add_argument("--classes", help="comma-separated class names counted as vehicles (other models; default: every class)")
    ap.add_argument("--prompt", help="comma-separated text prompts for an open-vocabulary model (YOLOE, YOLO-World); all are counted")
    ap.add_argument("--sites", help="file with validation site ids (one per line); count metrics only for these")
    ap.add_argument("--no-map", action="store_true", help="skip mAP (needs the model's classes to match ours)")
    ap.add_argument("--thresholds", help="comma-separated thresholds for --sweep (default 0.15–0.65)")
    ap.add_argument("--batch", type=int, default=16, help="tiles per predict call (1 for ONNX files exported with a fixed batch)")
    ap.add_argument("--split", choices=["val", "test"], default="val", help="test: the held-out test sites (data/test_sites.txt)")
    args = ap.parse_args()

    model = YOLO(args.weights)
    if args.prompt:
        model.set_classes([p.strip() for p in args.prompt.split(",") if p.strip()])
    counted = vehicle_ids(model.names, args.classes, args.dota)
    report: dict = {
        "weights": args.weights,
        "date": dt.datetime.now().isoformat(timespec="seconds"),
        "imgsz": args.imgsz,
        "classes": args.classes or ("small vehicle,large vehicle" if args.dota else None),
        "prompt": args.prompt,
        "siteFilter": args.sites,
        "map50": None,
        "map50_95": None,
    }
    if not (args.dota or args.classes or args.prompt or args.no_map):
        # In a sandbox the validation plots stay in its runs/ too (default: Ultralytics' runs/obb).
        where = {"project": str(RUNS), "name": "val", "exist_ok": True} if SANDBOX else {}
        metrics = model.val(data=str(DATASET_YAML), split=args.split, imgsz=args.imgsz, device=args.device, verbose=False, **where)
        print(f"mAP50 {metrics.box.map50:.3f}   mAP50-95 {metrics.box.map:.3f}")
        report["map50"], report["map50_95"] = round(float(metrics.box.map50), 4), round(float(metrics.box.map), 4)

    images = sorted((DATA / "dataset" / "images" / args.split).glob("*.jpg"))
    labels_dir = DATA / "dataset" / "labels" / args.split
    report["split"] = args.split
    sweep = [float(t) for t in args.thresholds.split(",")] if args.thresholds else [0.15, 0.25, 0.35, 0.45, 0.55, 0.65]
    thresholds = sweep if args.sweep else [args.conf]
    expected: dict[str, int] = defaultdict(int)
    tiles: dict[str, int] = defaultdict(int)
    predicted: dict[float, dict[str, int]] = {t: defaultdict(int) for t in thresholds}
    matched: dict[float, dict[str, int]] = {t: defaultdict(int) for t in thresholds}
    # Tiles overlap only within public data; dealership tiles are a disjoint
    # grid, so summing tile counts per site gives the site count.
    for i in range(0, len(images), args.batch):
        batch = images[i : i + args.batch]
        for path, res in zip(batch, model.predict(batch, imgsz=args.imgsz, conf=min(thresholds), device=args.device, verbose=False)):
            site = site_of(path)
            tiles[site] += 1
            truth = read_obb_labels(labels_dir / f"{path.stem}.txt")
            expected[site] += len(truth)
            part = res.obb if res.obb is not None else res.boxes
            keep = [k for k, c in enumerate(part.cls.tolist()) if counted is None or int(c) in counted]
            scores = [part.conf.tolist()[k] for k in keep]
            for t in thresholds:
                predicted[t][site] += sum(sc >= t for sc in scores)
            if truth and keep:
                h, w = res.orig_shape
                corners = torch.tensor([c for _, c in truth], dtype=torch.float32).view(-1, 4, 2) * torch.tensor([w, h])
                iou = batch_probiou(as_xywhr(res)[keep].float().cpu(), xyxyxyxy2xywhr(corners.view(-1, 8))).tolist()
                for t in thresholds:
                    matched[t][site] += greedy_matches(iou, scores, t)

    negatives = sorted(s for s in expected if is_negative_site(s))
    rows = sorted(s for s in expected if not is_negative_site(s))
    if args.sites:
        wanted = set(Path(args.sites).read_text().split())
        absent = wanted - set(rows)
        if absent:
            print(f"note: {len(absent)} listed sites are not validation sites and are left out")
        rows = [s for s in rows if s in wanted]
        negatives = []
    if not rows:
        raise SystemExit(f"no {args.split} tiles — finish those sites, then run make_dataset.py")

    def summary(pred: dict[str, int], sites: list[str]) -> tuple[float, float, float]:
        return count_metrics(expected, pred, sites)

    def false_per_tile(pred: dict[str, int]) -> float:
        """Detections beyond the labelled vehicles on negative tiles, per tile."""
        n = sum(tiles[s] for s in negatives)
        return sum(max(0, pred[s] - expected[s]) for s in negatives) / n if n else 0.0

    by_gsd: dict[float | None, list[str]] = defaultdict(list)
    for s in rows:
        by_gsd[native_gsd(s)].append(s)

    report["sites"] = len(rows)
    report["vehicles"] = sum(expected[s] for s in rows)
    report["thresholds"] = []
    for t in thresholds:
        mae, bias, within = summary(predicted[t], rows)
        report["thresholds"].append(
            {
                "conf": t,
                "mae": round(mae, 2),
                "bias": round(bias, 4),
                "within10": round(within, 4),
                "ci95": bootstrap(expected, predicted[t], rows),
                **detection_quality(expected, predicted[t], matched[t], rows),
                "negFpPerTile": round(false_per_tile(predicted[t]), 3) if negatives else None,
            }
        )
    report["perSite"] = {
        s: {"expected": expected[s], "predicted": {str(t): predicted[t][s] for t in thresholds}, "matched": {str(t): matched[t][s] for t in thresholds}} for s in rows
    }
    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps(report, indent=1) + "\n")

    if args.sweep:
        neg_col = f" {'neg FP/tile':>12}" if negatives else ""
        print(f"sites {len(rows)}, vehicles {report['vehicles']}")
        print(f"{'conf':>6} {'MAE':>7} {'95 % MAE':>12} {'bias':>8} {'within 10 %':>12} {'prec':>6} {'recall':>6} {'F1':>6}{neg_col}")
        for t, row in zip(thresholds, report["thresholds"]):
            lo, hi = row["ci95"]["mae"]
            neg = f" {false_per_tile(predicted[t]):12.2f}" if negatives else ""
            print(f"{t:6.2f} {row['mae']:7.1f} {f'{lo:.1f}–{hi:.1f}':>12} {row['bias']:+8.1%} {row['within10']:12.0%} {row['precision']:6.1%} {row['recall']:6.1%} {row['f1']:6.3f}{neg}")
        return
    pred = predicted[args.conf]
    print(f"{'site':40} expected predicted")
    for s in rows + negatives:
        print(f"{s:40} {expected[s]:8} {pred[s]:9}")
    mae, bias, within = summary(pred, rows)
    ci = bootstrap(expected, pred, rows)
    print(f"\nsites {len(rows)}   count MAE {mae:.1f}  (95 % {ci['mae'][0]:.1f}–{ci['mae'][1]:.1f})")
    print(f"bias {bias:+.1%}   within 10 %: {within:.0%}  (95 % {ci['within10'][0]:.0%}–{ci['within10'][1]:.0%})")
    if len(by_gsd) > 1:
        for gsd in sorted(by_gsd, key=lambda g: (g is None, g)):
            mae, bias, within = summary(pred, by_gsd[gsd])
            label = f"native {gsd:.2f} m" if gsd is not None else "native unknown"
            print(f"  {label:15} sites {len(by_gsd[gsd]):3}   MAE {mae:6.1f}   bias {bias:+7.1%}   within 10 % {within:4.0%}")
    if negatives:
        print(f"negatives {len(negatives)} sites   false detections per tile {false_per_tile(pred):.2f}")


if __name__ == "__main__":
    main()
