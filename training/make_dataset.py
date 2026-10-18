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

    python make_dataset.py --val-share 0.2 --seed 7 --degrade 0.5
"""

from __future__ import annotations

import argparse
import random
import shutil
from pathlib import Path

from PIL import Image

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
# Tiles at least this sharp natively get degraded copies.
SHARP_GSD_M = 0.13
DEGRADED_GSD_M = (0.18, 0.25)
DEGRADED_JPEG_QUALITY = (60, 85)


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


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--val-share", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-public", action="store_true")
    ap.add_argument("--degrade", type=float, default=0.5, help="share of sharp train tiles that get a degraded copy (0 = off)")
    args = ap.parse_args()

    reviewed = reviewed_sites()
    sites = sorted(reviewed)
    if len(sites) < 5:
        raise SystemExit(f"only {len(sites)} sites fully ticked — finish at least 5 (better 40+) in label.py first")

    own = sorted(p for p in RAW.glob("*.jpg") if site_of(p) in reviewed)
    public_dir = DATA / "public" / "images"
    public = [] if args.no_public else sorted(p for p in public_dir.glob("*.jpg") if label_path(p).exists())

    random.Random(args.seed).shuffle(sites)
    n_val = max(1, round(len(sites) * args.val_share))
    val_sites = set(sites[:n_val])

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

    yaml = DATA.parent / "dataset.yaml"
    names = "\n".join(f"  {i}: {n}" for i, n in CLASS_NAMES.items())
    yaml.write_text(f"path: {DATASET}\ntrain: images/train\nval: images/val\nnames:\n{names}\n")
    (DATASET / "val_sites.txt").write_text("\n".join(sorted(val_sites)) + "\n")
    n_train = len(list((DATASET / "images" / "train").glob("*.jpg")))
    n_val_tiles = len(list((DATASET / "images" / "val").glob("*.jpg")))
    boxes = sum(len(p.read_text().splitlines()) for p in (DATASET / "labels").rglob("*.txt"))
    print(f"{len(sites)} sites → {len(sites) - n_val} train / {n_val} val")
    print(f"tiles: {n_train} train ({len(public)} public, {degraded} degraded copies), {n_val_tiles} val, {boxes} vehicles → {yaml}")


if __name__ == "__main__":
    main()
