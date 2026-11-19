# Detection benchmark

The vehicle detector is evaluated separately from the risk model. This keeps
model quality measurable when changing the ONNX weights, imagery provider,
tile size, or confidence threshold.

Use `evaluateDetectionBenchmark` from
`desktop-app/src/main/services/detection-benchmark.ts` with a small labelled
set of real dealership aerial images. Each sample should contain the manually
verified total and, where possible, class counts for car, van, truck, and bus.

Track at least:

- mean absolute error (MAE) of the total vehicle count
- signed count bias (over-/under-counting)
- share of samples within 10% of the labelled count
- class-level MAE

The benchmark output should be stored alongside the model version and imagery
provider. Public datasets such as VisDrone or CARPK are useful for initial
model comparisons, but they are not a substitute for dealership-specific
validation.

**Acceptance target for a new model:** per-site count MAE ≤ 10 % of the
labelled count and |bias| ≤ 5 % on held-out sites. Record the run below.

## Methodology (detection pipeline, 2026-10)

The pipeline works in these steps:

1. Capture the site as a tile mosaic.
2. Resample the mosaic to the model's training ground resolution (`gsdM` in
   the model manifest, 0.10 m/px for current models).
3. Slice it into full-size windows (model input size, 30 % overlap, but at
   least the longest plausible vehicle of 16 m and at most half a window).
   Every vehicle is therefore fully inside at least one window. Edge windows
   are pulled inside the mosaic. Mosaics smaller than one window are padded,
   never upscaled.
4. Run the model and decode its output: axis-aligned boxes (`detect`) or
   oriented boxes (`obb`).
5. Keep a detection only if both of these hold:
   - Its score is at least the user's base confidence plus a per-class offset
     from the manifest.
   - Its real-world size is plausible: at least 1.2 m wide, at most 16 m
     long, aspect ratio at most 5.
6. Remove duplicates with class-agnostic hard NMS. A box is suppressed when
   either of these holds:
   - IoU ≥ 0.5 (oriented boxes) or ≥ 0.6 (axis-aligned boxes).
   - Intersection-over-smaller ≥ 0.7 or ≥ 0.8 respectively. This catches
     vehicles cut off at window seams.
7. Clip the box centres to the site boundary.
8. Drop detections on building roofs (`detection/roof-mask.ts`): a box centre
   at least 2 m inside a mapped OSM building footprint is removed. Solar
   panel rows and roof fixtures otherwise read as vehicles. Multi-storey and
   rooftop car parks are exempt. Without footprints (Overpass unreachable,
   building unmapped) nothing is removed. The number removed is recorded in
   the detection's `limitations`.

The map shows the selected site's vehicles over the image they were counted
on (state orthophoto or archived Esri version), not over the newest basemap.
Dots drawn over another capture land on roofs and empty stalls.

The model, version, training resolution and any resampling factor are
recorded in the detection evidence (`source`, `dataVersion`, `method`).
Manifest limitations are added to `limitations`.

**Models.** A model is chosen from `userData/models` or the app resources, in
this order:

