# Benchmark data licences

## `boundary-public-fixtures.json`

Reference polygons are derived from **OpenStreetMap**.

- © OpenStreetMap contributors
- Licence: Open Database License (ODbL) v1.0 — <https://opendatacommons.org/licenses/odbl/1-0/>
- Regenerate with `node scripts/build-public-boundary-fixtures.mjs`

Each sample records its `osmType` and `osmId`, so every reference can be traced
back to the object it came from and re-checked against current OSM data.

### What these references are, and are not

They are publicly mapped `shop=car` **areas** — sites where a mapper drew the
dealership lot rather than just placing a point. They are the best openly
redistributable proxy for an operational lot, but they are not a survey:
mappers differ in whether they include the forecourt, staff parking, or the
service yard. Treat a mean IoU of 1.0 against this set as implausible rather
than excellent.

They contain no customer or portfolio data and are safe to commit.

## `boundary-groundtruth-local` (not in this repository)

Ground truth derived from manual boundary corrections is customer-derived and
is **never** committed. It is produced locally by
`scripts/export-boundary-groundtruth.mjs`, which refuses to write anywhere
inside the git working tree, and `*.local.json` is additionally gitignored.

## Dependencies added for cadastral assembly

`@turf/union` and `@turf/intersect` (MIT), used to union the parcels a
dealership occupies. `npm audit` reports 0 vulnerabilities.
