"""Convert the DLR 3K Munich Vehicle dataset to 640 px YOLO-OBB tiles.

Dataset: https://www.dlr.de/en/eoc/about-us/remote-sensing-technology-institute/photogrammetry-and-image-analysis/public-datasets/3k-vehicle-detection
(5616x3744 px nadir images over Munich at ~0.13 m/px, oriented vehicle
labels; research use — check the licence before any commercial use).

Expected layout after unpacking (`--src`): `*.JPG` images with sibling
annotation files `<image>_pkw.samp`, `<image>_truck.samp`, `<image>_bus.samp`,
… Each annotation line reads `id type center.x center.y size.width size.height angle`
(size = half-extent in px, angle in degrees); `#` lines are comments. Lines
with another column count are reported and skipped, so a format change is
noticed rather than silently mis-converted.

    python convert_public.py --src ~/Downloads/MunichDatasetVehicleDetection-2015-old
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image

from common import DATA, TARGET_GSD_M, TILE_PX, obb_corners, write_obb_labels

SOURCE_GSD_M = 0.13
CAR_TYPES = {"pkw"}  # everything else (truck, bus, cam, *_trail) → large_vehicle


def read_samp(path: Path, cls: int, scale: float, warn: list[str]):
    boxes = []
    for line in path.read_text(errors="replace").splitlines():
        if not line.strip() or line.startswith(("#", "@")):
            continue
        parts = line.split()
        if len(parts) != 7:
            warn.append(f"{path.name}: unexpected line {line!r}")
            continue
        _, _, cx, cy, hw, hh, angle_deg = parts
        boxes.append(
            (
                cls,
                float(cx) * scale,
                float(cy) * scale,
                2 * float(hw) * scale,
                2 * float(hh) * scale,
                math.radians(float(angle_deg)),
            )
        )
    return boxes


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", default=str(DATA / "public"))
    args = ap.parse_args()

    src, out = Path(args.src), Path(args.out)
    (out / "images").mkdir(parents=True, exist_ok=True)
    scale = SOURCE_GSD_M / TARGET_GSD_M
    warnings: list[str] = []
    n_tiles = n_boxes = 0

    for img_path in sorted([*src.glob("*.JPG"), *src.glob("*.jpg")]):
        boxes = []
        for samp in src.glob(f"{img_path.stem}_*.samp"):
            vtype = samp.stem[len(img_path.stem) + 1 :].lower()
            boxes += read_samp(samp, 0 if vtype in CAR_TYPES else 1, scale, warnings)
        if not boxes:
            continue
        img = Image.open(img_path).convert("RGB")
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)

        stride = TILE_PX // 2
        xs = list(range(0, max(1, img.width - TILE_PX), stride)) + [img.width - TILE_PX]
        ys = list(range(0, max(1, img.height - TILE_PX), stride)) + [img.height - TILE_PX]
        for r, y0 in enumerate(ys):
            for c, x0 in enumerate(xs):
                rows = []
                for cls, cx, cy, w, h, a in boxes:
                    corners = [(x - x0, y - y0) for x, y in obb_corners(cx, cy, w, h, a)]
                    # Keep vehicles that are (almost) fully inside; a margin of
                    # 15 % of the vehicle size tolerates slight cut-offs.
                    m = 0.15 * max(w, h)
                    if all(-m <= x <= TILE_PX + m and -m <= y <= TILE_PX + m for x, y in corners):
                        rows.append((cls, corners))
                name = f"DLR-{img_path.stem}__{r}_{c}"
                img.crop((x0, y0, x0 + TILE_PX, y0 + TILE_PX)).save(out / "images" / f"{name}.jpg", quality=95)
                write_obb_labels(out / "labels" / f"{name}.txt", rows)
                n_tiles += 1
                n_boxes += len(rows)

    for w in warnings[:20]:
        print("warning:", w)
    if len(warnings) > 20:
        print(f"… {len(warnings) - 20} more warnings")
    print(f"wrote {n_tiles} tiles with {n_boxes} vehicle labels to {out}")


if __name__ == "__main__":
    main()
