# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Dealer directory from Overture Maps (Settings → "Dealer directory"): a
  one-time download (about 500 MB, a few minutes, in a background worker)
  stores about 45,000 car, used-car, motorcycle, truck and RV dealers in
  Germany locally (about 12 MB, SQLite FTS5). Location search merges them with
  the live OSM results; a dealer both sources know is listed once, and each
  suggestion shows its source. Filters: Overture `basic_category`
  `auto_dealer`/`vehicle_dealer` (road vehicles only), confidence ≥ 0.5, not
  closed, country DE. Data: Overture Maps Foundation, CDLA Permissive 2.0;
  contains Foursquare data (Apache 2.0). Methodology: `docs/dealer-directory.md`.
- Map pin hover now shows the hail risk (spelled out, with level) and the
  vehicle count; the popup no longer lists a second "top peril" score.
- Boundary review banner explains how to resolve it and opens boundary
  editing directly. A flagged boundary can be confirmed from the pin popup
  ("Confirm boundary"); the confirmation timestamp is stored on the boundary
  and recorded as a limitation ("confirmed by visual review, not a cadastral
  survey").
- Automatic aerial imagery per location: the newest of Esri World Imagery and
  the official state orthophoto (14 German states, open services) is used for
  both the map and vehicle detection. A sharper source may be up to 6 months
  older. The choice, capture date and alternatives are stored with every
  detection and shown in the detail dialog. Methodology:
  `docs/imagery-sources.md`.
- Map legend (expanded) shows the satellite image's metadata at the map
  centre: capture date (flagged from 2 years), source, sensor, resolution,
  positional accuracy, zoom range, Esri release, attribution and the
  selection reason.
- Natural hazard data sources per peril: a primary source for all perils plus
  per-peril choices (e.g. flood from a flood specialist), with fallback along
  chosen source → imported ZÜRS data → primary source → screening, recorded
  in the evidence. "Reset to default" returns every peril to the Open-Meteo
  screening. Methodology and deterministic fixtures:
  `docs/risk-model.md` ("Source routing per peril"), `natcat-routing.test.ts`.
- Provider catalog in the settings (Swiss Re CatNet, Munich Re, Moody's RMS,
  Verisk, JBA, Fathom, custom API; ZÜRS Geo import; JRC flood maps planned)
  with coverage, license and connection status, plus per-provider connectors
  (HTTPS endpoint, keychain-stored key, connection test).
- AI setup flow: chat, dashboard assistant, executive summary and underwriting
  memo show a "Set up AI" prompt that links to the AI settings instead of
  failing with `LLM 401`. The main process refuses requests before any network
  call when no model or key is configured (`LLM_NOT_CONFIGURED`).
- AI settings: "Test connection" (one minimal request over the chat's streaming
  path, with a specific hint for rejected keys, unknown models and unreachable
  servers) and "Load models", which reads the model list live from the
  provider (OpenAI, Anthropic, local runtime), so new models need no app
  update.
- Local model provider with Ollama, LM Studio and llama.cpp presets. Restricted
  to loopback URLs, never sends an API key, and uses a longer timeout for the
  first request that loads the model.
- Hugging Face model browser for local models: live search of GGUF
  text-generation repositories (trending, downloads, likes) and one-click
  install of a quantization into Ollama (`ollama pull hf.co/<repo>:<quant>`)
  with progress and cancel.

- Boundary benchmark: `npm run benchmark:boundary` scores lot detection against
  a committed set of 17 real OpenStreetMap dealership areas across nine states
  (`resources/benchmarks/boundary-public-fixtures.json`, ODbL). Results are
  reported for tuning and geographic hold-out strata separately, and the
  pre-rewrite baseline is recorded in `boundary-baseline.json`.
- `scripts/export-boundary-groundtruth.mjs` turns saved manual boundary
  corrections into a second, local-only evaluation set. It refuses to write
  anywhere inside the git working tree, and `*.local.json` is gitignored,
  because that data is customer-derived.
- Metric evidence raster for the boundary fusion engine
  (`src/main/services/boundary/{grid,rasterize,region-grow}.ts`): polygon,
  polyline, disk and watertight barrier rasterization with morphology, a 0.5 m
  raster IoU, and hysteresis seeded region growing with area and radius caps.
  Barriers are rasterized as 4-connected chains and growth is 4-connected, so a
  one-cell fence is provably watertight.
- Address-matched lot geometry from Nominatim (`polygon_geojson=1`), gated on
  proximity to the geocoded point so a same-named branch in another city cannot
  be matched.
- Evidence-fusion boundary engine, behind the new `boundaryEngine` setting and
  **off by default**. Instead of ranking candidate polygons and keeping one, it
  rasterizes every source into one 0.5 m metric grid, grows the site out of the
  combined evidence from the anchor, and vectorizes the result — contour
  tracing, simplification, and squaring up against the site's own dominant
  axis. A dealership lot is normally the union of things several sources each
  describe only partly, which is a shape no amount of choosing between sources
  can produce. It stays off until it beats the candidate chain on the hold-out
  stratum of the public benchmark; compare with `npm run benchmark:boundary`
  and `npm run benchmark:boundary:fused`.
- Fences and walls act as hard cuts that region growing cannot cross, and are
  rasterized as 4-connected chains to match 4-connected growth, so a one-cell
  barrier is watertight rather than leaking diagonally.
- The cadastre now reinforces rather than originates: the anchor parcel adds
  weight only where operational evidence already exists. A parcel is a legal
  unit, routinely larger or smaller than the lot, and as a plain positive it
  floods the region out to its own edges.
- `docs/boundary-model.md` documents the method, the measured baseline and the
  model's limitations.

### Changed

- The CatNet adapter is now the generic hazard API adapter
  (`hazard-api.service.ts`, contract in `docs/risk-model.md`); CatNet settings
  and its stored key migrate automatically.
- Boundary overlap is now measured on a 0.5 m raster. The previous
  `approximatePolygonIoU` clamps to a 200x200 sample grid, which over a 400 m
  site is 2 m per cell — too coarse to resolve the 2 m outline tolerance it was
  reported alongside. It remains in use for the cheaper in-pipeline source
  agreement signal.
- Aerial tile requests are capped at 8 concurrent fetches instead of being
  fired all at once, so a wide capture box cannot flood the imagery provider.
- Overpass requests now retry once with a 30 s timeout. `fetchWithResilience`
  defaults POST to zero retries because POST is not generally idempotent, but
  an Overpass query is a read, and both mirrors failing at once previously
  discarded all vector evidence for a site.
- Cadastral and OSM vector responses use dedicated cache lifetimes (30 d and
  7 d). Re-fetching fences, roads and parcels at the 1 h Overpass TTL was pure
  latency.
- OSM evidence is collected in one cached Overpass round trip instead of two
  separate queries, and now also returns fences and walls, public roads,
  internal parking aisles, railways, watercourses, vegetation and address
  nodes. Multipolygon relations are resolved, so buildings and land use mapped
  that way are visible for the first time; the building search radius went from
  60 m to 300 m, which previously missed showrooms set back from the road.
- Cadastral lookup returns every parcel within 250 m rather than the single
  parcel containing the geocoded point, and detects a truncated WFS response.
  Dealerships routinely occupy several adjacent parcels.
- A third Overpass mirror was added, and mirrors are now tracked by the shared
  circuit breaker so a failing one is skipped rather than retried on every
  request.

### Added

- Cadastral snapping: when the grown region and the cadastre agree, the fused
  outline is replaced by the union of the parcels the site actually occupies.
  Assembly anchors on parcels containing the reference point or covering the
  mapped footprint, then expands along shared boundaries onto parcels carrying
  their own evidence — never onto unevidenced neighbours, however adjacent.
  Adjacency is measured as shared boundary length, because `@turf/intersect`
  returns null for abutting parcels (a shared edge has zero area) and would
  report every neighbour as non-adjacent while appearing to work.
- Cadastral lookups now report whether the reference point actually falls
  inside a returned parcel (`containsAnchor`). A parcel containing the point
  identifies the property; the nearest parcel is a guess that happens to be
  close, and the two were previously indistinguishable.

### Fixed

- Locations added from search no longer look identical to an existing branch
  of the same dealer group: when the name is already in the portfolio at a
  different site (Overture lists e.g. four "Autohaus Dresden GmbH" branches)
  or is only a brand ("Opel"), the street — or the town — is appended. The
  same site picked again keeps its name, so the duplicate check still skips it.
- Location search finds more businesses: legal forms ("GmbH & Co. KG") are
  dropped from the query because OSM names rarely carry them and Photon then
  returned other dealerships; a second query restricted to car dealerships
  (`shop=car`) is merged in; results are biased towards the visible map area
  (or Germany) and up to 8 are shown. Photon is limited to two concurrent
  requests.
- CSV/Excel import recognises "Dealership Name" and other common name
  headers (umlaut aliases such as "Händler"/"Länge" never matched before), no
  longer names locations after an ID column, and joins split Street / House
  Number / Postal Code / City columns into the address so the postal-code
  hail zone is found.
- Large imports no longer stall the app: vehicle dots are drawn only for the
  selected location (and every location in view from zoom 15), markers are
  added in bulk, and pending pins are inserted in one update.
- Batch analysis runs three locations in parallel, shows a progress bar with
  a remaining-time estimate, and saves a checkpoint every 25 locations. Main
  paces Nominatim to 1 request/s and caps Overpass at two concurrent requests
  per mirror, per the services' fair-use policies.
- Saving a manual boundary edit now clears the review flag; previously the
  edited boundary kept `reviewRequired` and the warning never went away.
- Vehicle detection no longer runs on Esri's grey "Map data not yet
  available" placeholders where Esri has no z20 imagery; such tiles now count
  as missing and the capture falls back a zoom level.
- API natural hazard values (CatNet) were stored like an import and re-used on
  every re-analysis, so later settings changes never took effect. Imports are
  now kept separately (`natCatImport`) and API sources are re-queried.
- The OSM lookup that finds dealership lots never returned anything. Its
  Overpass query ended in `out geom center tags;`, which yields elements with no
  `geometry` array at all, so every element was discarded by the caller's
  geometry-length check. Queried directly, that statement returned 38 elements
  around a test site — including the very way used as a benchmark reference —
  and not one carried geometry. It now uses `out geom;`. This was the single
  largest cause of poor lot detection: outside the seven states with a cadastre
  service, detection fell straight through to a drawn 100 m circle.
- A source that could not be reached was cached as "this site has nothing".
  `cached()` stores whatever its fetcher returns, so one unreachable moment
  persisted an empty result for the whole TTL — seven days for OSM evidence,
  thirty for cadastral parcels — leaving the engine blind to a site long after
  the service recovered. Reachability failures are no longer written to the
  cache; a genuinely empty answer still is, because that is a real result.
- Overpass rate limiting (HTTP 429) is handled as its own case. The generic
  retry policy retried after 250 ms, which burns the remaining quota and
  extends the block. The mirror is now stood down for the period its
  `Retry-After` header asks for, capped at 30 minutes.
- The boundary review rule existed in two copies, in the main process and in
  the renderer store, and had already drifted. Both now use
  `src/shared/boundary-review.ts`, so changing a review threshold can no longer
  silently clear a flag that detection had set.
- The endpoint circuit breaker never opened. A circuit that had recorded
  failures but had not yet tripped carried `openUntil = 0`, which the expiry
  check read as "already elapsed" and deleted — and callers ask before every
  attempt, so the failure count could never reach the threshold.
- Candidate geometry was accepted up to 2,000,000 m² while the plausibility
  score returned 0 above 250,000 m², so an implausibly large polygon scored
  zero there yet still collected points from every other ranking term. Both now
  share one set of per-role area bounds.
- `boundary:detect` now accepts session parameters. Detections triggered from
  the renderer previously ran on defaults and ignored every boundary threshold
  configured on the parameters page.

## [0.2.1] – 2026-09-13

### Added

- Added a shared HTTP resilience layer with bounded timeouts and retries for
  safe idempotent provider requests.
- Added stale-if-offline cache fallback and versioned SQLite migrations with a
  pre-migration backup.
- Batch analysis can now be stopped after the active location, and failures
  are retained per location while the remaining portfolio continues.
- Expanded automated coverage to 121 tests, including tile mosaics, temporal
  changes, settings/keychain fallbacks, detector fallbacks, boundary/hull
  geometry, and UI risk mappings; raised the global coverage gates.

### Changed

- Replaced the convex hull used for the aerial paved-surface boundary
  candidate with a concave ("digging") hull, so non-convex sites (common on
  industrial estates) no longer get a straight bridging edge across a
  missing corner that silently swallows neighbouring land, roads, or
  vegetation.
- Raised the vehicle-detection capture resolution (`DETECTION_ZOOM` 19→20)
  to better separate closely parked vehicles in dense/industrial lots, with
  automatic one-zoom-level fallback when a region doesn't publish imagery
  that sharp. Vehicle size sanity-checks now use real-world meters instead
  of a fixed pixel threshold, so they stay correct at any capture zoom.
- Removed the per-class van/truck/bus vehicle value parameters from
  Settings — the detector reports one underwriting category (every vehicle
  counted as a car; see `detection.service.ts`), so those fields never fed
  into any calculation and only implied a distinction the app doesn't make.

## [0.2.0] – 2026-09-13

### Added

- Repository hardening: pinned GitHub Actions, dependency review, release
  checksums/SBOM/provenance, community issue forms, and agent instructions.
- Added a source-aware natural-catastrophe provider architecture with
  automatic ZÜRS Geo CSV/XLSX import, encrypted CatNet credentials, HTTPS API
  lookup, provider evidence, and risk-score overrides with screening
  fallbacks.

### Changed

- Hardened local persistence against damaged settings, session, conversation,
  dashboard, and cache records.
- Deferred Keychain decryption until an API key is actually needed, avoiding a
  macOS credential prompt during normal startup.
- Made settings writes safer by persisting WMS templates on blur and showing
  recoverable errors in the settings page.

## [0.1.0] – 2026-08-20

### Added

- Electron desktop app (3-process model: Main / Preload / Renderer).
- CSV import and manual location entry with geocoding (Nominatim).
- Lot boundary detection with a fallback chain
  (ALKIS → OSM → Overture → MS Buildings → synthetic circle) and manual
  polygon correction (Geoman).
- AI vehicle detection via YOLOv26 ONNX (sliding window + soft-NMS) with a
  stub fallback.
- Risk scoring across 5 perils (wind, lightning, snow, flood, hail),
  including EAL, PML, cluster risk, and scenario simulation.
- Map visualisation (Leaflet) with peril, boundary, detection, and cluster
  layers.
- Dashboard: KPIs, charts, sortable/filterable table, detail dialog,
  portfolio comparison.
- LLM layer (Ollama / OpenAI / Claude / Gemini) for memos, executive
  summaries, portfolio chat, and natural-language queries with streaming.
- Local persistence (SQLite) + persistent API cache.
- Export as PDF, Excel, CSV, plus portfolio file (`.drm`).
- i18n (de / en / fr).

[Unreleased]: https://github.com/JanisKre/DealerShipRiskMappingApp/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/JanisKre/DealerShipRiskMappingApp/releases/tag/v0.2.1
[0.2.0]: https://github.com/JanisKre/DealerShipRiskMappingApp/releases/tag/v0.2.0
[0.1.0]: https://github.com/JanisKre/DealerShipRiskMappingApp/releases/tag/v0.1.0
