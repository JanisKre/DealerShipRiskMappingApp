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

## Review calibration (November 2026)

Review flags were checked against 76 sites judged by eye on the aerial
image (49 correct, 27 partial, wrong or unclear; Bayern left out, where
the vehicle outline is always flagged) and the 17 public fixtures (IoU
≥ 0.5 counted as correct). With `CASCADE_VERSION` 6, 25 of the 49 correct
results were flagged, mostly for "low confidence" (stage 1 covering 70–78 %
of the lot) and "vehicles outside" (a neighbouring forecourt, 15–24 % of the
lot); 24 of 27 flawed results were flagged.

Two thresholds changed (`CASCADE_VERSION` 7): full stage-1 confidence from
70 % lot coverage (`goodCoverage`, was 80 %), and "vehicles outside" only at
25 % of the lot (`MAX_OUTSIDE_SHARE`, was 15 %). Correct results flagged:
25 → 13 of 49. Flawed results flagged: 24 → 23 of 27; the one no longer
flagged is a site whose rear yard may or may not belong to the dealer. The
three unflagged flawed results are two fixtures with oversized parcels and a
site on six-year-old imagery, which the analysis flags as `staleImagery`.

Rejected: counting coverage only on vehicles off the street (correct flags
10 of 49) also cleared a fixture with IoU 0.14.

These thresholds were set on the sites they were measured on; they are a
calibration of a screening flag, not a validated classifier.

## Cascade v8 (November 2026, parcel check)

`CASCADE_VERSION` 8. Since v3 the result follows the cadastre closely,
and a reviewer saw the price of that: parts of the car park missing, and
pieces cut out of the middle of a lot where the cadastre has a plot of its
own. A check on 88 sites (the 5 locations of the user's own portfolio and
83 dealers of the public 100-dealer sample outside Bayern and Saarland,
captured live on 13 November 2026, imagery `auto`) traced this to three
stage-1 rules, each of which v8 relaxes. The stage order and acceptance
rules are unchanged.

| Change | Where | Failure it addresses |
| --- | --- | --- |
| **Small dense parcels.** An adjacent parcel also joins with fewer than 10 lot vehicles when it holds at least 5 and at least 8 per 1,000 m² of its unbuilt area. | `parcelDenseMinVehicles`, `parcelDenseVehiclesPer1000Sqm` | A 970 m² corner of a yard with five cars was cut out as a notch; the user's manual correction of that site included it. Half a forecourt (26 and 5 cars on two plots) was missing at another site. With 3 vehicles, an apartment block whose courtyard held three cars joined; 5 keeps it out. |
| **Parking strips.** A parcel that is street-like only because it is narrow (bounding length ≤ 150 m) joins when at least 15 lot vehicles stand per 1,000 m² of it. It is a leaf: nothing grows on from it, so a strip cannot lead the lot along a road. Field strips qualify too. The minimum area of stage 1 counts only the parcel at the point and parcels joined by their vehicles. | `isShortStrip`, `stripMinVehiclesPer1000Sqm` | A 607 m² L-shaped corner with 26 cars counted as a street, so the result was the 538 m² building plot (Dresden). Display rows along a ramp or a highway sat on strips of their own. Measured on the whole strip, not its unbuilt area: a driveway with a building and six cars at its edge otherwise reached the threshold. |
| **Enclosed parcels.** A parcel of which at least 75 % of the outline borders the parcels already chosen joins whatever stands on it, up to half the lot's area. Long streets never join. | `enclosedMinShare`, `enclosedMaxShareOfLot`, `borderShare` | Workshop buildings and narrow plots inside a dealer block were left out as holes or slots. 50 % was tried and rejected: it took in a residential house, a meadow and a belt of trees beside three lots. |
| **No holes.** Interior rings of the parcel union are dropped. | `withoutHoles` | Slivers and plots left out for their size between the chosen parcels. |

The trace names what joined, for example "parcel at the point + 4 adjacent
parcel(s) (1 parking strip(s), 2 enclosed)".

### Measured

All on frozen inputs, v7 against v8, so the difference is the rules alone.

| | v7 | v8 |
| --- | --- | --- |
| 88-site check: results that change | — | 24 (all stage 1, all larger: +1 % to +128 %) |
| Manually corrected site (IoU against the correction) | 0.72 | **0.86** |
| 17 public fixtures, mean IoU | 0.509 | 0.512 |
| Results flagged for review, 88 sites | 38 | 35 |

Judged by eye on the aerial image, the larger changes are improvements:
the whole forecourt instead of half of it (2,185 → 4,980 m²), the corner
car park in Dresden (538 → 1,143 m²), two slots inside a dealer block
filled (4,664 → 5,997 m²), holes of two workshop buildings closed, display
rows on separate strips included. Changes of 1–5 % fill slivers. One
change is doubtful: a row of parking bays along a public street joined a
town-centre lot that was already flagged for review.

