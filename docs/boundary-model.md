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
This section describes version 2; version 3 keeps its structure and changes
the rules listed under "Cascade v3" below. Version 2 (`CASCADE_VERSION` 2) lets the **detected vehicles decide how far the
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

### Fallback circle (stage 5)

When no stage accepts, the boundary is a regular octagon around the point:
eight corners, so at most eight points to drag. Its sides lie at
`radius · cos(22.5°)` from the centre (92 % of the corner radius).

**Target (QA, November 2026).** The octagon should hold the whole lot on at
least 90 % of a sample of dealerships, so a reviewer only has to shrink it.

**Method.** For each of the 17 public fixtures,
`syntheticRadiusToCover` computes the smallest corner radius whose octagon
around the fixture point holds every vertex of the reference polygon. The
default is the smallest 10 m step at which at least 90 % of the sites are
fully held. `synthetic-calibration.test.ts` recomputes this offline on
every test run and pins the default, and checks the formula against the
octagon that is actually drawn.

| Corner radius | Sites fully held |
| --- | --- |
| 100 m (default until November 2026) | 6 of 17 (35 %) |
| 120 m | 10 of 17 (59 %) |
| 150 m | 14 of 17 (82 %) |
| **160 m (default)** | **16 of 17 (94 %)** |
| 240 m | 17 of 17 |

Radius needed per site (m, sorted): 57, 72, 76, 79, 81, 95, 103, 110, 110,
119, 128, 141, 148, 150, 155, 159, 230. The one site above 160 m is a
57,755 m² lot in Dresden.

**Limitations.**

- The fixture point is the centre of the reference polygon. A geocoded
  address usually sits nearer the street or the showroom, so in practice
  the octagon holds the whole lot less often than 94 %. No sample with real
  geocoded points and reviewed lots is in the repository yet; the manual
  corrections export (`scripts/export-boundary-groundtruth.mjs`) can provide
  one.
- 17 sites is a small sample; one site more or less moves the share by six
  points.
- A larger octagon also covers neighbours. A 160 m octagon is about
  72,400 m², between seven and eight times the median fixture lot (9,570 m²), so
  vehicles of neighbouring lots are counted and the area-based capacity is
  far too high until the boundary is corrected. This is why every fallback
  boundary is flagged for review, drawn dashed and listed under the
  "Fallback boundary" filter.
- Sessions that still carry the old default of 100 m move to 160 m when
  loaded; a radius someone set deliberately is kept. Existing boundaries
  change only when a location is analysed again.

## Cascade v3 (November 2026)

`CASCADE_VERSION` 3. A 15-site audit on 13 November 2026 traced the weak
results of v2 to a handful of rules; v3 changes those rules and nothing else.
The stages, their order and their acceptance rules stay as above, except
where listed here.

### What changed and why

