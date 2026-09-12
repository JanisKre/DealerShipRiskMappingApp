# Dealership Risk Mapping — Desktop

Standalone Electron desktop app for physical risk assessment of dealership
portfolios. A rebuild of the web platform as a single-user desktop app.

## Stack

Electron 36 · electron-vite · React 19 · TypeScript · shadcn/ui + Tailwind CSS 4
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

If the model is missing, the app shows an installation wizard on startup
(downloads the model automatically once a download source is configured —
see `MODEL_DOWNLOAD_URL` in `src/main/services/model.service.ts`) and falls
back until then to the `StubVehicleDetector` (an area-based heuristic) — the
app still runs, but does not produce real vehicle detections.

## Development

```bash
npm install
npm run rebuild   # rebuild native modules (better-sqlite3, onnxruntime-node, sharp) against the Electron ABI
npm run dev       # starts Main + Preload + Renderer with HMR
```

## Scripts

| Script              | Purpose                                  |
| ------------------- | ----------------------------------------- |
| `npm run dev`       | Development mode with HMR                 |
| `npm run build`     | Production build (out/)                   |
| `npm run typecheck` | TypeScript check (node + web)             |
| `npm run pack`      | Build unpacked app (release/)             |
| `npm run dist`      | Build installer (dmg/nsis/AppImage)       |

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

## Feature Scope

- CSV import, manual entry, geocoding (Nominatim)
- Boundary detection (OSM/Overpass) with manual correction via Geoman
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
