# Boundary model

How the app decides where a dealership's operational lot is, how good that
answer is, and how to measure whether a change made it better.

This document covers the *lot boundary* only. The risk model that consumes the
resulting area lives in [risk-model.md](risk-model.md); the vehicle detector
that runs inside the boundary is in
[detection-benchmark.md](detection-benchmark.md).

## What the boundary is meant to be

The **operational lot**: the contiguous area a dealership actually uses —
display forecourt, customer and staff parking, workshop yard, and the buildings
between them.

It is deliberately *not*:

- a **cadastral parcel**, which is a legal unit. Dealerships routinely occupy
  several adjacent parcels, or only part of one.
- a **building footprint**, which is the showroom, not the lot.
- a **single OSM parking polygon**, which is usually one bay of several.

That gap is the central design constraint: the shape we want is normally the
*union* of things several sources each describe partially, bounded by roads,
fences and greenery. No source publishes it directly.

## Measuring quality

`npm run benchmark:boundary` (in `desktop-app/`) scores the engine against
`resources/benchmarks/boundary-public-fixtures.json` — real, publicly mapped
`shop=car` areas from OpenStreetMap, regenerable with
`scripts/build-public-boundary-fixtures.mjs`. See
`resources/benchmarks/LICENSES.md` for licensing and for what these references
are and are not.

Reported metrics come from `src/main/services/boundary-benchmark.ts`:

| Metric | Reads as |
| --- | --- |
| mean IoU | overall shape agreement |
| mean Boundary-F1 @ 2 m | how closely the *outline* tracks the reference |
| mean coverage | share of the true lot that was captured |
| coverage ≥ 90% rate | share of sites essentially fully captured |
| mean area bias | `predicted/reference − 1`; **positive means too large** |
| calibration MAE | how far stated confidence is from realised IoU |

Overlap is measured on a **0.5 m raster** (`polygonRasterIoU`). The older
`approximatePolygonIoU` clamps to a 200×200 sample grid, which over a 400 m
site is 2 m per cell — the same magnitude as the 2 m tolerance the Boundary-F1
metric reports against, so it could not resolve the errors it was meant to
measure. `approximatePolygonIoU` remains in use for the cheap in-pipeline
`sourceAgreement` signal, where that precision is not needed.

### Strata

Results are reported three ways: **all**, **tuning**, and **hold-out**. The
hold-out stratum is what decides whether a change is an improvement. Splitting
is **geographic**, by region — not random — because two dealerships a few
hundred metres apart share imagery, cadastre service and mapping conventions,
so a random split leaks.

### What the public set deliberately does not measure

The benchmark calls detection with **coordinates only** — no name, no address —
even though the fixtures carry both.

That is not an oversight. The reference polygon *is* the OSM object; passing its
name to an address-matching provider would have that provider look up that exact
object and hand it back, producing an IoU near 1.0 that measures nothing. The
public set therefore scores the coordinate-only path, which is the honest
setting for it.

The consequence is that identity-matched sources — `nominatim-polygon`, and OSM
name matching inside `scoreOsmBoundary` — contribute nothing here by
construction. Their value can only be measured on the manual-correction set,
where the name and address come from the user's own portfolio rather than from
the reference.

### Ground truth from manual corrections

`scripts/export-boundary-groundtruth.mjs` turns saved manual boundary edits
into a second evaluation set: each corrected site yields the polygon the engine
produced and the polygon a human decided was right.

This set is **biased** and must be reported separately. Users only correct
boundaries they *noticed* were wrong, so it over-represents visible failures
and is silent about boundaries that were quietly wrong. It is also
customer-derived: the script refuses to write anywhere inside the git working
tree, and `*.local.json` is gitignored.

## Baseline: the engine before this work

Measured on the 17-site public set, engine as of v0.2.1. Recorded in
`resources/benchmarks/boundary-baseline.json`.