| # | Change | Where | Failure it addresses |
| --- | --- | --- | --- |
| P1 | **Complete cadastre.** Parcel queries page with `startIndex` (up to 4 × 250 features). A page that adds nothing new means the service ignores paging (Niedersachsen does); then a second query with 100 m radius is merged in. `completeRadiusM` records how far the answer is complete; a capped answer without the parcel at the point flags `cadastreIncomplete`. | `alkis.service.ts` `fetchParcelRings`, `fetchParcelsNear` | 27 of 57 cached NRW answers were capped at 250 parcels; in 7 the parcel at the point was missing and the cascade fell back to the outline or the circle. |
| P2 | **Street test by length.** A parcel is street-like only when 2·area/perimeter < 20 m *and* its minimum bounding rectangle is longer than 150 m (or 2·area/perimeter < 10 m). | `cascade.ts` `isStreetLike` | The old elongation test rejected L-shaped and deep yards (39 × 97 m with 64 dealer cars). |
| P3 | **Empty-parcel test.** An adjacent parcel joins only with at least 3 (5 above 10,000 m² unbuilt since v4) lot vehicles per 1,000 m² of its *unbuilt* area (parcel minus building footprints, at least 20 % of the parcel). | `vehicleParcelStage`, `unbuiltAreaSqm` | A 12,000 m² meadow joined because ten cars stood at its edge (confidence 0.75). A plain density rule was rejected: it drops showroom parcels, which are mostly roof. |
| P3b | **Small lots.** The join threshold is 10 vehicles or 30 % of the lot, whichever is smaller (at least 3). | `vehicleParcelStage` | A small dealer's yard never holds ten cars; the result was the building parcel alone. |
| P4 | **Named review reasons and calibrated outside rule.** `boundaryReviewReasons` returns why a result needs review (`synthetic`, `lowConfidence`, `pointOutside`, `vehiclesOutside`, `cadastreIncomplete`, `noLotAtPoint`, `winterImagery`, `legacyEngine`); the detail dialog shows them. With a known lot size, vehicles outside count only as ≥ 10 *and* ≥ 15 % of the lot; vehicles on street-like parcels never count. The outline's confidence drops from 0.55 to 0.45. Winter imagery (November–February) sends a result to review. | `shared/boundary-review.ts`, `finalizeCascadeResult`, `analyze.service.ts` | 44 of 61 portfolio results were flagged by the same two signals; the outline scored a mean IoU of 0.23 at confidence 0.55. |
| P5 | **Anchor reach.** A cluster belongs to the lot within 40 m of the point (was 25 m), or within 25 m of the edge of the building the point lies in. Detected vehicles without any lot at the point flag `noLotAtPoint`. | `vehicleLot`, `runCascade` | A point on a 50–80 m showroom roof reached the cars on one side only, or none. |
| P6 | **Parking decks and footprint timing.** A roof with ≥ 15 detections at ≤ 60 m² each is a parking deck and is not masked. The analysis waits up to 5 s for official footprints after detection (`OFFICIAL_BUILDINGS_WAIT_MS`) instead of skipping them when they arrive late. | `roof-mask.ts`, `roof-mask.service.ts`, `analyze.service.ts` | A dealer's rotunda deck (≈ 100 cars) was masked whole; whether footprints were used depended on timing. |
| P7 | **Bounded lot extension.** After the parcel growth, clusters up to 160 m from the point join the lot if they continue it or stand on its parcels, and growth runs once more. The result is taken when it adds at most 25 % area; a larger jump is offered as an alternative. A lot that touches the image edge (≥ 3 vehicles within 15 m of it) triggers one wider capture (190 m instead of 125 m). | `extendLot`, `vehicleParcelStage`, `lotReachesImageEdge` | A 122-car car park 113 m from the point was cut off. An unbounded extension was rejected: it chained into neighbouring businesses (7,070 → 51,678 m²). |
| P8 | **Outline with buildings.** The vehicle outline adds every building of which half the footprint or half the outline lies within 20 m of the lot vehicles, fills holes, removes street-like parcels and drops parts without lot vehicles. | `vehicleHullStage`, `completeOutline` | The outline ringed the showroom without including it (IoU 0.03) and followed kerbside cars into the road. |

### Data sources

Unchanged: ALKIS parcels (14 states, see "Cadastre coverage"), official
ALKIS building footprints where published (`docs/official-buildings.md`),
OSM buildings and dealer areas only when cached, vehicles detected on the
context image (official DOP where available, otherwise Esri).

**Bayern (checked 13 November 2026).** Parcels are not open data: the fee
schedule of the surveying administration charges per parcel and the ALKIS WFS
requires a login. Building outlines (Hausumringe) are open, but only as
shapefile downloads per administrative region; the probed OpenData WFS paths
answer 404. Bayern therefore stays on the vehicle outline. Since v4 its
building footprints come from the open LoD2 model, read by 2 km tile
(`bavaria-lod2.service.ts`, docs/official-buildings.md), so the outline can
include the showroom and the roof mask works there too.

### Measured

Replay of the frozen inputs of the audit's 15 sites
(`npm run benchmark:boundary:replay`, inputs local and outside the repository
because eight sites come from a customer portfolio). The seven public
fixtures have a reference; imagery as in the app (`auto`).

| | v2 | v3 |
| --- | --- | --- |
| mean IoU, 7 fixtures | 0.367 | **0.539** |
| Kassel / Hannover / Dortmund / Dresden | 0.59 / 0.47 / 0.03 / 0.81 | 0.76 / 0.90 / 0.52 / 0.94 |
| München / Nürnberg (no cadastre, no footprints) | 0.11 / 0.09 | unchanged |
| portfolio results that changed visibly | — | 6 of 8 (Bergisch Gladbach, Hennef, Troisdorf, Rheine improved; Düsseldorf and Hamburg unchanged, extension offered as an alternative) |

