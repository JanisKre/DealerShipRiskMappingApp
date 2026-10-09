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
- `financial-loss.ts` calculates the hail EAL (see below).
- `evidence.ts` attaches provenance, confidence, fallbacks, and limitations.

Every new risk result includes a model version, overall confidence, source
evidence, and limitations. The non-hail peril scores (wind, lightning, snow,
flood, heat) are still computed for the detail view, but since
`screening-0.4.0` they no longer feed the loss figure; the flood score remains
a precipitation proxy that a hydraulic provider can replace behind the
provider boundary.

## Hail EAL (screening-0.4.0)

The portfolio is underwritten for hail only, so the expected annual loss
(EAL) is a hail loss per location:

```text
EAL = N_exposed × λ_z × (p_S·S_S + p_M·S_M + p_L·S_L)
N_exposed = N × exposure ratio
```

| Symbol | Meaning | Source |
|---|---|---|
| N | Vehicles on site | Manually reviewed count, else the detector count; without either, declared asset value ÷ car value (flagged as a limitation) |
| exposure ratio | Share of vehicles parked in the open: `clamp(1 − roof coverage, 0.1, 1)` | `roof.service.ts`, from buildings inside the lot boundary |
| z | Hail zone 1–6 | Licensed provider hail score if routed, else the postcode table (`shared/hail-zones.ts`), else estimated from the weather-based hail score as `1 + round(score / 20)` (flagged, lower confidence) |
| λ_z | Damaging hail events per year at a site in zone z | Parameter per zone |
| p_S, p_M, p_L | Share of small, medium, large events | Parameters; normalized by their sum, so they act as weights |
| S_S, S_M, S_L | Loss per exposed vehicle in an event of that class (EUR) | Parameters |

The implementation is `computeHailEal` in `shared/risk-math.ts`; the result
stores every input (`ealBreakdown.hailDetail`), so the detail dialog shows the
calculation for each location.

### Default values (placeholders)

The defaults are **uncalibrated screening placeholders** agreed as starting
values until the underwriting team supplies calibrated figures. They are not
derived from loss data. Every result carries the limitation "Hail EAL
frequency and severity parameters are uncalibrated placeholders".

| Zone | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| λ_z (events/year) | 0.01 | 0.02 | 0.04 | 0.07 | 0.10 | 0.15 |

| Class | p | S (EUR per vehicle) |
|---|---|---|
| small | 0.60 | 800 |
| medium | 0.30 | 3,000 |
| large | 0.10 | 7,000 |

With these values Σ p·S = 2,080 EUR, so a zone-6 site loses about 312 EUR per
open-air vehicle and year. The values are editable under Parameters → Hail
EAL; a change rescores every location.

### Limitations

- A screening estimate, not an engineering, tariff, underwriting, or insurance
  decision.
- λ, p, and S are placeholders until calibrated against loss experience.
- Hail zones describe regional hazard; local exposure (e.g. temporary
  covers, vehicles moved before a storm) is not modeled.
- The vehicle count is a snapshot of the aerial image; stock varies over the
  year.
- Results stored by an older model version keep their old EAL until they are
  recalculated (the dashboard offers this).

### Portfolio views

- **Largest accumulations**: single-linkage groups of locations within
  `accumulationRadiusKm` (default 10 km), sorted by exposure. The loss
  scenario per accumulation is exposure × `scenarioDamageMedium` (15 %); it
  replaces the former PML tile on the dashboard and is not a PML from a
  catastrophe model.
- **Review notes** are fixed rules: hail zone ≥ `alertHailZone` (5), share of
  the portfolio EAL ≥ `alertEalPortfolioShare` (20 %), an accumulation with
  exposure ≥ `accumulationReinsureThresholdEur`, and data-quality checks
  (utilisation, boundary confidence, zero vehicles, estimated hail zone).

## Licensed natural-catastrophe providers

The shared natural-catastrophe model accepts normalized observations from
licensed providers without persisting raw vendor payloads:

