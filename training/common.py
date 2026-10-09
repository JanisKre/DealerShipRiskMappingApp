"""Shared helpers for the vehicle-detector training pipeline.

Conventions used by every script:

* Tiles are 640x640 RGB JPEGs at TARGET_GSD_M ground resolution, matching the
  app, which resamples imagery to the model's `gsdM` before inference.
* Tile filenames start with the site id (`<site>__<row>_<col>.jpg`) so splits
  can be made per site, never per tile (neighbouring tiles share vehicles).
* Labels use the Ultralytics YOLO-OBB text format:
  `class x1 y1 x2 y2 x3 y3 x4 y4` with corners normalised to [0, 1], stored
  in `<image dir>/../labels/` (see label_path).
"""

from __future__ import annotations

import math
from pathlib import Path

TILE_PX = 640
TARGET_GSD_M = 0.10

# Model classes. The app maps them to its vehicle classes via the manifest.
CLASS_NAMES = {0: "car", 1: "large_vehicle"}

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"


def label_path(image: Path) -> Path:
    """YOLO label of a tile: `<image dir>/../labels/<stem>.txt` — the layout
    X-AnyLabeling exports to by default (data/raw → data/labels), and the one
    Ultralytics expects (images/ ↔ labels/)."""
    return image.parent.parent / "labels" / f"{image.stem}.txt"


def write_classes_file(folder: Path) -> Path:
    """classes.txt (one name per line, in id order) — X-AnyLabeling asks for it on import/export."""
    path = folder / "classes.txt"
    path.write_text("\n".join(CLASS_NAMES[i] for i in sorted(CLASS_NAMES)) + "\n")
    return path


REVIEWED_SITES = DATA / "reviewed_sites.txt"


def reviewed_sites() -> set[str]:
    """Site ids whose 9 tiles have been fully corrected (one per line, `#` comments)."""
    if not REVIEWED_SITES.exists():
        return set()
    # First word of each non-comment line; the rest (counts, names) is free text.
    words = (line.split("#", 1)[0].split() for line in REVIEWED_SITES.read_text().splitlines())
    return {w[0] for w in words if w}


def site_of(path: Path) -> str:
    """Site id encoded in a tile filename (`<site>__<row>_<col>.jpg`)."""
    return path.stem.split("__", 1)[0]


def obb_corners(cx: float, cy: float, w: float, h: float, angle_rad: float):
    """Corners of a rotated rectangle, in the same units as the inputs."""
    cos, sin = math.cos(angle_rad), math.sin(angle_rad)
    out = []
    for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        out.append((cx + dx * cos - dy * sin, cy + dx * sin + dy * cos))
    return out


def write_obb_labels(path: Path, rows: list[tuple[int, list[tuple[float, float]]]], size: int = TILE_PX) -> None:
    """Writes YOLO-OBB labels; corners are pixel coordinates within the tile."""
    lines = []
    for cls, corners in rows:
        coords = " ".join(f"{min(max(x / size, 0.0), 1.0):.6f} {min(max(y / size, 0.0), 1.0):.6f}" for x, y in corners)
        lines.append(f"{cls} {coords}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + ("\n" if lines else ""))


def read_obb_labels(path: Path) -> list[tuple[int, list[float]]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) == 9:
            rows.append((int(parts[0]), [float(v) for v in parts[1:]]))
    return rows


# --- Web Mercator ------------------------------------------------------------

EARTH_HALF_CIRCUMFERENCE = 20037508.342789244


def lonlat_to_3857(lon: float, lat: float) -> tuple[float, float]:
    x = lon * EARTH_HALF_CIRCUMFERENCE / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) * EARTH_HALF_CIRCUMFERENCE / math.pi
    return x, y


def mercator_scale(lat: float) -> float:
    """EPSG:3857 metres per ground metre at a latitude."""
    return 1 / math.cos(math.radians(lat))