Public benchmark, all 17 fixtures, 13 November 2026, imagery `auto`, roof
mask on (`npm run benchmark:boundary`): v3 scores **0.451** mean IoU
(tuning 0.487, hold-out 0.333; area bias +1.03, calibration MAE 0.29). The
same frozen inputs replayed through v2 score 0.407 — with the complete
cadastre already given to v2, so the P1 gain (Hannover 0.47 → 0.90) is not
in that difference. Per site: four improve by more than 0.03 (Kassel,
Dortmund, Dresden, Berlin-West), one gets worse (Linz, Austria, 0.62 → 0.54,
outline only), the rest are unchanged. The 10 November figure for v2 (0.446)
was measured with Esri imagery and is not comparable.

Still weak: both Bayern sites (≈ 0.1, no cadastre or footprints), the two
Sachsen-Anhalt hold-out sites (≈ 0.15–0.20: one large parcel holds the lot,
the reference is a part of it) and Leipzig / Dortmund-Nord (≈ 0.27, parcel
far larger than the OSM dealer area).

**These rules were designed on these same 15 sites.** The numbers show the
rules do what they were written for and break none of the 15; they are not
an independent result. The public benchmark (`npm run benchmark:boundary`,
now with `auto` imagery, roof mask and v3) and new sites decide whether v3
generalises. The thresholds (40 m, 3 per 1,000 m², 30 %, 160 m, 25 %,
15 detections / 60 m²) are round values chosen to separate the audited
failures, not fitted.

**Limitations of v3.**

- A dense car park on a solar roof could be read as a deck and kept.
- The extension's 25 % limit is a heuristic: a genuinely larger site is
  offered as an alternative and needs one click in review.
- The empty-parcel test needs building footprints; without them (Bayern,
  missing ALKIS buildings) the unbuilt area is the whole parcel and showroom
  parcels with few cars outside may not join.
- A geocoded point inside a block of street-parked cars can still form a
  lot; `noLotAtPoint` only catches points where no lot forms at all.

## Cascade v4 (November 2026, second check)

`CASCADE_VERSION` 4, 5 for the building at the point and the Bayern
footprints, and 6 for the Bayern traffic areas (rows marked in the table). A second check on 25 further portfolio sites from 13
states (13 November 2026, imagery `auto`) judged 16 boundaries plausible,
4 partial, 4 wrong and 1 unclear; all 8 flawed ones were flagged for review,
as were 9 of the 16 plausible ones. It found patterns the first audit had
not shown; v4 addresses three of them.

