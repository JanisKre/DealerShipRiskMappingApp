"""Pre-label tiles with a DOTA-pretrained oriented-box model.

Writes YOLO-OBB label files next to each tile so labelling becomes
"correct the suggestions" instead of "draw every car" (open the folder in
X-AnyLabeling, which reads and writes this format).

    python prelabel.py                       # data/raw/*.jpg
    python prelabel.py --model runs/dealer-obb/weights/best.pt --classes own

DOTA imagery is coarser than our 0.10 m/px tiles; `--imgsz 448` shrinks each
tile on the fly so cars appear at roughly the scale the DOTA model learned.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

from ultralytics import YOLO  # noqa: E402

from common import DATA, TILE_PX, write_obb_labels  # noqa: E402

# DOTA-v1 class ids in Ultralytics' *-obb.pt weights
DOTA_TO_OURS = {10: 0, 9: 1}  # small vehicle → car, large vehicle → large_vehicle


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--images", default=str(DATA / "raw"))
    ap.add_argument("--model", default="yolo11s-obb.pt", help="DOTA-pretrained weights, downloaded on first use")
    ap.add_argument("--classes", choices=["dota", "own"], default="dota", help="'own' for a model trained by train.py")
    ap.add_argument("--imgsz", type=int, default=448)
    ap.add_argument("--conf", type=float, default=0.15)
    ap.add_argument("--overwrite", action="store_true", help="replace existing (possibly corrected) labels")
    ap.add_argument("--device", default="mps")
    args = ap.parse_args()

    model = YOLO(args.model)
    images = sorted(Path(args.images).glob("*.jpg"))
    todo = [p for p in images if args.overwrite or not p.with_suffix(".txt").exists()]
    print(f"{len(todo)} of {len(images)} tiles need labels")

    for i in range(0, len(todo), 16):
        batch = todo[i : i + 16]
        for path, res in zip(batch, model.predict(batch, imgsz=args.imgsz, conf=args.conf, device=args.device, verbose=False)):
            rows = []
            if res.obb is not None:
                corners = res.obb.xyxyxyxy.cpu().numpy()  # pixel coords in the original tile
                for cls, poly in zip(res.obb.cls.cpu().numpy().astype(int), corners):
                    ours = DOTA_TO_OURS.get(cls) if args.classes == "dota" else int(cls)
                    if ours is not None:
                        rows.append((ours, [tuple(p) for p in poly]))
            write_obb_labels(path.with_suffix(".txt"), rows, TILE_PX)
        print(f"  {min(i + 16, len(todo))}/{len(todo)}")


if __name__ == "__main__":
    main()
