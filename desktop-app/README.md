# Dealership Risk Mapping — Desktop

Standalone Electron desktop app for physical risk assessment of dealership
portfolios. A rebuild of the web platform as a single-user desktop app.

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
| `npm run pack`          | Build unpacked app (release/)       |
| `npm run dist`          | Build installer (dmg/nsis/AppImage) |

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

Boundary detection is source-aware rather than silently treating every polygon
as equally reliable:

- ALKIS is preferred where a verified state WFS adapter is available.
- OSM/Overpass contributes parking, retail and car-dealer geometries. The
  resolver ranks them using tags, dealership name/address and point
  containment, then retains the other candidates for review.
- A building footprint is only a low-confidence fallback; it is not presented
  as a parking-lot boundary.
- Every automatic result includes `confidence`, `reviewRequired` and up to ten
  ranked `candidates`. Low-confidence results are surfaced in the map UI.

For a Germany-wide rollout, the next production data layer should be a
licensed nationwide cadastral feed (for example [BKG FS-DE](https://www.bkg.bund.de/SharedDocs/Produktinformationen/BKG/DE/P-2026/260305_FS-DE.html)
where access and licensing permit it). [BKG DOP20](https://gdz.bkg.bund.de/index.php/default/webdienste/digitale-orthophotos/wmts-digitale-orthophotos-bodenauflosung-20cm-wmts-dop.html)
is useful for visual validation and model input, while [BKG LB-DE](https://gdz.bkg.bund.de/index.php/default/wms-landbedeckung-deutschland-wms-lb-de.html)
and ATKIS/Basis-DLM are useful priors for land-use filtering; they do not
replace a dealership-lot polygon. OSM and Overture Places are useful for POI
conflation, but neither should be used alone as proof of the lot boundary.

The acceptance benchmark should use manually verified dealership polygons: the
predicted boundary must cover at least 90% of the reference lot area in at
least 90% of the benchmark cases. Cases below that threshold remain reviewable
and should feed back into source-specific ranking and calibration.

## Feature Scope

- CSV import, manual entry, geocoding (Nominatim)
- Multi-source boundary detection (ALKIS + semantic OSM/Overpass candidates)
  with confidence, review flags and manual correction via Geoman
- Weather (Open-Meteo), risk scoring (5 perils + EAL breakdown, utilisation,
  exposure, PML, cluster heatmap)
- Real YOLOv26 ONNX vehicle detection (Esri aerial imagery tiles, sliding
  window, soft-NMS) with stub fallback and installation wizard
- Leaflet map: satellite toggle, boundary/detection/cluster layers, hailstorm
  scenario corridor
- Dashboard: KPIs, charts (recharts), sortable/filterable table, detail
  dialog, portfolio comparison
- AI analysis (Ollama/OpenAI/Claude/Gemini): structured underwriting memo,
  portfolio chat, executive summary, natural-language query — with streaming
- Export: PDF, Excel, CSV; portfolio file export/import (.drm)
- Session persistence (SQLite), i18n (de/en/fr)
