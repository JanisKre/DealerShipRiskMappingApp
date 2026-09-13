# DealerShipRiskMapping Desktop — Architecture

Target architecture for the rebuild as a standalone **Electron desktop app**
(single-user, local).
For feature scope, see [CORE_FUNCTIONALITIES.md](./CORE_FUNCTIONALITIES.md).

## Tech Stack

| Area               | Choice                                                   |
| ------------------ | ---------------------------------------------------------|
| Runtime/Shell      | Electron 44                                              |
| Build/Bundler      | electron-vite 5 + Vite 7                                 |
| Language           | TypeScript 5.8 (strict), separate tsconfigs (node/web)    |
| UI framework       | React 19                                                  |
| UI components      | **shadcn/ui + Tailwind CSS 4** (Radix primitives)         |
| State              | Zustand 5                                                 |
| DB (local)         | better-sqlite3 + Drizzle ORM (in the `userData` path)     |
| Maps               | Leaflet + react-leaflet + Geoman (polygon editing)        |
| ML inference       | onnxruntime-node (YOLOv26) in a `utilityProcess`           |
| LLM                | provider-agnostic (Ollama/OpenAI/Claude/Gemini)           |
| i18n               | i18next + react-i18next (de/en/fr)                        |
| IPC validation     | Zod at the IPC boundary                                   |
| Toolchain          | ESLint + Prettier + Husky + lint-staged                   |
| Tests              | Vitest (unit) + Playwright (E2E/component)                |
| Packaging          | electron-builder (mac/win)                                |
| Error tracking     | Sentry (optional)                                          |

## 3-Process Model

Core principle: strict separation of **Main / Preload / Renderer**. The
renderer runs sandboxed with no Node access; every bit of communication is
typed and Zod-validated over IPC.

```
┌─────────────────────────────────────────────────────────┐
│  RENDERER (sandboxed, no Node)                             │
│  React 19 + shadcn/ui + Tailwind + Zustand + Leaflet       │
│  ├─ components/  (map, dashboard, upload, ai, settings)    │
│  ├─ hooks/       (useDealerships, useBoundaryRefinement…)  │
│  ├─ store/       (Zustand: appStore)                       │
│  └─ services/    (thin wrappers around window.api.*)       │
└───────────────────────────▲──────────────────────────────┘
                             │  window.api.* (contextBridge)
┌────────────────────────────┴─────────────────────────────┐
│  PRELOAD (contextIsolation: true)                         │
│  Exposes only typed, whitelisted IPC channels             │
└───────────────────────────▲──────────────────────────────┘
                             │  ipcMain.handle  (Zod-validated)
┌───────────────────────────┴──────────────────────────────┐
│  MAIN (Node — "backend", replaces the Express server)     │
│  ├─ ipc/        (*.handlers.ts per domain)                │
│  ├─ services/   business logic:                           │
│  │   ├─ boundary.service   (ALKIS/OSM/Overture→fusion→QA)  │
│  │   ├─ detection.service  (YOLOv26 ONNX inference)         │
│  │   ├─ risk.service       (5 perils + EAL)                │
│  │   ├─ weather.service    (Open-Meteo/DWD + cache)        │
│  │   ├─ llm.service        (memos, chat, NL query)         │
│  │   └─ export.service     (CSV/PDF/Excel)                 │
│  ├─ db/         (Drizzle + better-sqlite3 repos)           │
│  ├─ workers/    (ONNX inference in the utilityProcess)     │
│  └─ config/     (settings, API keys via safeStorage)       │
└──────────────┬────────────────────────────────────────────┘
               │ direct HTTP calls (no CORS in Main!)
        External APIs: Overpass, Nominatim, MSFT Buildings, weather
```

## `src/shared/` — the bridge

Importable from both Main **and** Renderer, providing type safety across the
IPC boundary:

- `ipc-channels.ts` — channel names as constants (no magic strings)
- `ipc-schema.ts` — Zod schemas per IPC payload → type-safe + runtime validation
- `types.ts` — shared domain types (Dealership, BoundaryResult, RiskScore, …)

## Risk pipeline and provenance

