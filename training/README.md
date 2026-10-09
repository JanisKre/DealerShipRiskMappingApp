# Vehicle detector training

This folder trains the app's vehicle detector on **nadir orthophotos**. The
model the app downloads by default was trained on VisDrone, which is
low-altitude and often oblique drone video. It under-counts tightly parked
rows on dealership lots. The pipeline below fine-tunes a DOTA-pretrained
**oriented-box** YOLO model on dealership tiles at 0.10 m/px. It runs
locally on a MacBook Air M4 with 16 GB.

Nothing produced here is committed: `data/`, `runs/`, `export/`, and all
weights are git-ignored. Imagery and labels can reveal dealership locations.

## Setup

```bash
cd training
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install x-anylabeling   # optional: labelling GUI with OBB support
```

## Workflow

| Step | Command | Result |
|---|---|---|
| 1. Tiles | `python fetch_tiles.py sites.csv --service NW` | 640 px tiles at 0.10 m/px in `data/raw/` |
| 2. Public data (optional) | `python convert_public.py --src <DLR 3K folder>` | tiles plus labels in `data/public/` |
| 3. Pre-label | `python prelabel.py` | YOLO-OBB `.txt` next to each tile |
| 4. Correct | Open `data/raw/` in X-AnyLabeling | Corrected labels |
| 5. Dataset | `python make_dataset.py` | `data/dataset/`, split **by site** |
| 6. Baseline | `python evaluate.py --weights yolo11s-obb.pt --dota` | Pretrained model, unchanged |
| 7. Train | `caffeinate -i python train.py` | `runs/dealer-obb/weights/best.pt` |
| 8. Evaluate | `python evaluate.py` | mAP50 and per-site count MAE, bias, within-10 % |
| 9. Install | `python export.py --install` | ONNX and manifest in the app's `userData/models` |

The app picks up `dealer_vehicles.onnx` with its manifest `dealer_vehicles.json`
after a restart. It prefers this model over the downloaded VisDrone model.

**`sites.csv`** has the columns `id,lat,lon[,radius_m]`. Use 60–100 dealerships
from several federal states. Hold out at least 15 sites;
`make_dataset.py --val-share 0.2` does this per site.

**Labelling:** Draw one rotated box per vehicle. Use class `car` for cars,
vans and pickups, and `large_vehicle` for trucks, buses and campers.
Label partially covered vehicles too. Leave out vehicles in garages or under
carports, because they are not visible. With pre-labels, expect about
1–2 minutes per tile.

## Training on the MacBook Air M4 (16 GB)

- Ultralytics trains on the Apple GPU with `device="mps"`. `batch 8` at 640 px
  fits comfortably in memory.
- Expect about 2–3 minutes per epoch for 1,000–2,000 tiles, so 2–4 hours
  for 60 epochs.
- The Air has no fan and throttles on long runs. Keep it on the charger,
  start the run with `caffeinate -i`, and don't do other heavy work at the
  same time.
- If a run is interrupted, continue it with `python train.py --resume`.
- For a quick check, run `python train.py --epochs 3 --fraction 0.1`.
- Ops that MPS doesn't support fall back to the CPU
  (`PYTORCH_ENABLE_MPS_FALLBACK=1`, set by the scripts). If MPS still fails,
  use `--model yolo11n-obb.pt` or `--device cpu` as a smoke test.
- Training from scratch on the full DOTA dataset is not realistic on this
  machine. Fine-tuning from pretrained weights is.

## Licences

- **Ultralytics** code and weights are AGPL-3.0. This applies to the
  existing model too. Check the terms before commercial distribution.
- **DOTA** (pretrained weights) and **DLR 3K Munich** are released for
  research. Check their terms before commercial use.
- **State orthophotos** in `fetch_tiles.py` are open data (dl-de/by-2-0,
  dl-de/zero-2-0, CC BY 4.0). Keep the attribution.
- **Esri World Imagery** tiles are deliberately not used for training data.

## How the app uses the model

The manifest (schema: `desktop-app/src/shared/model-manifest.ts`)
tells the app the following:

- the task (`obb` or `detect`) and the output layout
- the training resolution `gsdM`
- the class mapping and per-class threshold offsets

The app resamples every capture to `gsdM` and slices it into full 640 px
windows. It then removes duplicates with oriented-box NMS. Methodology and
benchmark numbers are in `docs/detection-benchmark.md`.
