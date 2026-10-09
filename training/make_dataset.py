"""Assemble the Ultralytics dataset from labelled tiles, split by site.

Own dealership tiles (`data/raw`, labels corrected in X-AnyLabeling) are split
per site into train/val — never per tile, since neighbouring tiles overlap and
share vehicles. Public tiles (`data/public/images`) only go into train, so the
validation score reflects dealership imagery.

Only sites listed in `data/reviewed_sites.txt` (one site id per line, e.g.
`BB-osm9756873271`) are used. X-AnyLabeling exports labels for every tile,
including ones still holding uncorrected pre-labels; those miss about half
the vehicles and would teach the model to miss them too.

    python make_dataset.py --val-share 0.2 --seed 7
"""

from __future__ import annotations

import argparse
import random
import shutil
from pathlib import Path

from common import CLASS_NAMES, DATA, REVIEWED_SITES, label_path, reviewed_sites, site_of

DATASET = DATA / "dataset"


def labelled(folder: Path) -> list[Path]:
    return sorted(p for p in folder.glob("*.jpg") if label_path(p).exists())


def place(img: Path, split: str) -> None:
    for src, sub in ((img, "images"), (label_path(img), "labels")):
        dst = DATASET / sub / split / src.name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--val-share", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-public", action="store_true")
    args = ap.parse_args()

    reviewed = reviewed_sites()
    if not reviewed:
        raise SystemExit(f"no reviewed sites — add each fully corrected site id to {REVIEWED_SITES}")

    tiles = sorted(p for p in (DATA / "raw").glob("*.jpg") if site_of(p) in reviewed)
    unlabelled = [p.name for p in tiles if not label_path(p).exists()]
    if unlabelled:
        raise SystemExit(f"reviewed tiles without a label file (export from X-AnyLabeling first): {unlabelled[:5]}")
    unknown = reviewed - {site_of(p) for p in tiles}
    if unknown:
        print(f"warning: reviewed sites without tiles in data/raw: {sorted(unknown)[:5]}")
    own = tiles
    public = [] if args.no_public else labelled(DATA / "public" / "images")

    sites = sorted({site_of(p) for p in own})
    if len(sites) < 5:
        raise SystemExit(f"only {len(sites)} reviewed sites — review at least 5 (better 60+) before training")
    random.Random(args.seed).shuffle(sites)
    n_val = max(1, round(len(sites) * args.val_share))
    val_sites = set(sites[:n_val])

    shutil.rmtree(DATASET, ignore_errors=True)
    for img in own:
        place(img, "val" if site_of(img) in val_sites else "train")
    for img in public:
        place(img, "train")

    yaml = DATA.parent / "dataset.yaml"
    names = "\n".join(f"  {i}: {n}" for i, n in CLASS_NAMES.items())
    yaml.write_text(f"path: {DATASET}\ntrain: images/train\nval: images/val\nnames:\n{names}\n")
    (DATASET / "val_sites.txt").write_text("\n".join(sorted(val_sites)) + "\n")
    n_train = len(list((DATASET / "images" / "train").glob("*.jpg")))
    n_val_tiles = len(list((DATASET / "images" / "val").glob("*.jpg")))
    print(f"{len(sites)} sites → {len(sites) - n_val} train / {n_val} val")
    print(f"tiles: {n_train} train ({len(public)} public), {n_val_tiles} val → {yaml}")


if __name__ == "__main__":
    main()