1. `dealer_vehicles.onnx` with its manifest `dealer_vehicles.json`, produced
   by `training/` (DOTA-pretrained YOLO-OBB fine-tuned on dealership
   orthophotos). Release installers bundle the shipped version (see
   [Shipped model](#shipped-model-2026-11)); `training/export.py --install`
   puts a locally trained one into `userData/models`, which wins.
2. Otherwise a manually placed `yolov26s_aerial_vehicles.onnx`.
   - It was trained on VisDrone (low-altitude, partly oblique drone video).
   - It uses a built-in manifest.
   - Its known weakness is under-counting dense, angled parking rows.
   - The app no longer downloads it.

**Fixes in this revision** (they change counts for the existing model too):

- **Ground resolution.** It is now computed from the mosaic's own extent.
  Previously it came from the requested bbox divided by the larger mosaic
  width. That underestimated the resolution by up to about 2×, so the 1.2 m
  minimum width rejected ordinary cars, most of all on zoom 19 and on small
  boundaries.
- **Confidence setting.** It now raises and lowers the per-class thresholds.
  Before, it could only lower them.
- **NMS.** Soft-NMS was replaced by hard NMS. Soft-NMS let seam duplicates
  survive with damped scores.
- **Edge crops.** Small edge crops are no longer upscaled up to 10×.
  Upscaling produced phantom detections.
- **Window overlap (2026-10).** Lowered from 50 % to 30 % (with the 16 m
  minimum above). A 1920 px mosaic needs 16 instead of 25 windows, about a
  third less inference time. Seam duplicates are still caught by the
  intersection-over-smaller rule in step 6.

**Data sources.**

- Esri World Imagery (zoom 19/20) or state orthophotos (DOP, 0.1–0.2 m/px)
  for inference.
- State open-data DOPs and DLR 3K Munich for training (see
  `training/README.md` for licences).

**Limitations.**

- Counts show vehicles visible on the imagery capture date, not today's
  stock.
- Vehicles under roofs, carports or dense trees are not visible.
- Resolution varies by source. Upsampled zoom-19 or DOP20 imagery carries
  less detail than true 0.1 m imagery.
- The result is a screening estimate for underwriting triage, not an
  inventory count or an insurance decision. Use map review (add or remove
  points) to correct individual sites.

## Model default threshold (2026-11)

A model can carry the base confidence its counts were calibrated at
(`defaultConfidence` in its manifest, written by
`training/export.py --default-conf`). The app uses it while the
detection-confidence parameter is still the global default (0.22); a value
the user set always wins. The threshold used is recorded in the detection
evidence (`method`, "base confidence … (model default)").

**Why.** The global default was tuned for the VisDrone model. The
fine-tuned dealership model scores differently: at 0.22 it over-counted by
12.5 % on held-out sites.

**Measurement.** The app's own window inference (`inferWindow`: decoding,
per-class offsets, size filter, hard NMS) with `dealer_vehicles` 2026-10-10
(YOLO11s-OBB) on the 99 validation tiles of the training split, 11 held-out
dealership sites at 0.10 m/px, compared with the corrected labels per site.

| Base confidence | Count MAE | Bias | Within 10 % |
|---|---|---|---|
| 0.15 | 26.3 | +17.8 % | 18 % |
| 0.22 | 18.5 | +12.5 % | 36 % |
| 0.30 | 12.0 | +8.1 % | 64 % |
| 0.40 | 8.1 | +3.4 % | 73 % |
| **0.45** | **8.5** | **+0.9 %** | **73 %** |
| 0.50 | 8.4 | −0.5 % | 73 % |
| 0.55 | 9.2 | −2.2 % | 82 % |
| 0.60 | 10.4 | −4.5 % | 64 % |

0.45 is chosen for the smallest bias in the flat optimum between 0.40 and
0.50.

**Limitations.**

- 11 sites, and the threshold was chosen on the same sites it is reported
  on; the true error on new sites is likely somewhat higher.
- Tiles are scored whole, without the boundary clip and the roof mask. Both
  remove further detections in the app, so the in-app optimum may be a
  little lower.
- The value belongs to this model version. A retrained model needs its own
  sweep before `--default-conf` is set; without it the global default
  applies.

## Comparison with public models and a test split (2026-11-19)

**Question.** How does our dealer model compare with public aerial vehicle
detectors under the same conditions, and how sure are the numbers?

**Method.** `training/compare_models.py` runs every model through
`training/evaluate.py` on the same tiles. It reports count MAE, bias and
the share of sites within 10 %, each with a 95 % bootstrap interval over
sites. It also reports precision and recall at probIoU 0.5, because a site
count can come out right when misses and false detections cancel. Public
models get every input size they could reasonably use (448/640/1024 for
DOTA) and thresholds down to 0.02. We count only their vehicle classes:
DOTA "small/large vehicle", VisDrone "car/van/truck/bus", and the YOLOE
prompt "car, van, truck". Each model's input size and threshold are picked
by MAE on val and scored on the test split.

**Test split.** On 2026-11-19, 120 new sites were added from the 500-dealer
list (JanisKre/dealership_dataset, OSM, ODbL). Each new site is at least
400 m from every existing site. 60 of them (half per state, seed 7) are
test sites in `training/data/test_sites.txt`: they never go into train or
val, and no threshold or checkpoint is chosen on them. The other 60 are
for training. No model has seen any of the 120.

**Results on the 20 val sites so far** (3,093 vehicles; tuned and scored on
the same sites, which flatters every model, and the public ones more
because they had more settings to choose from):

| Model | Source | Size | Conf | MAE (95 %) | Bias | Within 10 % | Precision | Recall |
|---|---|---|---|---|---|---|---|---|
| round-02 (shipped) | ours, DLR 3K lineage | 640 | 0.30 | 4.9 (3.2–6.7) | −0.7 % | 100 % | 94.7 % | 94.1 % |
| scratch-01 | ours, own labels only | 640 | 0.30 | 5.8 (3.5–8.2) | −0.8 % | 85 % | 93.8 % | 93.0 % |
| round-01 | ours | 640 | 0.35 | 6.5 (4.2–9.1) | −3.0 % | 80 % | 94.8 % | 92.0 % |
| dealer-obb | ours | 640 | 0.45 | 8.6 (5.2–12.7) | −3.0 % | 70 % | 93.4 % | 90.6 % |
| YOLO26x-OBB | Ultralytics, DOTA v1 | 448 | 0.02 | 16.9 (8.7–29.0) | −4.5 % | 60 % | 88.7 % | 84.7 % |
| YOLO26m-OBB | Ultralytics, DOTA v1 | 448 | 0.02 | 21.9 (11.8–33.8) | −5.9 % | 55 % | 88.3 % | 83.2 % |
| YOLO26s-OBB | Ultralytics, DOTA v1 | 448 | 0.05 | 23.4 (8.7–43.0) | −13.6 % | 65 % | 91.8 % | 79.4 % |
| YOLO11x-OBB | Ultralytics, DOTA v1 | 640 | 0.02 | 24.2 (13.2–37.9) | −3.6 % | 60 % | 87.4 % | 84.2 % |
| YOLO11m-OBB | Ultralytics, DOTA v1 | 448 | 0.10 | 26.1 (9.9–48.6) | −14.3 % | 65 % | 93.2 % | 80.0 % |
| YOLO11s-OBB | Ultralytics, DOTA v1 | 448 | 0.05 | 32.6 (14.6–55.1) | −12.1 % | 45 % | 90.5 % | 79.6 % |
| YOLO26s VisDrone | app default before dealer models | 640 | 0.20 | 36.5 (23.8–50.5) | −15.8 % | 30 % | 80.3 % | 67.6 % |
| YOLOE-11L zero-shot | Ultralytics, text prompt | 1024 | 0.02 | 90.1 (67.0–116.3) | −42.9 % | 0 % | 51.0 % | 29.1 % |

Even tuned on the very sites it is scored on, the best public model has
about three times our MAE and roughly 10 points less recall. With 20 sites
the intervals are wide (round-02 3.2–6.7, scratch-01 3.5–8.2), so these
data cannot rank round-02 above scratch-01. round-02 also trained on 9 of
the 20 sites.

**Limitations.**
- The labels began as suggestions, first from DOTA YOLO11s-OBB and later
  from our own models, and were corrected by one person. Where a box is
  ambiguous, the labels may lean towards those models.
- Only German state orthophotos at 0.10–0.20 m, and only dealership lots.
- On Hugging Face we found few public nadir vehicle detectors that can be
  loaded without running a third-party pickle. Those checkpoints are not
  part of this comparison yet.

**Next.** Once the 60 test sites are labelled, run `compare_models.py`
again: it then tunes on val and reports on test.

## Shipped model (2026-11-19, round 02)

**What ships.** From v0.6.0, release installers contain `dealer_vehicles`
2026-11-19-round-02 (YOLO11s-OBB, one class `vehicle`, base confidence
0.30) from the GitHub release `model-dealer-vehicles-2026-11-19-round-02`
(not marked latest). `model-release.json` pins its tag and both hashes; the
fetch and wizard checks described below are unchanged.

**How it was trained.** All 80 sample sites (14 federal states, state
orthophotos at 0.10 or 0.20 m/px) were labelled completely, then audited in
the studio: the model's extra detections on finished sites were shown as
questions (456 vehicles added, 82 suggestions and 29 labels rejected, 202
labels confirmed). Round 01 fine-tuned the two-class 2026-10-10 weights on
the one-class dataset for 20 epochs; round 02 fine-tuned round 01 on the
audited labels for another 20 epochs. No DLR 3K tiles, no pseudo-labels.

**Validation set.** `make_dataset.py --val-share 0.25 --grow-val` grew the
held-out set from 11 to 20 sites (180 tiles, 3,093 labelled vehicles; every
federal state, 3 sites at 0.10 m/px). The 9 added sites were train sites
before, so the 2026-10-10 model and both rounds have seen them. Only
`scratch-01`, trained from the DOTA start weights on the other 60 sites,
never saw any of the 20.

**Measurement.** App pipeline (`npm run benchmark:detection`), 20 sites,
labels after the audit. Cells are count MAE / bias / share of sites within
10 %:

| Base confidence | dealer_vehicles 2026-10-10 | round 01 | **round 02** | scratch-01 |
|---|---|---|---|---|
| 0.30 | 8.1 / +1.6 % / 70 % | 7.0 / −2.2 % / 85 % | **5.7 / −2.0 % / 100 %** | 6.5 / −2.2 % / 85 % |
| 0.35 | 8.1 / −1.0 % / 85 % | 7.2 / −3.9 % / 75 % | 7.1 / −3.4 % / 80 % | 7.4 / −3.4 % / 75 % |
| 0.40 | 8.9 / −3.6 % / 80 % | 9.4 / −6.0 % / 70 % | 8.6 / −4.8 % / 75 % | 8.2 / −4.3 % / 70 % |
| 0.45 | 11.2 / −5.8 % / 70 % | 11.5 / −7.4 % / 55 % | 9.6 / −5.9 % / 70 % | 9.0 / −5.3 % / 70 % |
| 0.50 | 13.1 / −7.5 % / 65 % | 13.3 / −8.6 % / 50 % | 11.2 / −7.0 % / 60 % | 10.2 / −6.2 % / 70 % |

On the 11 original validation sites, which no model trained on
(`evaluate.py` per site, best of 0.25–0.50), all four models lie within
about one vehicle of each other (MAE 3.8–5.0); round 02 is the only one with
all 11 sites within 10 %. The public DOTA start weights (`yolo11s-obb.pt`,
`yolo26s-obb.pt`) miss 17–27 % of the vehicles on the same sites (MAE 25.7
and 40.6 at their best threshold).

**Why this model.** Round 02 has the lowest error and every site within
10 % at 0.30, where the shipped model at its threshold 0.45 is 11.2 vehicles
off on the audited labels. 0.30 is the lowest threshold of the app sweep;
the Ultralytics sweep is flat between 0.25 and 0.30, so the optimum is not
cut off by much.

**Limitations.**

- 9 of the 20 validation sites were in round 02's training data; on unseen
  sites the error is likely closer to scratch-01's 6.5. The threshold was
  chosen on the same sites it is reported on.
- 15 of the 20 validation sites were audited with suggestions of the
  2026-10-10 model, so the labels lean slightly towards that model family.
- Tiles are scored whole, without boundary clip and roof mask; German state
  orthophotos only.
- A new shipped model changes vehicle counts and therefore the hail EAL of
  every location. Counts remain a screening estimate.

## Shipped model (2026-11)

**What shipped in v0.5.0.** Release installers contained `dealer_vehicles` 2026-10-10
(YOLO11s-OBB fine-tuned on state DOP tiles of dealership sites and DLR 3K
Munich, base confidence 0.45). It comes from the GitHub release
`model-dealer-vehicles-2026-10-10`, which holds only the ONNX model and its
manifest and is not marked as the latest release (the app updater reads the
latest one). `desktop-app/src/shared/model-release.json` pins the tag and the
SHA-256 of both files:

- The release build runs `npm run fetch:model` before `electron-builder`. It
  downloads both files into `resources/models/`, checks both hashes and fails
  the build on a missing asset or a mismatch.
- The installation wizard downloads the same two files when a build has no
  model (development builds). It checks both pinned hashes and that the
  manifest names the same ONNX hash, then installs them into
  `userData/models`. Before this change the wizard pointed at a
  `latest/download/yolov26s_aerial_vehicles.onnx` asset that no release had,
  so a fresh install ran without a model and fell back to the area heuristic.

**Why this model.** Two newer runs were measured against it on 2026-11-14
with the app's own window inference (`npm run benchmark:detection`, the
11 held-out sites, 99 tiles, 1,638 labelled vehicles):