| | all (n=17) | tuning (n=13) | hold-out (n=4) |
| --- | --- | --- | --- |
| mean IoU | 0.331 | 0.334 | 0.323 |
| mean Boundary-F1 | 0.181 | 0.215 | 0.073 |
| mean coverage | 0.677 | 0.664 | 0.718 |
| coverage ≥ 90% | 0.294 | 0.308 | 0.250 |
| outline within 2 m | 0.059 | 0.077 | 0.000 |
| mean area bias | +0.900 | +0.772 | +1.317 |
| calibration MAE | 0.399 | 0.394 | 0.413 |

Read plainly: the predicted lot overlaps the true lot by about a third, is on
average **90% too large**, its outline is almost never within 2 m, and
**every one of the 17 sites was flagged for manual review**. Confidence is
badly calibrated — the engine reports ~0.8 where realised IoU is ~0.33.

Winning source: `alkis` on 11 sites (all in the seven states with a cadastre
service), `synthetic` — the 100 m fallback octagon — on the remaining 6.

## Findings this baseline exposed

**1. The OSM semantic provider returned nothing, ever.** The reference
polygons in the benchmark *are* OSM `shop=car` ways; the pipeline queries OSM
for exactly that tag; and it still never produced a candidate.

The cause is the Overpass output statement. `fromOsm` ended its query with
`out geom center tags;`. Queried directly, that statement returns the expected
38 elements around a test site — including the exact reference way — but **not
one of them carries a `geometry` array**. `fromOsm` then drops every element at
its `e.geometry && e.geometry.length >= 3` filter and returns an empty list.
`out` takes at most one geometry mode, and combining `geom` with `center` (and
the `tags` verbosity, which omits coordinates) does not yield full geometry.
The fix is the plain `out geom;` that `fromOsmBuildings` already used — which
is why building candidates worked while the semantic dealership lookup did not.

This is the single most consequential finding in the baseline: the source that
maps the operational lot directly was inert, so the engine was choosing between
a cadastral parcel and a drawn circle.

Both halves of that were observed against the live service. `out geom` is what
`scripts/build-public-boundary-fixtures.mjs` uses, and it returned full rings of
16-53 points for all 17 fixtures. The shipped `out geom center tags;` returned
38 elements around a test site — including the exact reference way — and not
one `geometry` array among them.

**2. Outside the seven cadastre states there was no vector source at all.**
With OSM inert, sites in Bayern, Hessen and Austria fell straight through to
the synthetic octagon — a fixed 100 m ring drawn around the geocoded point.

**3. Cadastre alone over- or under-shoots badly.** Where ALKIS did win, the
single containing parcel ranged from 449 m² against a 6,889 m² reference to
33,496 m² against a 9,570 m² one. Both failure directions are the same root
cause: a dealership is not one parcel.

**4. Confidence did not track accuracy.** ALKIS candidates carry a fixed 0.9
prior, so sites reported ~0.8 confidence at ~0.3 IoU. A calibration MAE of 0.40
means the number cannot be used to triage review.

## Source cascade (current engine)

The app runs the **source cascade** (`src/main/services/boundary/cascade.ts`).
Version 2 (`CASCADE_VERSION` 2) lets the **detected vehicles decide how far the
site reaches and the cadastre decide its shape**.

### Why vehicles

Version 1 asked OSM first, then ALKIS, then OSM parking. In practice it almost
always returned a single ALKIS parcel, for two reasons:

- **OSM was not available.** The public Overpass servers answer "at capacity"
  most of the time and ask automated clients to run their own instance, so
  stages 1 and 3 rarely ran, and joining small parcels depended on OSM parking.
- **A parcel is not the lot.** Dealers use several adjacent plots (a showroom
  plot and a yard plot), or one plot of a larger dealer centre. No map source
  records which plots a dealer actually uses.

What a dealership insures against hail is the stock standing outside, and that
is exactly what the aerial image shows. The analysis detects the vehicles anyway
(`detectVehiclesInContext`, about 2–3 s), so version 2 builds on them.

### Stages

Each stage has **one acceptance rule**, and the first stage that accepts wins.

