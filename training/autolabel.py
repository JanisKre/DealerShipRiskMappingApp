"""Pre-label tiles with your own model, eight times per tile, and sort every box by how sure it is.

    python autolabel.py                          # unfinished sites in data/raw
    python autolabel.py --sites BY-osm296363718  # only these sites
    python autolabel.py --eval                   # validation sites, for measure_autolabel.py
    python autolabel.py --audit                  # finished sites: boxes without a label of yours

Each tile is predicted in its 8 orientations (4 rotations x mirrored) and the
boxes are mapped back and merged. A vehicle found in 8 of 8 passes with a high
score is almost certainly real; one found in 3 of 8 is a question for you.
Every merged box lands in one bucket:

* `sure`      - accepted without asking; you still see it on the tile check
* `check`     - you answer yes/no in review.py
* `candidate` - weak hit, possibly a vehicle the model nearly missed; yes/no too

Writes `data/autolabel/<tile>.json` (`data/autolabel-eval/` with --eval).
With --audit, finished sites are checked against your labels: model boxes no
label covers (a vehicle you may have missed) and labels no model box supports
at all (a box on empty ground) become questions in `data/autolabel-audit/`
for `review.py --audit`.
Decisions you make in review.py are stored in the same file. Re-running keeps
those decisions for boxes that are still found, unless --reset.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402
from ultralytics import YOLO  # noqa: E402
from ultralytics.utils.metrics import batch_probiou  # noqa: E402
from ultralytics.utils.ops import xyxyxyxy2xywhr  # noqa: E402

from common import CLASS_NAMES, DATA, RAW, ROOT, TILE_PX, corrected_labels, reviewed_sites, site_of  # noqa: E402

from tiles import (  # noqa: E402,F401 — re-exported for claude_review.py, harvest_app.py, measure_autolabel.py, analyze_errors.py
    AUTOLABEL,
    AUTOLABEL_AUDIT,
    AUTOLABEL_EVAL,
    FORMAT_VERSION,
    accepted_boxes,
    box_key,
    open_questions,
    read_tile,
    val_sites,
)

DEFAULT_WEIGHTS = ROOT / "runs" / "dealer-obb" / "weights" / "best.pt"

PASSES = 8
# Lowest score any single pass reports; weaker hits are noise.
PASS_CONF = 0.05
# Two boxes of different passes are the same vehicle above this overlap.
MATCH_IOU = 0.5


@dataclass(frozen=True)
class Buckets:
    """Bucket rules on the merged score (mean over all 8 passes, a missed pass counts 0)."""

    sure_score: float = 0.55
    sure_votes: int = 7
    check_score: float = 0.25
    candidate_score: float = 0.12

    def of(self, score: float, votes: int) -> str | None:
        if score >= self.sure_score and votes >= self.sure_votes:
            return "sure"
        if score >= self.check_score:
            return "check"
        if score >= self.candidate_score:
            return "candidate"
        return None


BUCKETS = Buckets()


# --- the eight orientations ---------------------------------------------------


def transform(img: np.ndarray, k: int, flip: bool) -> np.ndarray:
    """Pass image: mirrored left-right first (if flip), then rotated k x 90 deg counter-clockwise."""
    out = img[:, ::-1] if flip else img
    return np.ascontiguousarray(np.rot90(out, k))


def untransform_points(pts: np.ndarray, k: int, flip: bool, size: int) -> np.ndarray:
    """Maps pixel coordinates of a pass image back to the original tile (square tiles only)."""
    x, y = pts[..., 0].copy(), pts[..., 1].copy()
    for _ in range(k):  # undo one counter-clockwise turn: x = size - y', y = x'
        x, y = size - y, x
    if flip:
        x = size - x
    return np.stack([x, y], axis=-1)


ORIENTATIONS = [(k, flip) for flip in (False, True) for k in range(4)]


# --- merging the passes -------------------------------------------------------


def merge_passes(per_pass: list[tuple[np.ndarray, np.ndarray, np.ndarray]]) -> list[dict]:
    """Clusters the boxes of all passes. per_pass: (corners Nx4x2, scores N, classes N) per pass.

    Greedy by score: a box joins the first cluster it overlaps (probabilistic IoU of
    the rotated boxes), at most one box per pass and cluster. The cluster keeps the
    shape of its best box, its score is the mean of the best score per pass.
    """
    items = []
    for p, (corners, scores, classes) in enumerate(per_pass):
        for c, s, k in zip(corners, scores, classes):
            items.append((float(s), p, int(k), c))
    if not items:
        return []
    items.sort(key=lambda t: -t[0])
    xywhr = xyxyxyxy2xywhr(torch.tensor(np.stack([t[3].reshape(8) for t in items]), dtype=torch.float32))
    iou = batch_probiou(xywhr, xywhr).numpy()

    clusters: list[dict] = []
    owner = [-1] * len(items)
    for i, (score, p, cls, corners) in enumerate(items):
        joined = False
        for ci, cl in enumerate(clusters):
            if iou[i, cl["anchor"]] >= MATCH_IOU:
                if p not in cl["passes"]:
                    cl["passes"][p] = score
                    cl["cls_votes"][cls] = cl["cls_votes"].get(cls, 0.0) + score
                joined = True  # a second box of the same pass is a duplicate; drop it
                owner[i] = ci
                break
        if not joined:
            clusters.append({"anchor": i, "corners": corners, "passes": {p: score}, "cls_votes": {cls: score}})
            owner[i] = len(clusters) - 1

    out = []
    for cl in clusters:
        score = sum(cl["passes"].values()) / PASSES
        out.append(
            {
                "cls": max(cl["cls_votes"], key=cl["cls_votes"].get),
                "corners": [[round(float(x), 2), round(float(y), 2)] for x, y in cl["corners"]],
                "score": round(score, 4),
                "votes": len(cl["passes"]),
                "best": round(max(cl["passes"].values()), 4),
            }
        )
    return out


def predict_tile(model: YOLO, image: Path, device: str, imgsz: int) -> list[dict]:
    img = cv2.imread(str(image))  # BGR, as Ultralytics expects for arrays
    if img is None or img.shape[0] != img.shape[1]:
        raise SystemExit(f"{image.name}: not a square tile")
    size = img.shape[0]
    batch = [transform(img, k, flip) for k, flip in ORIENTATIONS]
    per_pass = []
    for (k, flip), res in zip(ORIENTATIONS, model.predict(batch, imgsz=imgsz, conf=PASS_CONF, device=device, verbose=False)):
        if res.obb is None or len(res.obb) == 0:
            per_pass.append((np.zeros((0, 4, 2)), np.zeros(0), np.zeros(0)))
            continue
        corners = untransform_points(res.obb.xyxyxyxy.cpu().numpy(), k, flip, size)
        per_pass.append((corners, res.obb.conf.cpu().numpy(), res.obb.cls.cpu().numpy().astype(int)))
    return merge_passes(per_pass)


def match(pred: list, gt: list, thr: float = MATCH_IOU) -> list[int]:
    """Greedy one-to-one matching of corner lists (pred sorted by score); the gt index per pred or -1."""
    if not pred or not gt:
        return [-1] * len(pred)

    def as_xywhr(boxes):
        return xyxyxyxy2xywhr(torch.tensor(np.array(boxes, dtype=np.float32).reshape(len(boxes), 8)))

    iou = batch_probiou(as_xywhr(pred), as_xywhr(gt)).numpy()
    taken: set[int] = set()
    out = []
    for i in range(len(pred)):
        j = next((int(j) for j in np.argsort(-iou[i]) if iou[i, j] >= thr and int(j) not in taken), -1)
        if j >= 0:
            taken.add(j)
        out.append(j)
    return out


# Audit: a model box overlapping a label this much is the same vehicle, slightly
# differently drawn — not a question.
AUDIT_MATCH_IOU = 0.2


def audit_boxes(image: Path, boxes: list[dict], buckets: Buckets) -> list[dict]:
    """Questions for a finished tile: model boxes no label covers, and labels no model box supports."""
    labels = corrected_labels(image)
    corners = [c for _, c in labels]
    hits = match([b["corners"] for b in boxes], corners, AUDIT_MATCH_IOU)
    # Only confident boxes: on the validation sites about 3 in 4 unlabelled `sure` boxes
    # were real vehicles, while weaker ones are mostly not (measure_autolabel.py).
    questions = [b for b, j in zip(boxes, hits) if j < 0 and b["score"] >= buckets.sure_score]
    # Labels the model does not see even weakly (any pass, any score) are worth a second look.
    support = match(corners, [b["corners"] for b in boxes], AUDIT_MATCH_IOU) if boxes else [-1] * len(labels)
    for j, ((cls, pts), s) in enumerate(zip(labels, support)):
        if s < 0:
            questions.append({"origin": "label", "labelIndex": j, "cls": cls, "corners": [[round(x, 2), round(y, 2)] for x, y in pts], "score": 0.0, "votes": 0, "best": 0.0})
    return questions


# --- per-tile files -----------------------------------------------------------


def write_tile(out_dir: Path, image: Path, boxes: list[dict], weights: str, buckets: Buckets, reset: bool, audit: bool = False) -> dict:
    path = out_dir / f"{image.stem}.json"
    old = {} if reset or not path.exists() else json.loads(path.read_text())
    previous = {(b.get("origin"), box_key(b["corners"])): b for b in old.get("boxes", []) if b.get("origin") in ("model", "label")}
    kept_boxes = [b for b in old.get("boxes", []) if b.get("origin") == "manual"]  # boxes you added by hand
    rows = []
    for b in boxes:
        bucket = "check" if audit else buckets.of(b["score"], b["votes"])
        if bucket is None:
            continue
        before = previous.get((b.get("origin", "model"), box_key(b["corners"])), {})
        rows.append(
            {
                **b,
                "origin": b.get("origin", "model"),
                "bucket": bucket,
                "decision": before.get("decision"),
                "decidedBy": before.get("decidedBy"),
                "claude": before.get("claude"),
            }
        )
    rows.sort(key=lambda r: -r["score"])
    all_boxes = rows + kept_boxes
    for i, r in enumerate(all_boxes):
        r["id"] = i
    data = {
        "formatVersion": FORMAT_VERSION,
        "image": image.name,
        "size": TILE_PX,
        "weights": weights,
        "buckets": buckets.__dict__,
        "classes": {str(k): v for k, v in CLASS_NAMES.items()},
        "done": bool(old.get("done")) and not reset,
        "boxes": all_boxes,
    }
    path.write_text(json.dumps(data, indent=1))
    return data


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    ap.add_argument("--sites", nargs="*", help="only these site ids")
    ap.add_argument("--eval", action="store_true", help="label the validation sites into data/autolabel-eval/")
    ap.add_argument("--audit", action="store_true", help="look for vehicles missing in finished sites → data/autolabel-audit/")
    ap.add_argument("--reset", action="store_true", help="forget earlier decisions for the labelled tiles")
    ap.add_argument("--imgsz", type=int, default=TILE_PX)
    ap.add_argument("--device", default="mps")
    args = ap.parse_args()

    if not Path(args.weights).exists():
        raise SystemExit(f"weights not found: {args.weights} — train a model first (train.py)")
    images = sorted(RAW.glob("*.jpg"))
    if args.eval:
        wanted = val_sites()
        if not wanted:
            raise SystemExit("no data/dataset/val_sites.txt — run make_dataset.py first")
        out_dir = AUTOLABEL_EVAL
    elif args.audit:
        wanted = set(args.sites) if args.sites else reviewed_sites()
        out_dir = AUTOLABEL_AUDIT
    else:
        done = reviewed_sites()
        wanted = set(args.sites) if args.sites else {site_of(p) for p in images} - done
        out_dir = AUTOLABEL
    todo = [p for p in images if site_of(p) in wanted]
    if not todo:
        raise SystemExit("no tiles to label")
    out_dir.mkdir(parents=True, exist_ok=True)

    model = YOLO(args.weights)
    counts = {"sure": 0, "check": 0, "candidate": 0}
    if not args.reset and not args.eval:
        # Tiles you finished keep the boxes you confirmed; only open tiles get new suggestions.
        todo = [p for p in todo if not (out_dir / f"{p.stem}.json").exists() or not read_tile(out_dir / f"{p.stem}.json").get("done")]
        if not todo:
            raise SystemExit("all tiles of these sites are finished")
    for n, image in enumerate(todo, 1):
        boxes = predict_tile(model, image, args.device, args.imgsz)
        if args.audit:
            boxes = audit_boxes(image, boxes, BUCKETS)
        tile = write_tile(out_dir, image, boxes, args.weights, BUCKETS, args.reset, audit=args.audit)
        for b in tile["boxes"]:
            if b.get("origin") in ("model", "label"):
                counts[b["bucket"]] += 1
        if n % 20 == 0 or n == len(todo):
            print(f"  {n}/{len(todo)} tiles")
    print(f"{len(todo)} tiles of {len(wanted)} sites → {out_dir}")
    print(f"boxes: {counts['sure']} sure, {counts['check']} to check, {counts['candidate']} candidates")


if __name__ == "__main__":
    main()