| Base confidence | dealer_vehicles 2026-10-10 | Pseudo-label run (YOLO11s) | YOLO26s run |
|---|---|---|---|
| 0.30 | 11.0 / +7.4 % / 64 % | 12.5 / +7.3 % / 55 % | **7.8 / −1.2 % / 73 %** |
| 0.35 | 9.1 / +5.3 % / 64 % | 11.2 / +5.4 % / 73 % | 8.5 / −4.0 % / 82 % |
| 0.40 | **7.5 / +2.7 % / 73 %** | 8.9 / +3.5 % / 82 % | 10.9 / −6.1 % / 73 % |
| 0.45 | 8.0 / +0.2 % / 73 % | 8.9 / +2.0 % / 73 % | 13.6 / −8.6 % / 64 % |
| 0.50 | 8.1 / −1.2 % / 82 % | **8.6 / +0.7 % / 82 %** | 17.6 / −11.8 % / 45 % |
| 0.55 | 8.9 / −2.8 % / 82 % | 9.3 / −1.2 % / 82 % | 22.3 / −15.0 % / 36 % |

Cells are count MAE / bias / share of sites within 10 %. The pseudo-label run
(`make_dataset.py --pseudo`, 24 unreviewed sites added from model labels) and
the YOLO26s run reach the same accuracy at their best threshold. Neither beats
the installed model by more than the noise of 11 sites, so the measured and
documented model ships unchanged. Its manifest threshold 0.45 stays: it has
the smallest bias in the flat optimum (0.40–0.50).