| Stage | Result | Accepted when | Confidence |
| --- | --- | --- | --- |
| 1 | Parcel at the point plus every adjacent parcel (shared edge) on which ≥ 10 lot vehicles stand; grows parcel by parcel | a vehicle lot exists, the parcel at the point is ≤ 30,000 m² | 0.75 when the parcels hold ≥ 80 % of the lot vehicles, else 0.6 |
| 2 | Outline of the vehicle lot | no usable parcel at the point, ≥ 20 lot vehicles | 0.55 |
| 3 | OSM dealer area — only when OSM is already cached | contains the point, or matches name/address within `boundaryNearPointDistanceM` | 0.45–0.65 |
| 4 | Parcel at the point | no vehicle lot seen, 300–30,000 m² | 0.4 |
| 5 | Synthetic circle of `syntheticBoundaryRadiusM` | always | 0.1 |

**Vehicle lot.** Vehicles within 80 m of the point are clustered by single
linkage with gaps of at most 12 m: a parking row links across an aisle, a lot
across a road does not. A cluster belongs to the site when it has at least
3 vehicles and comes within 25 m of the point or stands on the parcel at the
point. Roofs are masked first when OSM buildings are cached.

**Parcels (stage 1).** Street-like parcels (narrower than 20 m and more than
six times as long as wide) never join, so a site never jumps a road. Growth
stops at `boundaryMaxAreaSqm`.

**Outline (stage 2).** Each vehicle is stamped on a 1 m raster as a 20 m disk
and the mask is shrunk again (a morphological closing). That fills aisles,
empty bays and a showroom between rows, follows an L-shaped lot, and ends
about 10 m beyond the outermost vehicles. The outline is squared up along the
lot's axis. With fewer than 20 vehicles the stock was not seen, and the
outline of a few cars would be far too small, so the stage declines.

**OSM is never waited for.** The analysis uses OSM only when it is already
cached (`OSM_WAIT_MS` 0). The request runs in the background for up to 60 s
(`OSM_EVIDENCE_BUDGET_MS`) and fills the cache for the roof mask, the website
lookup and stage 3 of a later analysis. The roof mask also uses official
ALKIS footprints where a state publishes them (`docs/official-buildings.md`).

**Review.** The confidence values are fixed priors per stage, not calibrated
probabilities. Only stage 1 with good vehicle coverage clears the default
review threshold (`boundaryReviewConfidence` 0.7). A result is also reviewed
when more than five vehicles stand within 15 m outside it
(`vehiclesOutsideNearby`), which usually means a clipped lot.

**Alternatives.** Later stages still run, and every geometry they produce is
kept in `candidates`, so a reviewer can switch with one click. `quality.reasons`
carries one line per consulted stage, for example "parcel at the point + 2
adjacent parcel(s) hold 67 of 69 lot vehicles (97%)".

### Measured

`npm run benchmark:boundary`, 17 public sites, 10 November 2026. Each site ran
like an analysis: context image, detection, boundary; OSM not cached.

| | mean IoU, all | tuning (13) | hold-out (4) | mean area bias |
| --- | --- | --- | --- | --- |
| Cascade v1 (reference hidden, OSM partly reachable) | 0.298 | 0.290 | 0.323 | 0.86 |
| Parcel or circle only (v2 without vehicles) | 0.322 | 0.322 | 0.323 | 0.91 |
| **Cascade v2** | **0.446** | **0.474** | **0.358** | 1.02 |

Winning stage: 11 sites parcels with vehicles, 4 vehicle outlines, 2 circles.
Vehicle parcels lifted the sites where the lot spans several plots the most
(for example 0.19 → 0.78 and 0.27 → 0.85).

**How the limits were set, and what that means for the numbers.** The limits
were compared offline on the stored inputs of these 17 sites
(`BOUNDARY_BENCHMARK_DUMP`). The first version (150 m reach, 3 vehicles per
joined parcel, 4 m outline margin) scored 0.332 with an area bias of 1.6: lots
chained across business parks, and outlines were too tight. The chosen values
are round numbers that removed those two failures. The hold-out sites were
looked at during that comparison, so **0.358 is not an independent hold-out
result**. A fair check needs new sites.

**Limitations.**

- Vehicles under trees or in shadow, and stock in a hall, are not seen. An
  empty lot (a Sunday image, a new site) falls back to the parcel.
