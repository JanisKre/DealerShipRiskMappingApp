# Risk model and evidence

The application now keeps the calculation pipeline explicit:

```text
Hazard provider → exposure → vulnerability/loss → portfolio aggregation
```

The orchestration entry point is
`desktop-app/src/main/services/risk.service.ts`. The model layers are in
`desktop-app/src/main/services/risk/`:

- `hazard-models.ts` maps the hail indicator to a 0–100 hail score.
- `exposure.ts` estimates vehicle value and site capacity.
- `financial-loss.ts` calculates the hail EAL (see below).
- `evidence.ts` attaches provenance, confidence, fallbacks, and limitations.

Every new risk result includes a model version, overall confidence, source
evidence, and limitations.

## Hail only (screening-0.5.0)

The application assesses hail and nothing else. Since `screening-0.5.0` the
storm, lightning, snow, flood and heat scores are no longer computed, shown
or exported; `PERILS` in `shared/types.ts` is `["hail"]`.

The hail score (0–100) comes from, in this order:

1. a licensed provider's hail value, if a hail source is chosen in the
   settings and delivers one;
2. the postcode hail zone (`shared/hail-zones.ts`): `(zone − 1) / 5 × 100`;
3. the Open-Meteo screening proxy: 3 × the share of days with a daily
   maximum CAPE ≥ 1,500 J/kg plus 0.3 × the share with ≥ 1,000 J/kg, over a
   92-day window, clamped to 5–90 %. Only the hourly CAPE series is
   requested.

Data sources: GDV/K-Kasko hail zones by postcode, Open-Meteo forecast API
(CAPE), optionally a contracted hail provider. Limitations: the CAPE proxy
reflects a recent 92-day window, not a hail climatology; hail zones describe
regional hazard, not the individual site.

Removed with this version: the score caps for wind, lightning, snow, heat
and flood on the parameters page, the per-peril map overlays, the ZÜRS Geo
import (flood and heavy-rain classes) and the flood specialists JBA and
Fathom. Stored data stays readable: on load, `shared/retired-perils.ts`
strips scores and provider values of the removed perils, `PerilScoresSchema`
drops them when a session is parsed, and the NatCat settings turn a former
per-peril hail choice into the hail source and drop retired providers
(`migrateNatCatSettings`). Results from older model versions are flagged on
the dashboard for recalculation. Deterministic fixtures:
`hazard-models.test.ts`, `retired-perils.test.ts`, `natcat-routing.test.ts`.

## Hail EAL (screening-0.4.0)

The portfolio is underwritten for hail only, so the expected annual loss
(EAL) is a hail loss per location:

```text
EAL = N × λ_z × (p_S·S_S + p_M·S_M + p_L·S_L)
```

| Symbol | Meaning | Source |
|---|---|---|
| N | Vehicles counted on the lot | Manually reviewed count, else the detector count. Only vehicles on the lot are counted: no count is estimated from the asset value and no vehicles inside buildings are assumed |
| z | Hail zone 1–6 | Licensed provider hail score if chosen, else the postcode table (`shared/hail-zones.ts`), else estimated from the weather-based hail score as `1 + round(score / 20)` (flagged, lower confidence) |
| λ_z | Damaging hail events per year at a site in zone z | Parameter per zone |
| p_S, p_M, p_L | Share of small, medium, large events | Parameters; normalized by their sum, so they act as weights |
| S_S, S_M, S_L | Loss per vehicle in an event of that class (EUR) | Parameters |

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

### Hail zone map overlay

The map layer "Hail zones (postcodes)" colors every German postcode area by its
hail zone 1–6 (green → dark red), using the same table as the EAL
(`shared/hail-zones.ts`). The outlines come from the OpenStreetMap-derived
[`yetzt/postleitzahlen`](https://github.com/yetzt/postleitzahlen) release
(ODbL 1.0, © OpenStreetMap contributors, credited in the map). The first
activation downloads them (about 14 MB) from GitHub; the main process
simplifies the shared borders to roughly 130 m, joins the zones and caches the
result in the user data folder (`hail-zones/overlay-v1.json`), so later use is
offline. Limitations: the outlines are simplified and not survey-grade; a
postcode without an entry in the zone table is not drawn; the zone table is
dated 2024 while the outlines are newer, so recently changed postcodes can be
missing or differ.

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

## Portfolio terms and business type

Portfolio uploads (CSV/TSV/XLSX) may carry per-location policy terms and a
business type; `main/services/csv.service.ts` lists the recognised column
names (English and German).

- **Maximum indemnity** (`productLimitEur`) is the per-location coverage cap
  used by the product-limit check against exposure.
- **Deductible** (`deductibleEur`) is stored, shown and exported as
  underwriting metadata only. The hail EAL stays a gross screening figure;
  the deductible is not netted out.
- **Business type**: existing business (`insured: true`) counts towards
  accumulation with neighbouring insured locations and is drawn as a filled
  map pin; new business — including rows whose type is unknown — is drawn as
  an outlined pin and is assessed as a prospect. Unrecognised values in the
  business-type column are reported in the import report and left
  unclassified rather than guessed.

## Licensed hail providers

The hail score accepts a normalized value from a licensed provider without
persisting raw vendor payloads:

- Licensed APIs (Swiss Re CatNet, Munich Re Location Risk Intelligence,
  Moody's RMS and Verisk Location Intelligence, or any other service) are
  accessed through customer-configured HTTPS endpoints that answer in the
  app's hazard API contract below
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
{ "latitude": 50.11, "longitude": 8.68, "perils": ["hail"] }

200 OK
{
  "hazards": [            // at least one
    { "peril": "hail", "score": 72,              // score 0–100, required
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

Only the `hail` entry is used; other peril names in a response are ignored.
Only the coordinates leave the device. Endpoints must use HTTPS, may not embed
credentials, and keys are stored per provider in the OS keychain.

### Hail source

`shared/natcat-routing.ts` picks the source of the hail score. The settings
hold one hail source (`primary`, default: screening). When it is a connected
API provider, that provider is queried and its `hail` value overrides the
screening score; any other hazard in the response is dropped. When the
provider fails, is not connected, or returns no hail value, the screening
score applies. Every analysis resolves the source from the current settings,
so API values are never re-used after the source changed. "Reset to default"
sets the hail source back to screening and keeps the connectors. A failed
source never aborts an analysis. Deterministic fixtures:
`natcat-routing.test.ts`, `natcat.service.test.ts`.

Limitations: a provider's hail score is used as delivered; the app does not
reconcile different vendors' scales, return periods, or vulnerability
assumptions. It is a screening input and not a substitute for a calibrated
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

Vehicle detection runs before the boundary: the georeferenced detections
are supporting evidence for the fused lot boundary (capped below the
confirmation threshold, damped outside the site's parcels, ignored on other
businesses' premises) and are afterwards clipped to the chosen boundary for
the count. See [boundary-model.md](boundary-model.md#vehicle-evidence-fusion-v4).

A boundary is flagged for review by `shared/boundary-review.ts`. A human can
clear the flag in two ways: by editing the geometry (source becomes
`manual`) or by confirming the detected geometry as covering the lot, which
stores `confirmedAt`. Both mean the user checked it visually; neither is a
survey. A confirmation is kept in the limitations, and re-analysing the
location produces a fresh, unconfirmed boundary.
