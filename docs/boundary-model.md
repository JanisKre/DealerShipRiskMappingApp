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

## The fusion engine

Enabled per-installation via the `boundaryEngine` setting (`"legacy"` |
`"fused"`). **It defaults to `legacy`**, and stays there until it beats the
candidate chain on the hold-out stratum of the public benchmark. Compare them
with `npm run benchmark:boundary` and `npm run benchmark:boundary:fused`.

### How it works

1. **Collect** (`boundary/evidence-sources.ts`) — OSM vector evidence,
   cadastral parcels and an address-matched polygon, in parallel. A source that
   cannot be reached is recorded as *unavailable*, never as evidence of absence.
2. **Rasterize** (`boundary/fusion.ts` → `boundary/rasterize.ts`) — every source
   is drawn into one 0.5 m metric grid over a 400 m window. Areas add signed
   score; roads, rails and watercourses both subtract and cut; fences and walls
   only cut.
3. **Grow** (`boundary/region-grow.ts`) — a hysteresis flood fill from the
   best-supported cell near the anchor, 4-connected, capped by area and radius.
4. **Clean** — morphological closing bridges shadow lines between parked rows;
   enclosed voids up to 2,500 m² are filled; the outline is extended onto the
   barrier cells that bound it, so it runs *on* the fence.
5. **Vectorize** (`boundary/vectorize.ts`) — contour tracing, Douglas-Peucker,
   then squaring up against the ring's own dominant axis.

### Two rules that keep it honest

**Barriers cut; they do not score.** A fence tells you where an edge is, not
what lies on either side of it. Barriers are rasterized as 4-connected
one-cell chains and growth is 4-connected, so a fence is provably watertight —
with 8-connectivity the region would step diagonally through it and every
barrier in the model would silently stop working. There is a test for that.

**The cadastre reinforces; it never originates.** The anchor parcel is added
only to cells that already carry positive evidence
(`rasterizeReinforcement`). A parcel is a legal unit and is routinely larger
than the lot — a dealership occupying part of a plot — or smaller — a lot
spanning several. Drawn as a plain positive it floods the region out to its own
edges, which is exactly how the baseline over-shot by 90%. The consequence is
deliberate: with *only* a parcel available, fusion returns null and the
candidate chain proposes the parcel honestly, flagged for review, rather than
fusion redrawing it as a confirmed operational lot.

### Area comes from the mask, not the ring

The polygon carries only an outer ring, so a void that stays open — a pond, an
enclosed neighbouring plot — cannot be expressed in it. Site area is therefore
taken from the raster mask, or such a void would be silently counted as lot.

### Failure is always backwards

Fusion returns null on every failure mode: disabled, no reachable evidence,
nothing defensible to grow from, invalid geometry, or an outright error.
Detection then falls back to the candidate chain. Fusion is an improvement on
the ranking, not a replacement for having an answer.

## Current status

Built and tested:

- Evidence collection — combined Overpass query (fences, roads, aisles, rails,
  water, vegetation, address nodes, multipolygon relations), Nominatim
  `polygon_geojson`, all cadastral parcels within 250 m.
- Fusion core — grid, rasterizer, region growing, vectorizer, orchestration,
  confidence.
- The flag, with every fallback path covered.

Not yet built (planned):

- **Cadastral snapping** — replacing fuzzy raster edges with the union of
  parcels the site substantially covers. `cadastreSnapped` is reported as
  `false` throughout until this lands.
- **Imagery layers** — paved-surface, vegetation and texture masks at z18.
- **Vehicle evidence** — the existing YOLO detector run *before* the boundary
  rather than clipped to it, so vehicle clusters can correct a truncated lot.
- **Perimeter support** — the share of outline actually backed by a fence, road
  or parcel edge. Until then `barrierSupport` reports layer diversity in its
  place, which is a weaker but not misleading stand-in.

### Operating against public services

Overpass' public instances rate-limit by IP, and the benchmark makes 17 queries
per run. Two back-to-back runs are enough to earn an HTTP 429 for a while. Two
consequences are built in:

- A 429 stands that mirror down for the period its `Retry-After` asks for
  rather than being retried after 250 ms, which would only burn the remaining
  quota.
- "Could not ask" is never cached. It is distinct from "nothing mapped here",
  which is cached normally.

If a benchmark run reports `sites with a candidate per provider` without an
`osm-*` entry, the run happened during an outage or a rate limit. Wait, then
re-run; do not read it as a regression.

### Re-measuring

The baseline numbers have not moved yet: the engine that produces them is still
`legacy`. A comparison run also needs Overpass to be reachable —
`coverage/boundary-benchmark.json` records which providers produced a candidate
at each site, so a run made during an outage is visible as such rather than
being mistaken for a regression.

## Limitations

- The engine produces a **screening estimate**, not a survey. It must not be
  presented as an engineering, legal or underwriting determination of site
  extent.
- Cadastral coverage exists for 7 of 16 German states; elsewhere the answer
  rests on OSM and imagery only.
- Imagery vintage is provider-dependent and often unknown, so a recently
  rebuilt or extended site may be scored against years-old imagery.
- OSM reference polygons are mapper-dependent: an IoU of 1.0 against them
  would indicate a measurement artifact, not perfection.