On the public fixtures two sites improve (Niedersachsen 0.79 → 0.87,
Brandenburg 0.63 → 0.66) and two get slightly worse (Hessen 0.76 → 0.72:
a row of houses enclosed by the dealer block joins; NRW 0.28 → 0.26: rows
of parked cars beside the yard that the OSM reference leaves out). The
references are OSM dealer areas, a proxy for the lot.

**These thresholds were chosen on the sites they were measured on**, as in
v3 and v4. The 83 public sites have no reference outline, so their
judgement is by eye; only one site carries a manual correction. The
cascade takes about 5 % longer on the 88 sites (0.19 s per site) and 50 %
longer on the larger public fixtures (0.6 s per site), mostly for the
enclosure test.

**Limitations.** A plot the dealer encloses but does not use (a
neighbour's house in the middle of the block) now joins. A row of public
parking bays registered as its own narrow parcel joins when it is full.
Customer parking with only a few cars on a parcel of its own still stays
out: the cascade cannot tell a sparsely used car park from a meadow
without a surface classification.

## Cascade v9 (November 2026, new sources)

`CASCADE_VERSION` 9. Up to v8 the cascade knew two things about a parcel:
its outline and the vehicles on it. Which plots belong to the dealership,
what a plot is used for and what stands on it besides cars had to be
guessed from shape and counts. v9 adds three sources that say so, and one
that gives Bayern parcels at all. The stage order and acceptance rules are
unchanged.

### New sources

| Source | What it adds | Where | Coverage |
| --- | --- | --- | --- |
| **Parcel address** (`lagebeztxt` of the simplified ALKIS product `ave:Flurstueck`) | Street and house number of each parcel. Parcels with the same address are one property. | `alkis.service.ts` `parseParcelFeatures`, `boundary/parcel-address.ts` | NRW, Rheinland-Pfalz, Thüringen, Sachsen, Niedersachsen, Sachsen-Anhalt, Hamburg, Hessen, Brandenburg |
| **Actual land use** (`tntxt` of the same product) | Share of each parcel that is traffic area, industry and trade, mixed use, housing or open land. | `alkis.service.ts` `parseLandUse`, `classifyLandUse` | as above, without Hessen and Brandenburg |
| **Vegetation on the aerial image** | Grass and trees on the image the vehicles are detected on, as a 1 m raster. Costs no request. | `boundary/vegetation.ts`, `analyze.service.ts` | everywhere, in the growing season |
| **Bayern parcel map** (WMS `geoservices.bayern.de/od/wms/alkis/v1/parzellarkarte`, layer `by_alkis_parzellarkarte_farbe`, CC BY 4.0) | Parcels for Bayern, read back from the rendered map at 0.25 m per pixel, with land use from the fill colour. | `bavaria-parcels.service.ts` | Bayern |

The first two come with the parcels the app already requested: the three
states on `ave:Flurstueck` returned them all along and the parser dropped
them. Six more states moved from the INSPIRE parcel service to their
`ave:Flurstueck` service (probed live on 13 November 2026); the INSPIRE
service stays as the fallback when the new one fails. Schleswig-Holstein
and Mecklenburg-Vorpommern serve the product in projected coordinates only
and stay on INSPIRE; Baden-Württemberg, Berlin and Bremen publish neither
field with the parcel.

### What changed and why

| Change | Where | Failure it addresses |
| --- | --- | --- |
| **Streets by land use.** Where land use is published, a parcel is a street when at least half of it is traffic area and it has no house number; the shape test only applies where land use is unknown. Field strips need no special case there. | `streetByUse`, `isStreetParcel` | The shape test calls every plot under about 20 × 20 m street-like: on the 58 replayed sites with land use, 3,090 parcels were street-like by shape but not traffic area, and 214 traffic parcels were not street-like. Small yard plots joined only as full "parking strips"; wide road, rail and verge parcels joined as lot (9,102 → 3,463 m² at one site, where a 5,651 m² road parcel with 19 parked cars had joined). One dealer's yard is registered as "Weg" under its own house number, hence the house-number exception. |
| **Same address.** A neighbouring parcel that shares a street and house number with the parcel at the point, or with the dealership's address, joins without cars on it: up to 5,000 m², beyond that only while it is no larger than the parcels chosen so far, and not when it is housing, open land or mostly vegetation. | `vehicleParcelStage`, `sharesAddress` | 17 of 74 replayed sites with addresses had parcels of the dealer's own address left out: rear yards, the second half of a forecourt, workshop plots with few cars outside. |
| **Point moved to the address.** When the point lies on no parcel, on a street, or on a parcel with another house number and fewer than three vehicles, and a parcel within 150 m carries the dealership's address, the stages start from that parcel. A point on a parcel without a house number, or with vehicles on it, stays. | `addressAnchor`, `runCascade` | A geocoded point on the road or on the neighbour's plot gave the circle or the neighbour's parcel. |
| **Housing and open land.** A parcel that is mostly housing or open land by the cadastre, or mostly vegetation on the image, joins only by the dense rule (5 cars and 8 per 1,000 m²), and as an enclosed plot only up to 200 m². A parcel that is mostly vegetation does not join by its address either. | `isForeignUse`, `greenShare` | v8 took in a neighbour's house or a meadow the lot enclosed, and a meadow with a row of cars at its edge joined when it held ten of them. |
| **Vegetation trimmed.** Vegetation of at least 600 m² at the edge of the parcel union, more than 10 m wide and with no detected vehicle within 8 m, is cut off. Islands inside the lot, rows of trees, the lawn along a forecourt and building footprints stay. | `trimVegetation` | The parcel at the point is often larger than the lot: a wood, a meadow or an embankment on the same plot. |
| **Parcels in Bayern.** Stage 1 runs on the parcels read from the parcel map; their traffic areas are streets. The land-use raster of v6 is only used when the map fails. | `bavariaParcelsNear`, `boundary.service.ts` | Bayern had only the vehicle outline (stage 2). |

The trace names what joined and what was removed, for example "parcel at
the point + 4 adjacent parcel(s) (2 by address, 1 enclosed) hold 61 of 64
lot vehicles (95%); 1,250 m² of vegetation without vehicles trimmed off".

### Measured

All on frozen inputs, v8 against v9, so the difference is the rules and the
new sources. Imagery `auto`, 13 November 2026.

**Replay set (105 sites):** the 88 sites of the v8 check and the 17 public
fixtures, with their parcels requested again (74 sites now carry addresses,
58 of them land use) and a vegetation raster read from the context image.

| | v8 | v9 |
| --- | --- | --- |
| Results that change | — | 34 (13 larger by more than 5 %, 7 smaller, 14 within 5 %) |
| Sites where a parcel joins by its address | — | 16 |
| Circle replaced by parcels | — | 2 |
| Vehicle outline replaced by parcels | — | 2 |
| Point moved to the dealership's address | — | 2 |
| Vegetation trimmed | — | 3 |
| Results flagged for review | 41 | 40 |
| Mean IoU, 17 public fixtures and 1 manual correction | 0.531 | 0.529 |

**Fresh set (73 sites):** dealers of the public 500-dealer sample that no
earlier version was tuned or checked on, 26 of them in Bayern, captured
live with name and address as the app does.

| | v8 | v9 |
| --- | --- | --- |
| Results that change | — | 44 |
| Bayern: parcel-based result (stage 1 or 4) | 0 of 26 | 26 of 26 (v8: 21 outlines, 5 circles) |
| Sites where a parcel joins by its address | — | 10 |
| Vegetation trimmed | — | 5 |
| Results flagged for review | 48 | 34 |

Judged by eye on the aerial image (about 45 of the changed sites):

- Address joins complete the lot where v8 stopped at a parcel line: the
  whole street front instead of the showroom plot (3,332 → 6,058 m²), a
  paved rear yard (4,472 → 7,973 m²), a workshop wing (7,077 → 8,741 m²).
  In Hessen, which publishes addresses but no land use, a town-centre lot
  went from an outline across three streets to its own three parcels.
- Streets by land use remove road and rail parcels that had joined (9,102
  → 3,463 m², 2,763 → 860 m²); both results are flagged, because cars
  parked on the road parcel now count as outside.
- In Bayern 12 of 20 viewed results are clearly better than the outline
  (the lot's own parcel with the showroom, no spill across the road, two
  circles replaced by the dealer's plot). Seven are tighter than the
  outline and miss a second lot across a road or on a neighbouring parcel;
  all seven are flagged. One is larger (17,794 → 32,238 m², a storage yard
  on the same parcel).
- Trimming removed a meadow, a garden and a house plot from the parcel at
  the point (20,692 → 16,511 m², 5,396 → 4,243 m²).

The mean IoU on the public fixtures does not move. One fixture gets worse
(Brandenburg 0.66 → 0.57: a 2,815 m² parcel with the dealer's address and
24 cars joins, and the OSM dealer area leaves it out), four improve by
0.01–0.02. The oversized fixtures (Sachsen-Anhalt, Leipzig, Dortmund) stay
as they were: their imagery shows no vegetation to trim (Esri 2020, bare
ground), or the reference is the building alone.

**Tried and changed during the check.**

- Moving the point whenever another parcel carried the address was wrong
  twice: a showroom on a parcel without a house number (the numbered plot
  was the house behind it), and a yard registered under the neighbour's
  number. The point now stays on a parcel without a number or with
  vehicles on it.
- Joining every parcel of the same address doubled two Sachsen-Anhalt
  fixtures (19,400 → 44,050 m²: woodland under the dealer's address). An
  address join is now limited to 5,000 m² or the size of the lot so far,
  and excludes housing, open land and parcels that are mostly vegetation.
- Trimming at 400 m² and 4 m cut the lawn in front of the display rows,
  so the outline followed the cars; 600 m² and 5 m leave it.
- A dark roof passed the colour test and was cut out of a lot; building
  footprints are now excluded from the vegetation test.

**These rules were designed on the replay set**, as in v3–v8; its numbers
show what the rules do, not how well they generalise. The fresh set was
captured after the rules were written, but three thresholds (the point
rule, the trimming width, the roof exclusion) were corrected after looking
at it, so it is not an untouched hold-out either. Neither set has
reference outlines beyond the 17 OSM fixtures; the judgement is by eye.

**Limitations of v9.**

- Address and land use are what the cadastre registers. A dealer's yard was
  found registered as a path, a meadow as trade land; the house-number
  exception and the vegetation test cover these two cases, not every one.
- The vegetation test is a colour rule. It needs imagery from the growing
  season, misses vegetation in deep shade, and can take a green surface
  (artificial turf, a painted yard) for vegetation. Where the image shows
  none, nothing is trimmed.
- A trimmed outline follows the vegetation on a 1 m raster, not a legal
  line, and has more corners than a parcel.
- Bayern parcels are read from a rendered map: good to about half a metre,
  without numbers or addresses. A building that spans its parcel splits
  it; a building on the parcel line may go to the neighbour; parcels at
  the edge of the 400 m map are cut off. The service draws the map only
  up to 1:5,000.
- With parcels, a Bayern result no longer reaches across a road. A dealer
  with a second lot opposite gets the lot at the point and a review flag;
  the vehicle outline remains an alternative.
- Schleswig-Holstein, Mecklenburg-Vorpommern, Baden-Württemberg, Berlin
  and Bremen publish neither address nor land use with the parcel; there
  only the vegetation rules are new. Saarland still has no parcels.
- The dealership's address is compared by street and house number only.
  A wrong or missing house number in the portfolio simply switches the
  address rules off for that site.

## Earlier engines (removed)

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
| NRW, Rheinland-Pfalz | AdV simplified `ave:Flurstueck`, EPSG:4326 | Address and land use per parcel. |
| Thüringen | AdV simplified `ave:Flurstueck`, EPSG:4326 | Filters only on a UTM 32 box (EPSG:25832); the search box is converted (`toUtm32`). Address and land use. |
| Sachsen, Niedersachsen, Sachsen-Anhalt, Hamburg | AdV simplified `ave:Flurstueck`, EPSG:4258; INSPIRE `cp:CadastralParcel` as fallback | Address and land use. Sachsen answers EPSG:4326 with an HTML page. Hamburg always reports `numberReturned="0"`; a full page counts as capped. |
| Hessen, Brandenburg | AdV simplified `ave:Flurstueck`, EPSG:4258; INSPIRE as fallback | Address only (no `tntxt`). |
| Schleswig-Holstein, Baden-Württemberg, Mecklenburg-Vorpommern | INSPIRE `cp:CadastralParcel`, EPSG:4258 | Geometry only. The simplified services of SH and MV answer in projected coordinates only; BW's `nora:v_al_flurstueck` keeps addresses in separate tables. |
| Bremen (city and Bremerhaven) | AdV `adv:AX_Flurstueck` (simple features), EPSG:4258 | Served by LGLN Niedersachsen. Geometry only. |
| Berlin | `alkis_flurstuecke:flurstuecke`, EPSG:4326 | Geometry only. |
| Bayern | Parcel map (WMS, raster), read back into polygons | No vector parcels are open. Land use from the fill colour; no addresses. See "Cascade v9". |

Missing, as of November 2026: **Saarland** (the registered WFS returns an
empty response, and no open parcel map was found). In **Bayern** the
INSPIRE and AdV vector services answer 401/403 without a login and parcels
are charged per parcel (see "Cascade v3 → Data sources"); since v9 the
open parcel map stands in for them.

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
- Cadastral parcels exist for 15 of 16 German states (see "Cadastre
  coverage"; in Bayern read from a rendered map); in Saarland and Austria
  the answer is the outline of the detected vehicles, a cached OSM dealer
  area or the circle.
- Parcel addresses are published in nine states and land use in seven; in
  the others the v8 rules apply unchanged, plus the vegetation test.
- Imagery vintage is provider-dependent and often unknown, so a recently
  rebuilt or extended site may be scored against years-old imagery.
- OSM reference polygons are mapper-dependent: an IoU of 1.0 against them
  would indicate a measurement artifact, not perfection.
