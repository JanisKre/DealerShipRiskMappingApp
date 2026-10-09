"""Draw YOLO-OBB labels onto tiles for a quick visual check.

    python preview.py data/raw/NW-osm123__1_1.jpg      # one tile
    python preview.py data/raw --limit 20              # first 20 labelled tiles

Writes `<name>.preview.jpg` into data/preview/ (car = green, large vehicle = orange).
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

from common import DATA, label_path, read_obb_labels

COLOURS = {0: (0, 255, 102), 1: (255, 150, 0)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--limit", type=int, default=20)
    args = ap.parse_args()

    src = Path(args.path)
    tiles = [src] if src.is_file() else sorted(p for p in src.glob("*.jpg") if label_path(p).exists())[: args.limit]
    out = DATA / "preview"
    out.mkdir(parents=True, exist_ok=True)
    for tile in tiles:
        img = Image.open(tile).convert("RGB")
        draw = ImageDraw.Draw(img)
        labels = read_obb_labels(label_path(tile))
        for cls, coords in labels:
            pts = [(coords[i] * img.width, coords[i + 1] * img.height) for i in range(0, 8, 2)]
            draw.polygon(pts, outline=COLOURS.get(cls, (255, 0, 255)), width=2)
        draw.text((6, 6), f"{len(labels)} vehicles", fill=(255, 255, 0))
        img.save(out / f"{tile.stem}.preview.jpg", quality=90)
    print(f"{len(tiles)} previews in {out}")


if __name__ == "__main__":
    main()
