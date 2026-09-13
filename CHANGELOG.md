# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

No changes yet.

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