- ZÜRS Geo CSV/XLSX exports are detected by their class columns and imported
  at address/building resolution. Flood classes 1–4 and heavy-rain classes
  1–3 are retained as raw attributes and displayed as normalized scores. The
  class-to-score mapping is a screening visualization, not an insurance
  tariff.
- Licensed APIs (Swiss Re CatNet, Munich Re Location Risk Intelligence,
  Moody's RMS and Verisk Location Intelligence, JBA, Fathom, or any other
  service) are accessed through customer-configured HTTPS endpoints that
  answer in the app's hazard API contract below
  (`main/services/hazard-api.service.ts`). The vendors publish their
  production schemas only to contracted clients, so a vendor's native API is
  connected through a translation service on the customer side rather than a
  guessed adapter. The catalog in `shared/natcat-catalog.ts` lists coverage
  per vendor as publicly described (October 2026); it is informational, the
  contracted product defines what an endpoint returns.

Provider evidence is attached to each assessment and the resulting risk. If a
provider supplies only classes or scores without frequency/loss curves, the
existing EAL remains a screening estimate and is labeled accordingly.

### Hazard API contract

```
POST <endpoint>            Authorization: Bearer <key>
{ "latitude": 50.11, "longitude": 8.68, "perils": ["flood"] }   // perils optional

200 OK
{
  "hazards": [            // at least one
    { "peril": "flood", "score": 72,             // score 0–100, required
      "hazardValue": 0.02, "unit": "AEP",        // optional
      "rawValue": "class 3",                     // optional, kept as source value
      "returnPeriodYears": 50,                   // optional
      "annualExceedanceProbability": 0.02 }      // optional, (0, 1]
  ],
  "dataVersion": "2026.1",                       // optional
  "spatialResolution": "5 m",                    // optional
  "attributes": { "zone": "B" }                  // optional, string/number/bool
}
```

Scored perils are `wind`, `lightning`, `snow`, `flood`, `hail` and `heat`;
other peril names (e.g. `heavyRain`) are kept and displayed but not scored.
Only the coordinates leave the device. Endpoints must use HTTPS, may not embed
credentials, and keys are stored per provider in the OS keychain.

### Source routing per peril

`shared/natcat-routing.ts` decides per scored peril which source supplies the
value. The settings hold a primary source (default: screening) and optional
per-peril choices (`primary`, `screening`, or a connected API provider). For
each peril the first source in this chain that delivers a value wins:

1. the API provider chosen for this peril,
2. the location's imported data (ZÜRS Geo),
3. the primary source, if it is an API provider,
4. otherwise the Open-Meteo screening model.

Choosing `screening` for a peril bypasses the chain. Each hazard records its
`provider`; an assessment built from more than one source has provider
`composite`, the minimum confidence of its sources, and the union of their
limitations. When the responsible API source fails, is not connected, or —
when chosen explicitly — returns no value for the peril, the fallback is
written to the limitations (`"flood: … unavailable; … used instead"`) and
`fallbackUsed` is set. A primary source that does not cover a peril is not a
fallback; that peril simply stays on screening.

Every analysis re-routes from the current settings. Only the user's import is
kept between runs (`DealershipInput.natCatImport`; older sessions are read
from `natCat` when its provider is `zuers-geo`), so API values are never
re-used after the routing changed. "Reset to default" sets the primary source
and every peril back to screening and keeps the connectors. A failed source
never aborts an analysis. Deterministic fixtures: `natcat-routing.test.ts`.

Limitations: the routing combines scores; it does not reconcile different
vendors' scales, return periods, or vulnerability assumptions. Mixing sources
per peril is a screening choice and not a substitute for a calibrated
catastrophe model.

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

A boundary is flagged for review by `shared/boundary-review.ts`. A human can
clear the flag in two ways: by editing the geometry (source becomes
`manual`) or by confirming the detected geometry as covering the lot, which
stores `confirmedAt`. Both mean the user checked it visually; neither is a
survey. A confirmation is kept in the limitations, and re-analysing the
location produces a fresh, unconfirmed boundary.
