# Risk model and evidence

The application now keeps the calculation pipeline explicit:

```text
Hazard provider → exposure → vulnerability/loss → portfolio aggregation
```

The orchestration entry point is
`desktop-app/src/main/services/risk.service.ts`. The model layers are in
`desktop-app/src/main/services/risk/`:

- `hazard-models.ts` maps hazard indicators to comparable 0–100 scores.
- `exposure.ts` estimates vehicle value and site capacity.
- `financial-loss.ts` calculates the per-peril EAL breakdown.
- `evidence.ts` attaches provenance, confidence, fallbacks, and limitations.

Every new risk result includes a model version, overall confidence, source
evidence, and limitations. The current flood component is intentionally a
screening proxy based on precipitation; a hydraulic provider can replace it
behind the provider boundary without changing the renderer contract.

## Licensed natural-catastrophe providers

The shared natural-catastrophe model accepts normalized observations from
licensed providers without persisting raw vendor payloads:

- ZÜRS Geo CSV/XLSX exports are detected by their class columns and imported
  at address/building resolution. Flood classes 1–4 and heavy-rain classes
  1–3 are retained as raw attributes and displayed as normalized scores. The
  class-to-score mapping is a screening visualization, not an insurance
  tariff.
- Swiss Re CatNet is accessed through a customer-configured HTTPS endpoint.
  The adapter accepts normalized hazard scores and optional annual exceedance
  probabilities or return periods. The exact endpoint schema must come from
  the customer's Swiss Re contract/API documentation.

Provider evidence is attached to each assessment and the resulting risk. If a
provider supplies only classes or scores without frequency/loss curves, the
existing EAL remains a screening estimate and is labeled accordingly.

Import reports and scenario impacts follow the same principle: inputs,
assumptions, versions, and quality warnings are kept next to the result.

## Lot boundary and vehicle detection

`desktop-app/src/main/services/detection.service.ts` runs a sliding-window
YOLO-ONNX detector over aerial imagery captured at `DETECTION_ZOOM`
(`shared/constants.ts`). Detection boxes are sanity-checked against
real-world vehicle size bounds (`VEHICLE_MIN_WIDTH_M`, `VEHICLE_MAX_LENGTH_M`,
`VEHICLE_MAX_ASPECT_RATIO`), converting model-input pixels to meters via the
capture's own ground resolution — this keeps the check correct regardless of
capture zoom, crop size, or edge-crop upscaling (a fixed pixel threshold
quietly miscalibrates whenever any of those change). `tiles.service.ts`
retries one zoom level down when a region doesn't publish imagery as sharp
as requested, so raising the capture resolution doesn't regress coverage in
lower-resolution areas.

The aerial paved-surface boundary candidate
(`surface-boundary.service.ts`) identifies a connected paved region and
returns its footprint as a low-confidence, reviewable candidate — never
treated as proof, per the provider pipeline in `boundary.service.ts`. The
footprint is built with a concave ("digging") hull
(`boundary-geometry.ts#nonConvexHull`) rather than a plain convex hull: a
convex hull bridges any concave notch (an L-shaped site, two separated
parking islands) with a straight edge, silently including whatever land
sits in the notch. Industrial sites are disproportionately non-convex, so
this was a systematic source of over-large, inaccurate lot boundaries there.
The digging hull only pulls a vertex inward when the point cloud's own
outline supports it, is validated against self-intersection, and falls back
to the plain convex hull otherwise — it can enclose less area than a convex
hull but never more, and never produces an invalid polygon.