**Licences.** The model weights derive from Ultralytics (AGPL-3.0) and were
pretrained on DOTA and fine-tuned with DLR 3K Munich tiles, both released for
research (`training/README.md`, "Licences"). The app itself is PolyForm Noncommercial.
Check these terms before any commercial use of the app or the model.

**Publishing a new model.** Train and evaluate it (`training/studio.py`
does every step), measure it with `npm run benchmark:detection`, export it
with `--default-conf`, then upload `dealer_vehicles.onnx` and
`dealer_vehicles.json` to a new `model-dealer-vehicles-<version>` release
with `--latest=false`, and update the tag and both hashes in
`model-release.json` (the studio's "Release-Modell" buttons write the file and
print the commands). Add the run to the table below. A new shipped model
changes vehicle counts and therefore the hail EAL of every location.

**Limitations.** Same as above: 11 validation sites, tiles scored whole
without boundary clip and roof mask, and German state orthophotos only.

## One vehicle class (2026-11)

**Change.** From 2026-11-14, `training/make_dataset.py` trains a single
class `vehicle` instead of `car` and `large_vehicle`, and the training
studio no longer asks for a class. Labels keep their class in the tile
files, so `--classes car-large` rebuilds the old dataset.

**Why.** The app is class-blind where it matters: the hail EAL uses the
sum of all classes (`hailVehicleBasis` in `src/shared/risk-math.ts`), and
the size filter and NMS ignore the class. A second class therefore only
cost labelling time (a class decision per box) and added class confusion;
large vehicles are rare (156 of 1,638 validation vehicles) and were missed
24 % of the time at base confidence 0.45.

