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

# Labelling GUI in its own venv (it pins its own Qt and onnxruntime)
python3.12 -m venv .venv-label
.venv-label/bin/pip install "x-anylabeling-cvhub[cpu]==4.1.0"   # GPL-3.0, local tool only
```

## Workflow

| Step | Command | Result |
|---|---|---|
| 0. Sites | `python select_sites.py dealers.csv --count 80` | `data/sites.csv`, spread over all states |
| 1. Tiles | `python fetch_tiles.py data/sites.csv` | 640 px tiles at 0.10 m/px in `data/raw/` |
| 2. Public data (optional) | `python convert_public.py --src <DLR 3K folder>` | `data/public/images` and `data/public/labels` |
| 3. Pre-label | `python prelabel.py` | YOLO-OBB `.txt` per tile in `data/labels/`, plus `classes.txt` |
| 3b. Check | `python preview.py data/raw` | Labels drawn into `data/preview/` |
| 4. Correct | X-AnyLabeling, see below | Corrected labels in `data/labels/`, finished sites in `data/reviewed_sites.txt` |
| 5. Dataset | `python make_dataset.py` | `data/dataset/` from reviewed sites, split **by site** |
| 6. Baseline | `python evaluate.py --weights yolo11s-obb.pt --dota` | Pretrained model, unchanged |
| 7. Train | `caffeinate -i python train.py` | `runs/dealer-obb/weights/best.pt` |
| 8. Evaluate | `python evaluate.py` | mAP50 and per-site count MAE, bias, within-10 % |
| 9. Install | `python export.py --install` | ONNX and manifest in the app's `userData/models` |

The app picks up `dealer_vehicles.onnx` with its manifest `dealer_vehicles.json`
after a restart. It prefers this model over the downloaded VisDrone model.

**`sites.csv`** has the columns `id,lat,lon,state[,radius_m]`. `state` is the
two-letter state code that picks the orthophoto service. `select_sites.py`
builds the file from an OSM dealer export (columns `ID`, `Dealership Name`,
`Federal State`, `Latitude`, `Longitude`, `OSM ID`):

- It drops non-dealers and sites closer than 400 m to another chosen site.
  Overlapping tiles would leak between the training and validation split.
- Hamburg and Sachsen-Anhalt are skipped because they have no open service.
- Check the state of sites near state borders. A site placed in the wrong
  state gets empty tiles, which `fetch_tiles.py` reports.

Use 60–100 dealerships from several federal states. Hold out at least 15
sites; `make_dataset.py --val-share 0.2` does this per site.

**Pre-labels:** The DOTA model with `--imgsz 448 --conf 0.15` (the default)
has high precision on dealership lots. It finds only about half of the
vehicles, mostly missing dark cars in shadow, vans and vehicles at tile
edges. Labelling therefore mostly means **adding** missed vehicles, not
deleting wrong ones.

## Labelling in X-AnyLabeling

Rules:

- Draw one rotated box per vehicle, tight around the body.
- Use class `car` for cars, vans and pickups, and `large_vehicle` for trucks,
  buses, campers and trailers.
- Label vehicles that are partly hidden or cut off at the tile edge.
- Leave out vehicles you cannot see, for example in garages, under roofs or
  carports, or completely under trees.
- A tile with no vehicles is valid. Just leave it empty.

**Once, at the start:**

1. Start the tool with `.venv-label/bin/xanylabeling`. Then choose
   *File → Open Dir* and select `data/raw`.
2. Choose *Upload → YOLO OBB*. Select `data/labels/classes.txt` and then the
   folder `data/labels`. Leave "preserve existing" unticked.
   - This imports the pre-labels.
   - Do this **only once**. Importing again overwrites your corrections.

**Per site:** Tiles are sorted by name, so a site's 9 tiles come one after
another. Work through all 9 of them:

| Key | Action |
|---|---|
| `D` / `A` | Next / previous tile |
| `O` | New rotated box: drag a box, then rotate it |
| `Z` `X` / `C` `V` | Rotate the selected box (large/small, either direction) |
| `Ctrl+D` | Duplicate the selected box. Turn the first car of a row once, then duplicate it and move it with the arrow keys |
| `Del` | Delete a wrong box |
| `Ctrl+Z` | Undo |

Changes are saved automatically. When all 9 tiles of a site are correct, add
the site ID (for example `BB-osm9756873271`) as a new line in
`data/reviewed_sites.txt`. Only listed sites are used for training.

**Export** (after each session, and before `make_dataset.py`):

1. Choose *Export → YOLO OBB*.
2. Select `data/labels/classes.txt`.
3. Keep the suggested target folder `data/labels`.
4. Answer **Yes (merge)** to "Directory already exists".

Effort: with pre-labels, expect about 1–2 minutes for a tile with a car lot
and a few seconds for empty field or roof tiles. You can train with 40–50
reviewed sites and add more later.

## Two rounds (bootstrapping)

The DOTA pre-labels are good on most state orthophotos. On some they are
weak: in a test on 80 sites, Bavaria, Schleswig-Holstein, Saxony and
Thuringia gave few or no suggestions, for example on spring imagery with
hard shadows and on dense rows of vans. Instead of drawing those by hand:

1. **Round 1:** Correct the sites with good suggestions and list them in
   `data/reviewed_sites.txt`.
   - The file contains every site as a commented line. Remove the `#` once a
     site is done.
   - Round 1 sites come first, busiest first.
2. **Train** once: export, run `make_dataset.py`, then `train.py`.
3. **Re-label the rest** with your own model:
   `python prelabel.py --model runs/dealer-obb/weights/best.pt --classes own --overwrite`.
   - Sites listed as reviewed are never overwritten.
4. **Import again** in X-AnyLabeling: *Upload → YOLO OBB* from `data/labels`.
   - Export first, so your round 1 corrections are in `data/labels` and are
     imported back unchanged.
   - Then correct the round 2 sites and train again.

## Training on the MacBook Air M4 (16 GB)

- Ultralytics trains on the Apple GPU with `device="mps"`. `batch 8` at 640 px
  fits comfortably in memory.
- Measured on an M4 Air: about 0.2 s per tile and epoch. 80 sites (720
  tiles, about 580 for training) take about 2 minutes per epoch, so about 2
  hours for 60 epochs before throttling. Round 1 (about 50 sites) takes about
  1–1.5 hours.
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
