"""Assemble the Ultralytics dataset from your corrected tiles, split by site.

Only sites whose tiles are all ticked as done in X-AnyLabeling are used; their
labels are read straight from the tool's JSON (no export step); boxes cut off
at the tile edge are kept and clipped to the tile. Unticked
tiles still hold raw suggestions, which miss about half of the vehicles and
would teach the model to miss them too.

Dealership sites are split into train/val per site — never per tile, since
neighbouring tiles overlap and share vehicles. Public tiles
(`data/public/images`) only go into train, so the validation score reflects
dealership imagery. Hard-negative sites (select_negatives.py) are split like
dealership sites.

Resolution degradation (`--degrade`): the app upsamples DOP20 and Esri zoom-19
imagery to 0.10 m/px, which looks softer than true 0.10 m imagery. Most state
services are 0.2 m anyway, but NRW, Bremen and DLR 3K tiles are sharp. A share
of those train tiles gets an extra copy (`<stem>__lr.jpg`, same labels) that
is shrunk to 0.18–0.25 m/px and scaled back up the way the app does it
(Lanczos down, bicubic up), then saved with Esri-like JPEG compression.
Validation tiles stay untouched, so scores remain comparable.

Stable validation split: sites stay where they were in the previous dataset
(data/dataset/val_sites.txt and the train images), so a model is never scored
on sites it trained on. Newly finished sites go to validation until it has at
least MIN_VAL_SITES sites and the --val-share, the rest to train. --resplit
draws a fresh random split (scores are then not comparable with older models).

Pseudo-labels (`--pseudo`): tiles of unfinished sites labelled by autolabel.py
go into train only: `sure` boxes plus the questions you or Claude answered.
Open questions are greyed out in the image copy, so the model learns neither
"vehicle" nor "background" there. Validation stays 100 % your labels.

Classes (`--classes`): by default every box becomes the one class
`vehicle`. The app counts all vehicles alike (the hail EAL sums every class,
size filter and NMS are class-agnostic), so a car / large-vehicle split only
costs labelling time and adds class confusion. Labels keep their class in the
tile files; `--classes car-large` rebuilds the old two-class dataset.

    python make_dataset.py --val-share 0.2 --seed 7 --degrade 0.5
    python make_dataset.py --pseudo
"""

from __future__ import annotations

import argparse
import random
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageStat

from common import (
    CLASS_NAMES,
    DATA,
    RAW,
    TARGET_GSD_M,
    TILE_PX,
    corrected_labels,
    label_path,
    native_gsd,
    reviewed_sites,
    site_of,
    write_obb_labels,
)

DATASET = DATA / "dataset"
MIN_VAL_SITES = 15
# Tiles at least this sharp natively get degraded copies.
SHARP_GSD_M = 0.13
DEGRADED_GSD_M = (0.18, 0.25)
DEGRADED_JPEG_QUALITY = (60, 85)


# What the model learns; the tile files keep car / large_vehicle either way.
TRAIN_CLASSES = {"vehicle": {0: "vehicle"}, "car-large": CLASS_NAMES}


def merge_classes(labels_dir: Path) -> None:
    """Rewrites every YOLO-OBB label line to class 0 (one `vehicle` class)."""
    for path in labels_dir.rglob("*.txt"):
        lines = [line.split(maxsplit=1) for line in path.read_text().splitlines() if line.strip()]
        path.write_text("".join(f"0 {rest[1]}\n" for rest in lines if len(rest) == 2))


def place(img: Path, label: Path, split: str) -> None:
    for src, dst in ((img, DATASET / "images" / split / img.name), (label, DATASET / "labels" / split / f"{img.stem}.txt")):
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def add_degraded(img: Path, rng: random.Random) -> None:
    """Writes a low-resolution copy of a train tile next to it, with the same labels."""
    gsd = rng.uniform(*DEGRADED_GSD_M)
    small = max(1, round(TILE_PX * TARGET_GSD_M / gsd))
    with Image.open(img) as im:
        soft = im.convert("RGB").resize((small, small), Image.LANCZOS).resize((TILE_PX, TILE_PX), Image.BICUBIC)
    stem = f"{img.stem}__lr"
    soft.save(img.with_name(f"{stem}.jpg"), quality=rng.randint(*DEGRADED_JPEG_QUALITY))
    labels = DATASET / "labels" / "train"
    shutil.copy2(labels / f"{img.stem}.txt", labels / f"{stem}.txt")


def previous_split() -> tuple[set[str], set[str]]:
    """(val, train) sites of the dataset on disk, before it is rebuilt."""
    val_file = DATASET / "val_sites.txt"
    val = set(val_file.read_text().split()) if val_file.exists() else set()
    train = {site_of(p) for p in (DATASET / "images" / "train").glob("*.jpg")} - val
    return val, train