| Change | Where | Failure it addresses |
| --- | --- | --- |
| **Field strips.** A street-like parcel with at least two parallel (≤ 15°) street-like neighbours is a field strip, not a street. A point on a field strip declines stage 1, so the vehicle outline (with buildings) is used. Field strips are not removed from outlines; they still never join a parcel union, and their vehicles, like kerbside ones, do not count as outside vehicles. | `isFieldStrip`, `streetParcels`, `vehicleParcelStage`, `completeOutline` | A dealership across five 10–15 m strips (Sachsen-Anhalt) became one strip running 150 m into the field; the neighbouring strips with 21 cars counted as streets. |
| **Point off the lot.** When the parcel at the point holds under 25 % and the result under 50 % of the lot vehicles that are not on a street, the result is kept but flagged `anchorOffLot`, and the parcels grown from the parcel holding most of the lot are offered as an alternative. | `anchorOffLot` in `cascade.ts` | The point lay on a warehouse holding 3 of 18 lot vehicles, or in a row of houses on a main road; the only review reason was "low confidence". |
| **Stale imagery.** Imagery four or more years old sends the result to review (`staleImagery`, `STALE_IMAGERY_REVIEW_YEARS`). | `analyze.service.ts` | Sachsen-Anhalt fell back to 2020 Esri imagery showing a construction site. |
| **Empty-parcel test for large areas:** 5 instead of 3 lot vehicles per 1,000 m² when a parcel's unbuilt area exceeds 10,000 m². | `CASCADE_LIMITS.parcelMinVehiclesPer1000SqmLarge`, `largeUnbuiltSqm` | In the 50-site run a 13,900 m² sand lot with 49 scattered detections (3.5 per 1,000 m²) joined a Berlin dealership at confidence 0.75; real yards stand at 20–70. Rejected alternatives: a global 5 cut a dealer's own yard where the lot reached only part of its rows; counting every vehicle on the parcel let dense inner-city street parking join (Hannover 0.90 → 0.34). |
| **Building at the point in the outline:** the building the point lies in, with the buildings attached to it (≤ 1 m), joins the vehicle outline (up to 30,000 m²). | `completeOutline`, `buildingComplex` | The point is the dealership's address or POI; its building is the showroom. Bayern fixtures: Munich 0.13 → 0.53, Nuremberg 0.06 → 0.61 IoU (with LoD2 footprints); no other fixture changes. |
| **Building footprints for Bayern** from the open LoD2 model, read by 2 km tile. | `bavaria-lod2.service.ts` | Bayern had no footprints, so outlines left showrooms out (C-shapes, split parts). Now all 14 audited Bayern sites get 45–409 footprints. |
| **Traffic areas for Bayern** from the free ALKIS land-use map (WMS `geoservices.bayern.de/od/wms/alkis/v1/tn`, layer `by_alkis_tn_verkehr`, CC BY 4.0), rendered at 1 m per pixel where no parcels exist; the outline is cut back there and kerbside cars on it do not count as outside vehicles. | `bavaria-landuse.service.ts`, `CascadeInput.isStreetAt` | Without parcels the outline ran across roads (Bayern). The layer also contains public squares and rail, which are not dealership land either. |
| **Minimum area in stage 1:** a parcel at the point under 300 m² with nothing joined declines stage 1. | `vehicleParcelStage` | A 128 m² town-centre plot was returned as the lot. |
| Bounding-box pre-check for parcel adjacency. | `isAdjacent` | Field-strip detection compares parcels pairwise; with the pre-check the cascade is faster than v3 on the replayed sites. |

Replayed on the frozen inputs of all 107 sites so far (15 + 25 + 50 audit
sites, 17 public fixtures), v4 against v3: the German fixtures move from
0.475 to 0.476 mean IoU; the field-strip site becomes an outline of showroom
and car park (1,627 → 4,258 m²), the 128 m² plot an outline (3,817 m²), the
Berlin sand lot leaves (37,978 → 24,137 m²), an oversized Sachsen-Anhalt
fixture halves (46,819 → 22,364 m²), three outlines change slightly because
field strips are no longer cut out, and 14 sites gain `anchorOffLot`.
Review flags: 77 of 107 (v3: 75).

The 50-site run itself (13 November 2026, emphasis on the eastern states and
Bayern) found no failure mode beyond those above; the recurring weakness is
Bayern, where without parcels or building footprints the vehicle outline
leaves the showroom out or runs across a road (of 10 Bayern sites: 2 plausible, 6 partial, 1 wrong, 1 unclear).
With LoD2 footprints and the building at the point, outlines there include
the showroom (for example 8,899 → 15,228 m² and 3,561 → 6,695 m² on two
sites that had been split around it); since v6 the land-use map's traffic areas
cut outlines back at roads in Bayern.

**Simulated and rejected** in the same check: removing kerbside cars from the
lot changed no geometry but raised confidence to 0.75 on boundaries known to
be wrong; clipping oversized parcel unions to the vehicle outline lowered
the German fixtures from 0.444 to 0.406 (Dresden 0.94 → 0.36, because the
outline only knows vehicles within 80 m). Oversized unions (Leipzig,
Dortmund-Nord, Berlin-West, Sachsen-Anhalt) stay open.

**Limitations.** The field-strip test needs at least two parallel
neighbours in the cadastre answer; a strip at the edge of the search box may
be missed. `anchorOffLot` cannot catch a wrong point inside a block of
street-parked cars that forms a lot of its own.

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
answer 401/403 without a login; parcels are charged per parcel, see
"Cascade v3 → Data sources") and **Saarland** (the registered WFS returns
an empty response).

Paging: NRW honours `startIndex`; Niedersachsen answers every page with the
first (probed 13 November 2026), so capped answers there are completed with
the smaller fallback query.

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