**Effect on models.** The shipped model `dealer_vehicles` 2026-10-10 keeps
its two classes; its manifest maps both to app vehicle classes and the
counts are summed as before. A one-class model gets the manifest
`classes {0: vehicle}`, `vehicleClasses {0: car}` and no class offset (the
two-class model raised the threshold for large vehicles by 0.05). Its first
fine-tuning round starts from the two-class weights with a new
classification head. Whether one class counts better is decided by the
app-pipeline benchmark of that round, not assumed; until then nothing
changes for users.

## Benchmark runs

| Date | Model | Imagery | Sites | Count MAE | Bias | Within 10 % |
|---|---|---|---|---|---|---|
| 2026-11-13 | dealer_vehicles 2026-10-10, base conf 0.22 | State DOP tiles, 0.10 m/px | 11 | 18.5 | +12.5 % | 36 % |
| 2026-11-13 | dealer_vehicles 2026-10-10, base conf 0.45 | State DOP tiles, 0.10 m/px | 11 | 8.5 | +0.9 % | 73 % |
| 2026-11-14 | dealer_vehicles 2026-10-10, base conf 0.45 (shipped) | State DOP tiles, 0.10 m/px | 11 | 8.0 | +0.2 % | 73 % |
| 2026-11-14 | Pseudo-label run 2026-11-14, base conf 0.50 | State DOP tiles, 0.10 m/px | 11 | 8.6 | +0.7 % | 82 % |
| 2026-11-14 | YOLO26s run 2026-11-14, base conf 0.30 | State DOP tiles, 0.10 m/px | 11 | 7.8 | −1.2 % | 73 % |
| 2026-11-19 | dealer_vehicles 2026-10-10, base conf 0.45, audited labels | State DOP tiles, 0.10 m/px | 20 | 11.2 | −5.8 % | 70 % |
| 2026-11-19 | round 02, base conf 0.30 (shipped from v0.6.0) | State DOP tiles, 0.10 m/px | 20 | 5.7 | −2.0 % | 100 % |
| 2026-11-19 | scratch-01, base conf 0.30 (no validation site in training) | State DOP tiles, 0.10 m/px | 20 | 6.5 | −2.2 % | 85 % |
