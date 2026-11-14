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

## Corrections (screening-0.5.1)

A code review in November 2026 found four calculations that did not do what
this document says. They are corrected; deterministic fixtures are in
`shared/risk-math.test.ts` ("fixes from the November 2026 code review").

- **No vehicle count from the fallback detector.** Without an installed
  model, `StubVehicleDetector` estimates "vehicles" as lot area / 25 m². That
  number went into the hail EAL as a detected count. `hailVehicleBasis` now
  gives N = 0 (`vehicleSource: "none"`) for it, as the N row in the table
  below requires; a manually reviewed count is still used. Exposure keeps
  the estimate and the limitation "Vehicle exposure is estimated because no
  ML model is installed".
- **Scenario corridor on the ground.** The nearest point on a storm-track
  segment was found in raw degrees, so on a diagonal track at 50° N a
  location up to about 7 % inside the half width counted as outside. The
  projection now shortens longitude by cos(latitude) before the haversine
  distance is taken.
- **Pricing hint at the threshold.** Reinsurance is recommended from
  accumulated exposure ≥ threshold; the pricing hint now turns "high" at the
  same point (it was "normal" at exactly 100 %).
- **Edited parameters everywhere.** The product-limit check's mid-event loss
  uses `scenarioDamageMedium`, and the group view uses
  `accumulationReinsureThresholdEur`, instead of the built-in defaults.

Limitations are unchanged: these remain screening estimates. Results stored
by `screening-0.5.0` are offered for recalculation on the dashboard; only
locations scored with the fallback detector change their EAL.

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

### Vehicle count provenance

`hailDetail.vehicleSource` records where N came from: `manual` (reviewed by
an underwriter), `detected` (the ONNX vehicle detector), or `none`. The
area figure of the fallback detector (`stub-area-heuristic`, lot area ÷
25 m²) never enters N (see the November 2026 fixes above), but exposure and
the vehicle column still show it. The UI therefore calls it an area-based
estimate, never "detected": the detail dialog says so, and the dashboard
table, top list and KPI tiles mark such values with "≈". Results stored by
older builds that labelled the area figure `detected` are shown as
`estimated` (`displayedHailVehicleSource`); that is a label only.

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

### Stock range (November 2026)

The count N is a snapshot of one aerial image; a dealer's stock turns over
within weeks. Where the stock was counted on archived images
(`DetectionResult.timeline`, docs/imagery-sources.md), the hail EAL detail
also carries `stockRange`: the EAL at the lowest, the median and the
highest archived count, with the same λ_z and Σ p·S.

- The archived counts are machine counts. When N was reviewed by hand, they
  are scaled by N ÷ the machine count on the analysed image, so the range
  is on the scale of N (`scaledToManual`); without a machine count there is
  no range.
- At least two archived counts are needed.
- `snapshot` compares N with the archived median: more than 30 % above is
  `high`, more than 30 % below `low`. Then the result carries the
  limitation "Stock snapshot not typical: …", and the detail dialog says the
  point EAL is likely too high or too low.
- The point EAL, the exposure and every portfolio sum keep the current N.
  The hail EAL tile adds the portfolio range: locations with a range
  contribute their low and high EAL, the others their point EAL.
- Counting is on request (detail dialog, or "Stock over time" on the
  dashboard for the 20 locations with the highest EAL and no count yet), as
  each location takes up to four detector runs.

The implementation is `stockRangeVehicles` in `shared/vehicle-timeline.ts`
and `computeEalBreakdown` in `risk/financial-loss.ts`; deterministic
fixtures in `financial-loss.test.ts`. Limitations: the archived images are
years apart and from different seasons; the range mixes stock variation with
differences in image quality, boundary fit and site changes, and does not
cover the stock between the dates.

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
- **Hailstorm scenario** (map): a site is affected when its distance to the
  drawn path is at most half the corridor width, measured on the ground (see
  "Scenario corridor on the ground" above). The map draws the corridor as
  the same metric buffer (`components/map/scenarioCorridor.ts`), so what is
  drawn and what is counted agree. Limitation: every affected site gets the
  same intensity; the corridor is a stress test, not a hail footprint.

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

## Hail history (context only)

The detail dialog and the one-page location report show how often hail was
observed near a location. Source: the Deutscher Wetterdienst Climate Data
Center, daily weather phenomena of the station network
(`observations_germany/climate/daily/weather_phenomena`, historical and
recent archives), column `HAGEL` (1 = hail observed at the station that
day). Data basis: Deutscher Wetterdienst (open data; attribution shown in
the app and the report).

Method: the three nearest stations within 30 km with at least ten years of
records; a year counts when it has at least 180 valid daily values; the
result is the mean number of hail days per observed year, the observed
period, hail days per year and every hail date (shown by year and by
calendar month; years without enough observations are marked as gaps, not
as years without hail). Station list,
directory listings and per-station summaries are cached (1–7 days), so the
history also shows offline once loaded.

Limitations: these are point observations, not an event catalogue — a
storm that misses the station is not recorded, and most stations stopped
observing weather phenomena when observation was automated (around 2011),
so recent years are often missing. **The history never enters the hail EAL**
and does not change any score; it is context for the underwriter.
Deterministic fixtures: `hail-history.service.test.ts`.

## Radar hail cells (context only)

The station history ends around 2011 at most stations, and no open,
licence-compatible hail event catalogue for Germany was found (checked
14 November 2026): the European Severe Weather Database (ESWD) is licensed
for non-commercial use only, and the radar hail tracks of KIT (Mohr et al.,
2026) are published as an article, not as data. Hourly present-weather codes
of the DWD stations were checked too: three airport stations recorded almost
no hail days after automation, so they do not fill the gap.

What is open is DWD's radar cell tracking KONRAD3D
(`opendata.dwd.de/weather/radar/konrad3d/`, 5-minute XML files of the last
48 hours, Germany-wide). Each cell has an outline and a hydrometeor
classification. The app keeps a **local archive**: on each sync (detail
dialog, at most every 10 minutes) it downloads the files it does not have
yet and stores only cells with hail. The archive therefore starts with the
first use and grows while the app is used at least every two days.

- Classes: `large` (area classified as large hail), `hail` (area classified
  as hail), `mixed` (rain–hail mixture with the cell's hail flag).
- A location has a hail day when a hail cell's outline passed within 1 km of
  it; the day keeps the worst class, the first and last time step, the
  closest distance and the highest reflectivity.
- No location leaves the computer: the files cover Germany, and the
  comparison runs locally.

Limitations: the outline is the whole storm cell, and hail falls in part of
it, so a cell over the site does not prove hail on the lot. Rain–hail
mixtures in the cold season are mostly graupel. Gaps of more than 48 hours
between uses are missing from the archive. **The radar cells never enter the
hail EAL** and do not change any score. Data basis: Deutscher Wetterdienst
(open data; attribution shown in the app). Deterministic fixtures:
`radar-hail.service.test.ts`.

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

Since cascade v3 the boundary also uses official building footprints
(unbuilt area of a parcel, the showroom inside a vehicle outline) and keeps
densely packed roof decks in the vehicle count; the exposure area and the
vehicle count therefore change for sites whose boundary changed. See
[boundary-model.md](boundary-model.md#cascade-v3-november-2026).

A boundary is flagged for review by `shared/boundary-review.ts`. A human can
clear the flag in two ways: by editing the geometry (source becomes
`manual`) or by confirming the detected geometry as covering the lot, which
stores `confirmedAt`. Both mean the user checked it visually; neither is a
survey. A confirmation is kept in the limitations, and re-analysing the
location produces a fresh, unconfirmed boundary.