- A neighbour's customer car park joins when it shares an edge and holds ten
  or more cars; the 80 m reach limits but does not prevent this in retail
  parks.
- Parcels follow legal lines. Part of a joined parcel can belong to another
  use.
- Without a cadastre the result is an outline of the vehicles, not a surveyed
  boundary; the showroom is only included when it lies between rows.
- The references are OSM dealer areas, a proxy for the operational lot (see
  "What the public set deliberately does not measure").

### Earlier engines (removed)

Version 0.2 ranked candidates from ALKIS, OSM, Nominatim and Overture; 0.2.x
also had a fusion engine (an evidence raster with region growing, about fifteen
hand-set weights, and cadastral snapping). Both are removed from the code. The
legacy results above remain the baseline; earlier sections of this document
describe what they found.

## Cadastre coverage

`alkis.service.ts` queries one open WFS per state. Each was probed with
GetCapabilities and a live GetFeature at a known point before it was added:

| States | Service type | Notes |
| --- | --- | --- |
| Sachsen, Niedersachsen, Schleswig-Holstein, Sachsen-Anhalt, Brandenburg, Hessen, Baden-Württemberg, Hamburg, Mecklenburg-Vorpommern | INSPIRE `cp:CadastralParcel`, EPSG:4258 | Hamburg encodes rings as chains of curve segments; the parser joins them. |
| NRW, Rheinland-Pfalz | AdV `ave:Flurstueck`, EPSG:4326 | |
| Thüringen | AdV `ave:Flurstueck`, EPSG:4326 | Filters only on a UTM 32 box (EPSG:25832); the search box is converted (`toUtm32`). |
| Bremen (city and Bremerhaven) | AdV `adv:AX_Flurstueck` (simple features), EPSG:4258 | Served by LGLN Niedersachsen. |
| Berlin | `alkis_flurstuecke:flurstuecke`, EPSG:4326 | |

Missing, as of November 2026: **Bayern** (the INSPIRE and AdV services
answer 401/403 without a login) and **Saarland** (the registered WFS returns
an empty response).

## Verified negative results

Recorded so they are not rediscovered. Both were probed live on 14 Sep 2026.

**A 16-state ALKIS endpoint table does not work.** A predecessor project
(`JanisKre/DealerShipRiskMapping`) carried direct state ALKIS WFS endpoints for
all 16 states. Probed live, **16 of 16 failed** — mostly HTTP 404, plus 400,
403, a service exception, a dead connection, and one service that answered with
no geometry. The seven INSPIRE endpoints this project uses were re-verified
through the same harness and all returned parcels, so the harness was sound.
Extending coverage to the remaining nine states needs real service discovery
via the GDI-DE / INSPIRE catalogue, not a copied table.

**`CQL_FILTER=INTERSECTS(...)` is silently ignored.** A point in the North Sea
returns the same parcels as an unfiltered request. It answers HTTP 200 with
plausible data, which makes it more dangerous than an outright rejection: any
logic built on "a direct INTERSECTS hit identifies the property" would be
quietly meaningless. BBOX is the only spatial filter these services honour, so
containment is decided client-side and reported as `containsAnchor`.

**Copernicus HRL Imperviousness WCS is not reachable** at
`land.copernicus.eu/wcs` — it returns the marketing site with HTTP 404. The
imperviousness layer remains the single most attractive addition to the
evidence raster (10 m sealed-surface percentage, Europe-wide, directly measures
what the colour heuristic only approximates), but it needs a working endpoint
first.

## Limitations

- The engine produces a **screening estimate**, not a survey. It must not be
  presented as an engineering, legal or underwriting determination of site
  extent.
- Cadastral coverage exists for 14 of 16 German states (see "Cadastre
  coverage"); in Bayern, Saarland and Austria the answer is the outline of
  the detected vehicles, a cached OSM dealer area or the circle.
- Imagery vintage is provider-dependent and often unknown, so a recently
  rebuilt or extended site may be scored against years-old imagery.
- OSM reference polygons are mapper-dependent: an IoU of 1.0 against them
  would indicate a measurement artifact, not perfection.