def split_sites(sites: list[str], val_share: float, seed: int, resplit: bool) -> set[str]:
    """Validation sites: the previous ones kept, new sites added until the target size."""
    target = min(len(sites) // 2, max(MIN_VAL_SITES, round(len(sites) * val_share)))
    prev_val, prev_train = (set(), set()) if resplit else previous_split()
    val = {s for s in sites if s in prev_val}
    new = sorted(s for s in sites if s not in prev_val and s not in prev_train)
    random.Random(seed).shuffle(new)
    while len(val) < target and new:
        val.add(new.pop())
    return val


def add_pseudo(val_sites: set[str], reviewed: set[str]) -> tuple[int, int]:
    """Train tiles from autolabel.py for unfinished sites; open questions greyed out."""
    from autolabel import AUTOLABEL, accepted_boxes, open_questions, read_tile

    tiles = boxes = 0
    for path in sorted(AUTOLABEL.glob("*.json")):
        tile = read_tile(path)
        img = RAW / tile["image"]
        site = site_of(img)
        if site in reviewed or site in val_sites or not img.exists():
            continue
        rows = [(b["cls"], [tuple(p) for p in b["corners"]]) for b in accepted_boxes(tile)]
        with Image.open(img) as im:
            im = im.convert("RGB")
            fill = tuple(round(v) for v in ImageStat.Stat(im).mean)
            draw = ImageDraw.Draw(im)
            for q in open_questions(tile):
                draw.polygon([tuple(p) for p in q["corners"]], fill=fill)
            out = DATASET / "images" / "train" / f"{img.stem}__pl.jpg"
            out.parent.mkdir(parents=True, exist_ok=True)
            im.save(out, quality=95)
        write_obb_labels(DATASET / "labels" / "train" / f"{img.stem}__pl.txt", rows)
        tiles += 1
        boxes += len(rows)
    return tiles, boxes


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--val-share", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-public", action="store_true")
    ap.add_argument("--degrade", type=float, default=0.5, help="share of sharp train tiles that get a degraded copy (0 = off)")
    ap.add_argument("--resplit", action="store_true", help="new random train/val split instead of keeping the previous one")
    ap.add_argument("--pseudo", action="store_true", help="add autolabel.py tiles of unfinished sites to train")
    ap.add_argument("--classes", choices=sorted(TRAIN_CLASSES), default="vehicle", help="vehicle (one class, default) or car-large (two classes)")
    args = ap.parse_args()

    reviewed = reviewed_sites()
    sites = sorted(reviewed)
    if len(sites) < 5:
        raise SystemExit(f"only {len(sites)} sites fully ticked — finish at least 5 (better 40+) in label.py first")

    own = sorted(p for p in RAW.glob("*.jpg") if site_of(p) in reviewed)
    public_dir = DATA / "public" / "images"
    public = [] if args.no_public else sorted(p for p in public_dir.glob("*.jpg") if label_path(p).exists())

    val_sites = split_sites(sites, args.val_share, args.seed, args.resplit)
    n_val = len(val_sites)

    shutil.rmtree(DATASET, ignore_errors=True)
    for img in own:
        split = "val" if site_of(img) in val_sites else "train"
        # Your corrections: X-AnyLabeling JSON → YOLO-OBB (edge-cut boxes kept, clipped to the tile).
        write_obb_labels(DATASET / "labels" / split / f"{img.stem}.txt", corrected_labels(img))
        (DATASET / "images" / split).mkdir(parents=True, exist_ok=True)
        shutil.copy2(img, DATASET / "images" / split / img.name)
    for img in public:
        place(img, label_path(img), "train")

    degrade_rng = random.Random(args.seed)
    degraded = 0
    for img in sorted((DATASET / "images" / "train").glob("*.jpg")):
        gsd = native_gsd(site_of(img))
        if gsd is not None and gsd <= SHARP_GSD_M and degrade_rng.random() < args.degrade:
            add_degraded(img, degrade_rng)
            degraded += 1
    pseudo_tiles, pseudo_boxes = add_pseudo(val_sites, reviewed) if args.pseudo else (0, 0)

    if args.classes == "vehicle":
        merge_classes(DATASET / "labels")
    yaml = DATA.parent / "dataset.yaml"
    names = "\n".join(f"  {i}: {n}" for i, n in TRAIN_CLASSES[args.classes].items())
    yaml.write_text(f"path: {DATASET}\ntrain: images/train\nval: images/val\nnames:\n{names}\n")
    (DATASET / "val_sites.txt").write_text("\n".join(sorted(val_sites)) + "\n")
    n_train = len(list((DATASET / "images" / "train").glob("*.jpg")))
    n_val_tiles = len(list((DATASET / "images" / "val").glob("*.jpg")))
    boxes = sum(len(p.read_text().splitlines()) for p in (DATASET / "labels").rglob("*.txt"))
    print(f"{len(sites)} sites → {len(sites) - n_val} train / {n_val} val")
    print(f"tiles: {n_train} train ({len(public)} public, {degraded} degraded copies, {pseudo_tiles} pseudo-labelled), {n_val_tiles} val, {boxes} vehicles → {yaml}")
    if pseudo_tiles:
        print(f"pseudo-labels: {pseudo_boxes} vehicles from autolabel.py, train only")


if __name__ == "__main__":
    main()
