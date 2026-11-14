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

`requirements.txt` keeps `torch`, `onnx` and `pillow` above the releases
with known security advisories. On macOS with Python < 3.13, Ultralytics'
export check asks for `onnx<1.18`; run step 9 with `YOLO_AUTOINSTALL=false`
so it does not silently downgrade to a vulnerable `onnx`.

## Studio: the whole pipeline in the browser

```bash
cd ../desktop-app && npm run build:studio   # once, and after studio UI changes
cd ../training && python studio.py          # opens http://127.0.0.1:8770
```

The studio is one page with four tabs:

- **Übersicht** – where every step stands (sites per state, open questions,
  rounds, installed model) and what to do next.
- **Labeln** – the labelling editor. Left: the open sites, each with its
  nine tiles (pink = open questions, green = done). Middle: the tile with
  the model's boxes. The toolbar holds the tools for new boxes (select,
  **set a vehicle with one click**, sized and turned like its neighbours,
  **drag a box**), undo/redo and fit; zoom with the mouse wheel, pan by
  dragging empty ground. A card at the tile shows what you can do with the
  selected box: "Ist das ein Fahrzeug?" Ja / Nein / Später for suggestions,
  turn 90° or delete for accepted boxes. Drag a box to move it, its corners
  to resize, the round handle to turn it. Changes save themselves; "Kachel
  fertig" finishes the tile (unanswered questions count as "no", as in
  `review.py`) and opens the next one. There is **one class**: every box
  is a vehicle (see below). The "Audit" tab does the same for finished
  sites. Seldom-used steps (new suggestions, audit questions, error
  analysis, tiles, app corrections, Claude sheets) are in the "Werkzeuge"
  menu.
- **Training** – rounds, mAP curves, dataset, and a full training from the
  DOTA weights.
- **Modelle** – count error per threshold (app pipeline and Ultralytics),
  a suggested default threshold, export, install (with backup) and the
  release pin.

**Rounds.** Label a batch (say 100 tiles), then press "Speichern & neu
trainieren". The studio runs, in the background:

1. `make_dataset.py` (finished sites only; pseudo-labels off by default),
2. `train.py` fine-tuning from the previous round (15 epochs, about
   25 minutes on the M4 Air),
3. `evaluate.py --sweep` and the app-pipeline benchmark on the 11
   validation sites,
4. `export.py` (not installed),
5. `autolabel.py` with the new model for the tiles still open.

You keep labelling meanwhile; only while step 5 rewrites the suggestions
are saves paused for a minute or two. Nothing is installed automatically:
compare the round under "Modelle" and install it when it is better. Only
**complete** sites (all nine tiles done) enter the training set, so finish
sites rather than single tiles.

The studio binds to 127.0.0.1, refuses other hosts and origins and needs a
per-start token for every write. Job logs, rounds and evaluation results are
in `data/studio/` (git-ignored like all of `data/`). Steps run detached:
closing the page or stopping the studio does not stop a training run.
`review.py` still works on its own.

## Workflow

| Step | Command | Result |
|---|---|---|
| 0. Sites | `python select_sites.py dealers.csv --count 80` | `data/sites.csv`, spread over all states |
| 0b. Negatives (optional) | `python select_negatives.py --count 40`, then `python fetch_tiles.py data/negatives.csv` | One tile each of large rooftop solar arrays in `data/raw/` |
| 1. Tiles | `python fetch_tiles.py data/sites.csv` | 640 px tiles at 0.10 m/px in `data/raw/` |
| 2. Public data (optional) | `python convert_public.py --src <DLR 3K folder>` | `data/public/images` and `data/public/labels` |
| 3. Pre-label | `python prelabel.py` | Suggestions per tile in `data/labels/` |
| 3b. Check | `python preview.py data/raw` | Labels drawn into `data/preview/` |
| 4. Correct | `python label.py` | Corrections in `data/raw/*.json`; finished tiles ticked in the tool |
| 5. Dataset | `python make_dataset.py` | `data/dataset/` from finished sites, split **by site**, plus degraded copies of sharp tiles |
| 6. Baseline | `python evaluate.py --weights yolo11s-obb.pt --dota` | Pretrained model, unchanged |
| 7. Train | `caffeinate -i python train.py` | `runs/dealer-obb/weights/best.pt` |
| 8. Evaluate | `python evaluate.py` | mAP50 and per-site count MAE, bias, within-10 %, also per native resolution and false detections on negatives |
| 8b. App benchmark | `npm run benchmark:detection` in `desktop-app/` (see below) | Count MAE, bias and within-10 % per threshold through the app's own inference |
| 9. Install | `python export.py --install --default-conf 0.45` | ONNX and manifest in the app's `userData/models`; the replaced model is kept in `backup-<time>/` |