Risk calculations follow an explicit `hazard → exposure → vulnerability →
loss` pipeline. The orchestration entry point is `main/services/risk.service.ts`;
the individual layers live under `main/services/risk/`. Hazard and boundary
sources are adapter-shaped so additional providers can be added without
changing the renderer contract. Boundary results additionally carry a geometry
role, validation diagnostics, source agreement, ranking margin and review
status. Results carry a model version, confidence, source evidence, fallback
flags, and limitations. See
[docs/risk-model.md](./docs/risk-model.md).

## Improvements over the web stack (deliberately carried over)

The move from web to desktop enables four concrete simplifications:

1. **Overture instead of Overture + MSFT** — Overture has since absorbed the
   MS Building Footprints via conflation (hierarchical merging, IoU > 0.5)
   and assigns stable GERS IDs. This collapses the boundary chain from 5 to
   4 sources: **ALKIS → OSM → Overture (incl. MSFT) → synthetic circle**. One
   fewer client; GERS IDs give stable building identity for change detection.
2. **Persistent local API cache** — a SQLite cache with a per-source TTL
   (Overpass 1 h, Buildings 7 d, weather configurable). Survives app restarts
   (the nginx cache was ephemeral) and enables partial offline operation.
   Replaces the Express proxies.
3. **Swappable detector interface** — a `VehicleDetector` abstraction so the
   YOLOv26 ONNX model can later be swapped for YOLO-OBB + SAHI tiling without
   changing the calling code.
4. **File export instead of share tokens** — export/import the portfolio as
   a `.drm` file (JSON) via the native file dialog. No token, no expiry, no
   server; the user shares the file themselves.

## Aerial imagery source for vehicle counting

The **Main process fetches orthophotos itself** (WMS/tile provider based on
the boundary bbox) and hands them to the ONNX worker. No renderer detour
through a pixel buffer, and it's cacheable offline via the same API cache.
Interface: `tiles.service.ts` → `aerialImageForBbox(bbox) → RGBA`.

## Translation: DRM server → Electron

| DRM (Express server)              | Electron equivalent                          |
| ---------------------------------- | --------------------------------------------- |
| REST routes (`server/routes/*`)   | IPC handlers (`src/main/ipc/*.handlers.ts`)   |
| `server/lib/*` business logic      | `src/main/services/*` (largely 1:1)           |
| Express proxy (CORS/caching)       | Resilient HTTP client in Main + local cache    |
| oauth2-proxy / nginx / rate limit  | dropped entirely                              |
| worker_threads inference           | Electron `utilityProcess` (ONNX)              |
| API keys as server env vars        | `safeStorage` (OS-keychain-encrypted)         |

## Folder Structure

```
dealership-risk-desktop/
├─ electron.vite.config.ts
├─ electron-builder.json
├─ src/
│  ├─ main/
│  │  ├─ index.ts              # app lifecycle, BrowserWindow
│  │  ├─ ipc/                  # *.handlers.ts per domain
│  │  ├─ services/             # boundary, detection, risk, weather, llm, export
│  │  ├─ db/                   # database.ts, versioned migrations, *.repo.ts
│  │  ├─ workers/              # onnx-inference (utilityProcess)
│  │  └─ config/               # settings, safeStorage keys
│  ├─ preload/
│  │  ├─ index.ts              # contextBridge → window.api
│  │  └─ index.d.ts
│  ├─ renderer/
│  │  ├─ index.html
│  │  └─ src/
│  │     ├─ components/        # + ui/ for shadcn
│  │     ├─ hooks/  store/  services/  styles/
│  │     └─ App.tsx
│  └─ shared/
│     ├─ ipc-channels.ts
│     ├─ ipc-schema.ts         # Zod
│     └─ types.ts
```

## Security Baseline

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- The renderer reaches Node **only** through channels exposed by the preload
- IPC payloads are validated at the boundary with Zod
- API keys via `safeStorage` (OS-keychain-encrypted), never in plain text
- ONNX inference runs in a `utilityProcess` — keeps the heavy YOLOv26 workload
  off the app/IPC event loop (equivalent to DRM's worker_threads)
