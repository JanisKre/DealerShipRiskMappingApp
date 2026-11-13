# Dealership Risk Mapping — Desktop

Standalone Electron desktop app for hail-risk screening of dealership
portfolios. A rebuild of the web platform as a single-user desktop app.

Test data: the [German car dealership dataset](https://github.com/JanisKre/dealership_dataset)
(OpenStreetMap, ODbL 1.0) has CSV and Excel files with 10, 50, 100, 250 and
500 real locations that import as they are.

## Stack

Electron 44 · electron-vite · React 19 · TypeScript · shadcn/ui + Tailwind CSS 4
· Zustand · better-sqlite3 · onnxruntime-node · sharp · Leaflet · recharts ·
@tanstack/react-table · Zod (IPC validation)

## ONNX Model (required)

The vehicle detection model — YOLOv26s, fine-tuned on VisDrone (aerial
vehicle imagery), ~36 MB, see [`dronefreak/visdrone-yolov26s`](https://huggingface.co/dronefreak/visdrone-yolov26s)
on Hugging Face (AGPL-3.0) — is **not** included in the repo. Place it
locally before starting the app:

```
resources/models/yolov26s_aerial_vehicles.onnx
```

On first launch, the app shows an installation wizard. If the model is
missing, the wizard downloads it from the latest GitHub release into the
user-data directory and keeps it across app updates. Until the model is
installed, the app falls back to the `StubVehicleDetector` (an area-based
heuristic) — the app still runs, but does not produce real vehicle detections.

## Development

```bash
npm install
npm run rebuild   # rebuild native modules (better-sqlite3, onnxruntime-node, sharp) against the Electron ABI
npm run dev       # starts Main + Preload + Renderer with HMR
```

## Scripts

| Script                  | Purpose                             |
| ----------------------- | ----------------------------------- |
| `npm run dev`           | Development mode with HMR           |
| `npm run build`         | Production build (out/)             |
| `npm run typecheck`     | TypeScript check (node + web)       |
| `npm run test`          | Unit tests (Vitest)                 |
| `npm run test:coverage` | Unit tests with V8 coverage report  |
| `npm run smoke`         | Smoke-test the built Electron app   |
| `npm run test:e2e`      | Playwright UI tests on the build    |
| `npm run pack`          | Build unpacked app (release/)       |
| `npm run dist`          | Build installer (dmg/nsis/AppImage) |

External provider requests use bounded timeouts and retries for safe
idempotent calls. Cached provider data can be used while offline when a fresh
request fails. SQLite schema changes are applied transactionally and create a
standalone backup before migrating an existing database.

## Architecture (short form)

3-process model with strict separation:

- **main/** — "backend": IPC handlers, services (boundary, detection, risk,
  weather, llm, export), SQLite DB + persistent API cache, ONNX inference in
  a `utilityProcess`
- **preload/** — `contextBridge` → typed, whitelisted `window.api`
- **renderer/** — React UI (shadcn/Tailwind), Zustand, Leaflet map, dashboard,
  AI analysis
- **shared/** — Zod schemas + types + IPC channels (shared by main & renderer)

Security baseline: `contextIsolation: true`, `sandbox: true`,
`nodeIntegration: false`. The renderer reaches Node only through the preload
API.

## Boundary quality and Germany-wide coverage

Lot boundaries come from a **source cascade** (`src/main/services/boundary/cascade.ts`,
cascade v3) in which the detected vehicles decide how far a site reaches and
the cadastre decides its shape:

1. the ALKIS parcel at the point plus every adjacent parcel on which enough
   lot vehicles stand,
2. else the outline of the vehicle lot,
3. else an OSM dealer area, only when OSM is already cached (the analysis
   never waits for Overpass),
4. else the bare parcel at the point,
5. else a fallback octagon (160 m) around the point, drawn dashed and
   always flagged for review.

Every result carries a source, `confidence`, `reviewRequired` with named
review reasons (low confidence, vehicles outside, incomplete cadastre,
winter imagery, …) and the other computed `candidates`, so a reviewer can
switch with one click or correct the polygon with Geoman. Cadastral parcels
come from the open WFS services of 14 states; official building footprints
(13 states) and OSM buildings mask roofs before vehicles are counted.

Method, measurements and limitations: [docs/boundary-model.md](../docs/boundary-model.md).
`npm run benchmark:boundary` measures the cascade against reference
polygons; `npm run benchmark:boundary:replay` replays frozen inputs offline.

## Feature Scope

- CSV/TSV/Excel import with preview, manual entry, geocoding (Nominatim,
  Photon, official house coordinates in 8 states)
- Lot boundaries from the source cascade (ALKIS parcels + detected vehicles)
  with confidence, review reasons and manual correction via Geoman
- Hail risk scoring (GDV hail zones, Open-Meteo CAPE proxy, optional licensed
  provider) with hail EAL breakdown, utilisation, exposure, PML, cluster
  heatmap
- Real YOLOv26 ONNX vehicle detection (Esri aerial imagery tiles, sliding
  window, soft-NMS) with stub fallback and installation wizard
- Leaflet map: satellite toggle, boundary/detection/cluster layers, hailstorm
  scenario corridor
- Dashboard: KPIs, charts (recharts), sortable/filterable table, detail
  dialog, portfolio comparison
- AI analysis (Ollama/LM Studio/llama.cpp, OpenAI, Claude, custom endpoint):
  structured underwriting memo, portfolio chat, natural-language query and
  AI dashboards (A2UI) — with streaming
- Hail history: observed hail days at nearby DWD stations (context only)
- Export: PDF, Excel, CSV, read-only view; portfolio file export/import (.drm)
- Session persistence (SQLite), i18n (de/en/fr)
