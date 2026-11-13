"""Where does the model go wrong? Misses and false detections on the validation sites, by type.

    python analyze_errors.py                       # current model at the app's base confidence
    python analyze_errors.py --weights runs/dealer-obb-pseudo/weights/best.pt --conf 0.45
    python analyze_errors.py --sheets              # also crop sheets of every error to look at

Each error gets the tags that apply:

* `edge`  - the box touches the tile border (vehicle cut by the tile)
* `dark`  - dark inside the box: shadow, black car, under trees
* `large` - labelled as large vehicle (van, truck, bus)
* `small` - shorter than 3.6 m (labelled) or detected
* `dense` - another vehicle within 1 m (tight parking rows)

The tags show which kind of tile to label next. A false detection may also
be a vehicle your labels miss (see `review.py --audit`), so read the FP
sheets before trusting the FP numbers.
"""

from __future__ import annotations

import argparse
import math
import os
from collections import Counter, defaultdict

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402
from ultralytics import YOLO  # noqa: E402

from autolabel import DEFAULT_WEIGHTS, match, val_sites  # noqa: E402
from common import DATA, RAW, TARGET_GSD_M, TILE_PX, corrected_labels, site_of  # noqa: E402

ERRORS = DATA / "errors"
EDGE_PX = 3
DARK_LUMA = 60
SMALL_M = 3.6
DENSE_M = 1.0
TAGS = ("edge", "dark", "large", "small", "dense")


def luma_in(img: np.ndarray, corners) -> float:
    mask = Image.new("L", (TILE_PX, TILE_PX), 0)
    ImageDraw.Draw(mask).polygon([tuple(p) for p in corners], fill=1)
    m = np.asarray(mask, dtype=bool)
    if not m.any():
        return 255.0
    rgb = img[m]
    return float((0.299 * rgb[:, 0] + 0.587 * rgb[:, 1] + 0.114 * rgb[:, 2]).mean())


def length_m(corners) -> float:
    (x0, y0), (x1, y1), (x2, y2) = corners[:3]
    return max(math.hypot(x1 - x0, y1 - y0), math.hypot(x2 - x1, y2 - y1)) * TARGET_GSD_M


def gap_px(a, b) -> float:
    """Smallest corner-to-corner distance, a cheap stand-in for the gap between two boxes."""
    return min(math.dist(p, q) for p in a for q in b)