From the second round on, steps 3–4 become `autolabel.py` + `review.py`
(you confirm instead of draw); see
[Confirm instead of draw](#confirm-instead-of-draw-round-2-onwards).

The app picks up `dealer_vehicles.onnx` with its manifest `dealer_vehicles.json`
after a restart. It prefers this model over the downloaded VisDrone model.

`--default-conf` stores the base confidence the app uses for this model while
its detection-confidence parameter is still the default. Pick it from the
count metrics on the held-out sites (lowest bias in the flat MAE optimum),
not from mAP. `evaluate.py --sweep` counts with Ultralytics' own
post-processing; the app's size filter and NMS count a few percent lower, so
take the final value from the app benchmark:

```bash
cd ../desktop-app
DETECTION_SWEEP_MODEL=../training/export/dealer_vehicles.onnx \
DETECTION_SWEEP_JSON=../training/data/studio/evals/app-<run>.json \
npm run benchmark:detection
``` Omit it for a model you have not
swept; the app then keeps its global default. See
[docs/detection-benchmark.md](../docs/detection-benchmark.md#model-default-threshold-2026-11).

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

## Hard negatives (rooftop solar)

Rows of solar panels on hall roofs look like parked cars from above. The app
removes detections on mapped roofs afterwards, but a model that has seen such
roofs in training makes fewer of these mistakes, including on roofs that OSM
has not mapped. `select_negatives.py` picks large rooftop PV arrays from OSM
(at least 25 m, at least 400 m from every dealership in `data/sites.csv`).
`fetch_tiles.py` then loads one tile per array.

Their site ids contain `neg`, for example `NW-negw123`. Pre-label them with
your own model, so the suggestions are exactly the mistakes it makes. In
`label.py`, delete the boxes on the roof, keep real vehicles in the yard, and
tick the tile. `label.py` never holds negatives back as a weak state.
`make_dataset.py` splits them by site like dealerships. `evaluate.py` keeps
them out of the count metrics and reports false detections per negative tile
instead.

## Degraded copies of sharp tiles

The app scales DOP20 and Esri zoom-19 imagery up to 0.10 m/px, which looks
softer than true 0.10 m imagery. Most state services are 0.2 m anyway, but the
NRW, Bremen and DLR 3K tiles are sharp. `make_dataset.py --degrade 0.5`
(default) therefore gives half of those train tiles a softer copy
(`<tile>__lr.jpg`, same labels): shrunk to 0.18–0.25 m/px and scaled back up
the way the app does it, then saved with stronger JPEG compression. The model
then sees the same lot both sharp and soft. Validation tiles stay unchanged,
so `evaluate.py` remains comparable. Use `--degrade 0` to switch it off.

## Correcting the suggestions

```bash
python label.py            # opens X-AnyLabeling with the suggestions already loaded
python label.py --status   # progress only
```

`label.py` converts the suggestions into the tool's own format, using the
tool's converter. It then opens the tool on the tiles of **unfinished sites
only**. There is no import, export or text file to maintain. Your
corrections are saved automatically next to each tile (`data/raw/*.json`)
and are never overwritten. `make_dataset.py` reads these JSON files directly
and keeps vehicles cut off at the tile edge (their boxes are clipped to the tile).

The tool starts with an empty canvas. Press `D` once to show the first
open tile.

**Per tile:**

1. Fix the boxes:
   - add missing vehicles
   - delete wrong boxes
   - straighten boxes that are off
2. Mark the tile as done with `⌘⌥K` (`Ctrl+Alt+K` on Windows/Linux; menu: *Mark as Checked*). The
   title bar then shows `[Checked]` and the circle in the file list turns
   green. The blue box in the file list only means "has a label file".
3. Press `D` for the next tile.

A site counts as done when all 9 of its tiles are ticked. Close the window
whenever you want; the next `python label.py` starts with the remaining
sites.

On macOS the tool's `Ctrl` shortcuts use **⌘ (Cmd)**, not the ctrl key.

| Key (macOS) | Action |
|---|---|
| `D` / `A` | Next / previous tile |
| `O` | New rotated box: drag a box, then rotate it |
| `Z` `X` / `C` `V` | Rotate the selected box (large/small, either direction) |
| `⌘D` | Duplicate the selected box. Turn the first car of a row once, then duplicate it and move it with the arrow keys |
| `Del` | Delete a wrong box |
| `⌘Z` | Undo |
| `⌘⌥K` | Mark the tile as done (again to undo) |
| `⌘M` | Show / hide the box fill |

Rules:

- Draw one rotated box per vehicle, tight around the body.
- The class does not matter: the app counts every box as one vehicle and
  `make_dataset.py` trains one `vehicle` class (`--classes car-large` for
  the old two-class split). New boxes reuse the last class.
- Label vehicles that are partly hidden or cut off at the tile edge.
- Leave out vehicles you cannot see, for example in garages, under roofs or
  carports, or completely under trees.
- A tile with no vehicles is valid. Just tick it.

Effort: with suggestions, expect about 1–2 minutes for a tile with a car lot
and a few seconds for an empty field or roof tile. You can train with 40–50
finished sites and add more later.

## Two rounds (bootstrapping)

The DOTA suggestions are good on most state orthophotos. On some they are
weak: in a test on 80 sites, Bavaria, Schleswig-Holstein, Saxony and
Thuringia gave few or no suggestions, for example on spring imagery with
hard shadows and on dense rows of vans. `label.py` holds back any state
whose sites get a median of fewer than 80 suggestions; `--all` shows them
anyway. Instead of drawing those by hand:

1. **Round 1:** Correct the sites that `label.py` shows.
2. **Train** once: run `make_dataset.py`, then `train.py`.
3. **Re-label the rest** with your own model:
   `python prelabel.py --model runs/dealer-obb/weights/best.pt --classes own --overwrite`.
   - Finished sites, and tiles you have edited, are never overwritten.
4. Run `python label.py` again. The new suggestions are loaded, and the
   formerly weak states now show up because they get enough suggestions.
   Correct them, then train again.

From round 2 on, the confirm-only pipeline below replaces steps 3 and 4.

## Confirm instead of draw (round 2 onwards)

Once you have a model of your own, you no longer correct boxes in
X-AnyLabeling. The model labels, you answer yes/no.

| Step | Command | Result |
|---|---|---|
| A. Pre-label | `python autolabel.py` | Each tile predicted 8× (4 rotations × mirrored), boxes merged and sorted into `sure` / `check` / `candidate` in `data/autolabel/` |
| B. Claude (optional) | `python claude_review.py sheets --buckets candidate`, ask Claude Code to answer the sheets, then `python claude_review.py apply --auto` | Claude's answers as hints; its "no" on weak candidates decides them |
| C. Review | `python review.py` | Browser page on 127.0.0.1: J/L/N per question, then one look at the whole tile; Enter writes `data/raw/<tile>.json` (ticked) |
| D. Dataset | `python make_dataset.py [--pseudo]` | As before; validation sites stay where they were |

**Buckets** (`autolabel.Buckets`): `sure` = mean score over the 8 passes
≥ 0.55 in at least 7 passes, accepted without a question but shown on the
tile check; `check` = mean score ≥ 0.25; `candidate` = ≥ 0.12. Weaker hits
are dropped.

**Measured on the 11 validation sites** (2026-11-13, `python autolabel.py
--eval && python measure_autolabel.py --grid`; the model never trained on
them):

- 92 % of your labelled vehicles land in `sure`, 3.5 % in `check`, 1 % in
  `candidate`, 3.5 % are not found at all and need a click.
- `sure` boxes matched your labels 94 % of the time. Of the 90 that did not,
  Claude judged 65 to be real vehicles missing from the labels (many cut by
  the tile edge) and 7 to be wrong; true precision is likely about 98 %.
- Work per tile: about 4 yes/no answers plus 0.6 clicks for missed vehicles.
  On these sites round 1 (correcting DOTA suggestions) was cheap too, about
  1.6 edits per tile, because they are in states where DOTA works and the
  labels started from DOTA. The pipeline pays off where DOTA failed: on the
  24 unfinished BY/SH/SN/TH sites it gives 2580 `sure` boxes against 1394
  DOTA suggestions (BY-osm296363718: 150 against 11).

**review.py keys.** Questions: `J` car, `L` large vehicle (van, truck, bus),
`N` not a vehicle, `Backspace` back, `Tab` skip to the tile. Tile check:
click on a vehicle without a box to add one (oriented like its neighbours),
click on a wrong box to drop it, `R` / `[` / `]` turn the last added box,
arrows move it, `L` toggles its size, `U` undo, `Enter` tile done. Tiles
you have already started in X-AnyLabeling are left out; finish them there.

### Claude as second reviewer

`claude_review.py sheets` renders open questions as numbered crops, 20 per
sheet, in `data/claude/sheets/`. In Claude Code, ask for example "Prüf die
Sheets in training/data/claude/sheets/open-candidates_*.png" and let Claude
write one answer file per sheet (`data/claude/answers/<sheet>.txt`, lines
`<n> car|large|no|unsure`). `apply` stores the answers; review.py shows
them under the zoom.

Measured on 200 random questions of the validation sites
(`sheets --eval --sample 200`, `score --eval`): Claude's "no" on a weak
candidate matched your labels 59 of 61 times; its "no" on a `check` box 16
of 21; its "vehicle" 17 of 46 (partly vehicles missing from the labels).
So `apply --auto` lets Claude decide only "no" on candidates; everything
else stays your question. On the 24 unfinished sites that removed 143 of
837 questions. The crops leave the machine when Claude reads them (open
state orthophotos of OSM sites).

### Audit finished sites

`python autolabel.py --audit` then `python review.py --audit` asks about
finished sites: model boxes (score ≥ 0.55) that no label covers ("does this
vehicle miss a label?") and labels no model box supports at all ("is this
label right?"). Confirmed vehicles are appended to the tile JSON, rejected
labels removed. On the 56 finished sites it found 538 likely missing
vehicles and 236 doubtful labels, about 1.5 questions per tile. Audit the
validation sites first: their labels are what every score is measured
against.

### Pseudo-labels (no human per tile)

`python make_dataset.py --pseudo` also puts autolabel tiles of unfinished
sites into **train**: `sure` boxes plus answered questions. Open questions
are painted over with the tile's mean colour, so the model learns neither
"vehicle" nor "background" there. Guard rails:

- Validation is 100 % human labels; pseudo tiles never go there.
- The validation split is stable: `make_dataset.py` keeps the previous val
  and train sites and adds new finished sites to val until there are at
  least 15. `--resplit` draws a fresh split (scores then stop being
  comparable).
- Keep a pseudo-label model only if it beats the current one on the
  validation sites: train it with `python train.py --name dealer-obb-pseudo`
  and compare `python evaluate.py --sweep` for both weights before
  `export.py --install`.

### Corrections from the app

Vehicle points you add or remove on the map in the app are labels too.
`python harvest_app.py sites` reads them from the app database (read-only)
for analyses on a state DOP, writes `data/app_sites.csv` with anonymous site
ids, and `harvest_app.py apply` turns them into decisions in
`data/autolabel/` after `fetch_tiles.py` and `autolabel.py --sites $(python
harvest_app.py ids)`. An added point confirms the model box under it or
adds a box; a removed point rejects the box under it. Confirm in review.py
as usual.

### Where the model fails

`python analyze_errors.py --sheets` lists misses and false detections on
the validation sites by tag (edge, dark, large, small, dense) and writes
crop sheets to `data/errors/`. At the app's base confidence 0.45
(2026-11-13): 93 % of labelled vehicles found; large vehicles are missed
24 % of the time, small or cut ones 21 %, vehicles at the tile edge 13 %,
dense rows only 5 %. Yellow buses and vans are a visible gap. The crop
sheets also show labels on empty asphalt or shadows; fix those with the
audit. The burned-in attribution text of some state services
("© GeoBasis-DE/…") is sometimes detected as a vehicle; answer N.

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
- **VisDrone** (default downloaded model), **DOTA** (pretrained weights) and
  **DLR 3K Munich** are released for research. Check their terms before
  commercial use or before bundling a model trained on them with a release.
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
