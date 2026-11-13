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
   orthophotos).
2. Otherwise the downloadable `yolov26s_aerial_vehicles.onnx`.
   - It was trained on VisDrone (low-altitude, partly oblique drone video).
   - It uses a built-in manifest.
   - Its known weakness is under-counting dense, angled parking rows.

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

## Benchmark runs

| Date | Model | Imagery | Sites | Count MAE | Bias | Within 10 % |
|---|---|---|---|---|---|---|
| 2026-11-13 | dealer_vehicles 2026-10-10, base conf 0.22 | State DOP tiles, 0.10 m/px | 11 | 18.5 | +12.5 % | 36 % |
| 2026-11-13 | dealer_vehicles 2026-10-10, base conf 0.45 | State DOP tiles, 0.10 m/px | 11 | 8.5 | +0.9 % | 73 % |
