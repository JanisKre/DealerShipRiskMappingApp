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
3. Slice it into full-size windows (model input size, 50 % overlap). Edge
   windows are pulled inside the mosaic. Mosaics smaller than one window are
   padded, never upscaled.
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

## Benchmark runs

| Date | Model | Imagery | Sites | Count MAE | Bias | Within 10 % |
|---|---|---|---|---|---|---|
| – | – | – | – | – | – | – |
