# Boundary benchmark

Run it from `desktop-app/`:

```bash
npm run benchmark:boundary                      # source cascade, about 35 min
BOUNDARY_BENCHMARK_LIMIT=3 npm run benchmark:boundary   # quick smoke run
BOUNDARY_BENCHMARK_TIMEOUT_MIN=180 npm run benchmark:boundary   # default 120
BOUNDARY_BENCHMARK_DUMP=/tmp/inputs.json npm run benchmark:boundary
```

Each site runs like an analysis in the app: context image, vehicle
detection, then the boundary. The vehicle model is loaded from the app's data
directory (`~/Library/Application Support/Dealership Risk Mapping/models`;
`BOUNDARY_BENCHMARK_USERDATA` points elsewhere) and runs in-process. Without a
model the run fails, because every site would fall back to the parcel or the
circle.

OSM is treated as not cached, which is what the app sees while the public
Overpass servers are at capacity. The references are OSM dealer areas, so
using OSM would also grade OSM against itself.

`BOUNDARY_BENCHMARK_DUMP` writes each site's inputs to a file as the analysis
sees them — vehicles, parcels (in Bayern from the parcel map), building
footprints and the vegetation raster — after every site, so cascade rules can
be compared offline (`npm run benchmark:boundary:replay`) without fetching
imagery again, and a failing service late in the run does not lose them.

It is opt-in (gated on `BOUNDARY_BENCHMARK`) because it queries the state
cadastre services and the imagery provider. It must never gate CI.

## Files here

| File | What it is |
| --- | --- |
| `boundary-public-fixtures.json` | Version 2: 76 real OSM dealership lots, all 16 German states and 2 sites in Austria; no way tagged as a building, at most 60 % of each outline under mapped buildings (`roofShare`). Committed. Regenerate with `node scripts/build-public-boundary-fixtures.mjs`. |
| `boundary-baseline.json` | Scores of the engine as it shipped in v0.2.1, on version 1 of the set (17 references, 8 of them showroom roofs). Kept as a record; not comparable with runs on version 2. |
| `LICENSES.md` | ODbL attribution, and what the references are and are not. |

Output goes to `coverage/boundary-benchmark.json`, including which providers
produced a candidate at each site — so a run where Overpass was unreachable is
distinguishable from one where OSM was consulted and lost.

## Reading the results

Metrics and their interpretation are documented in
[`docs/boundary-model.md`](../../../docs/boundary-model.md), together with the
measured baseline.

Results are reported for **all**, **tuning** and **hold-out** strata. The
hold-out stratum decides whether a change is an improvement. Splitting is
**geographic**, by region, never random: two dealerships a few hundred metres
apart share imagery, cadastre service and mapping conventions, so a random
split leaks between train and test.

Recommended stratification when extending the set: federal state, urban/rural
context, lot area, imagery vintage, and whether a cadastre service exists.

## Ground truth from manual corrections

`node scripts/export-boundary-groundtruth.mjs --db <path/to/dealership-risk.db>`
exports saved manual boundary edits as a second evaluation set, then:

```bash
BOUNDARY_GROUNDTRUTH=~/.dealership-risk/benchmarks/boundary-groundtruth.local.json \
  npm run benchmark:boundary
```

Report it **separately**: users only correct boundaries they noticed were
wrong, so it over-represents visible failures. It is customer-derived and is
never committed — the exporter refuses paths inside the working tree.
