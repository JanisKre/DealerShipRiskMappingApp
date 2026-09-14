# Boundary benchmark

Run it from `desktop-app/`:

```bash
npm run benchmark:boundary                      # full public fixture set
BOUNDARY_BENCHMARK_LIMIT=3 npm run benchmark:boundary   # quick smoke run
```

It is opt-in (gated on `BOUNDARY_BENCHMARK`) because it queries Overpass, the
state cadastre services and the imagery provider. It must never gate CI.

## Files here

| File | What it is |
| --- | --- |
| `boundary-public-fixtures.json` | 17 real OSM dealership areas, 9 states. Committed. Regenerate with `node scripts/build-public-boundary-fixtures.mjs`. |
| `boundary-baseline.json` | Scores of the engine as it shipped in v0.2.1, for measuring change against. |
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