def tags_of(corners, cls: int, img: np.ndarray, neighbours) -> list[str]:
    c = np.array(corners)
    out = []
    if c.min() <= EDGE_PX or c.max() >= TILE_PX - EDGE_PX:
        out.append("edge")
    if luma_in(img, corners) < DARK_LUMA:
        out.append("dark")
    if cls == 1:
        out.append("large")
    if length_m(corners) < SMALL_M:
        out.append("small")
    if any(gap_px(corners, n) * TARGET_GSD_M < DENSE_M for n in neighbours if n is not corners):
        out.append("dense")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    ap.add_argument("--conf", type=float, default=0.45, help="base confidence (the app's default for this model)")
    ap.add_argument("--sheets", action="store_true", help="write crop sheets of the errors to data/errors/")
    ap.add_argument("--device", default="mps")
    args = ap.parse_args()

    sites = val_sites()
    images = sorted(p for p in (DATA / "dataset" / "images" / "val").glob("*.jpg") if site_of(p) in sites)
    if not images:
        raise SystemExit("no validation tiles — run make_dataset.py first")
    model = YOLO(args.weights)
    counts = {"tp": 0, "fn": Counter(), "fp": Counter(), "fn_n": 0, "fp_n": 0, "gt_tags": Counter()}
    per_site: dict[str, Counter] = defaultdict(Counter)
    examples: dict[str, list] = {"fn": [], "fp": []}
    for i in range(0, len(images), 16):
        batch = images[i : i + 16]
        for path, res in zip(batch, model.predict(batch, imgsz=TILE_PX, conf=args.conf, device=args.device, verbose=False)):
            img = np.asarray(Image.open(RAW / path.name).convert("RGB"))
            gt = corrected_labels(RAW / path.name)
            gt_corners = [[list(p) for p in c] for _, c in gt]
            pred, pred_cls = [], []
            if res.obb is not None and len(res.obb):
                order = np.argsort(-res.obb.conf.cpu().numpy())
                pred = res.obb.xyxyxyxy.cpu().numpy()[order].tolist()
                pred_cls = res.obb.cls.cpu().numpy().astype(int)[order].tolist()
            hits = match(pred, gt_corners)
            matched_gt = {j for j in hits if j >= 0}
            site = site_of(path)
            for j, (cls, corners) in enumerate(zip([c for c, _ in gt], gt_corners)):
                t = tags_of(corners, cls, img, gt_corners)
                counts["gt_tags"].update(t)
                if j in matched_gt:
                    counts["tp"] += 1
                    continue
                counts["fn_n"] += 1
                counts["fn"].update(t or ["other"])
                per_site[site]["fn"] += 1
                examples["fn"].append((path.stem, corners, "+".join(t) or "other"))
            for corners, cls, j in zip(pred, pred_cls, hits):
                if j >= 0:
                    continue
                t = tags_of(corners, cls, img, pred)
                counts["fp_n"] += 1
                counts["fp"].update(t or ["other"])
                per_site[site]["fp"] += 1
                examples["fp"].append((path.stem, corners, "+".join(t) or "other"))

    n_gt = counts["tp"] + counts["fn_n"]
    print(f"{len(images)} tiles, {n_gt} labelled vehicles, conf {args.conf}")
    print(f"found {counts['tp']} ({counts['tp'] / max(1, n_gt):.1%}), missed {counts['fn_n']}, false {counts['fp_n']}\n")
    print(f"{'tag':8} {'labelled':>9} {'missed':>7} {'miss rate':>10} {'false':>6}")
    for tag in TAGS + ("other",):
        total = counts["gt_tags"][tag]
        rate = f"{counts['fn'][tag] / total:10.1%}" if total else f"{'–':>10}"
        print(f"{tag:8} {total:9} {counts['fn'][tag]:7} {rate} {counts['fp'][tag]:6}")
    print("\n(tags overlap; 'other' = an error with no tag)")
    print(f"\n{'site':24} {'missed':>7} {'false':>6}")
    for site in sorted(per_site, key=lambda s: -(per_site[s]["fn"] + per_site[s]["fp"])):
        print(f"{site:24} {per_site[site]['fn']:7} {per_site[site]['fp']:6}")

    if args.sheets:
        from claude_review import COLS, CELL_PX, PER_SHEET, crop_cell

        ERRORS.mkdir(parents=True, exist_ok=True)
        for kind, items in examples.items():
            for old in ERRORS.glob(f"{kind}_*.png"):
                old.unlink()
            for s in range(0, len(items), PER_SHEET):
                chunk = items[s : s + PER_SHEET]
                rows = -(-len(chunk) // COLS)
                sheet = Image.new("RGB", (COLS * (CELL_PX + 4), rows * (CELL_PX + 4)), (255, 255, 255))
                for n, (stem, corners, _) in enumerate(chunk, 1):
                    tile = Image.open(RAW / f"{stem}.jpg").convert("RGB")
                    sheet.paste(crop_cell(tile, corners, n), (((n - 1) % COLS) * (CELL_PX + 4), ((n - 1) // COLS) * (CELL_PX + 4)))
                sheet.save(ERRORS / f"{kind}_{s // PER_SHEET + 1:03}.png")
                (ERRORS / f"{kind}_{s // PER_SHEET + 1:03}.txt").write_text(
                    "\n".join(f"{n} {stem} {tag}" for n, (stem, _, tag) in enumerate(chunk, 1)) + "\n"
                )
        print(f"\nerror sheets in {ERRORS} (fn_* = missed, fp_* = false; the .txt lists tile and tags per crop)")


if __name__ == "__main__":
    main()
