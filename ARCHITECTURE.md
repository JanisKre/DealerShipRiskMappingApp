# DealerShipRiskMapping Desktop — Architecture

Architecture of the standalone **Electron desktop app** (single-user, local).
For feature scope, see the [README](./README.md#what-it-does).

## Tech Stack

| Area               | Choice                                                   |
| ------------------ | ---------------------------------------------------------|
| Runtime/Shell      | Electron 44                                              |
| Build/Bundler      | electron-vite 6 + Vite 8                                 |
| Language           | TypeScript 6 (strict), separate tsconfigs (node/web)      |
| UI framework       | React 19                                                  |
| UI components      | **shadcn/ui + Tailwind CSS 4** (Radix primitives)         |
| State              | Zustand 5                                                 |
| DB (local)         | better-sqlite3 + Drizzle ORM (in the `userData` path)     |
| Maps               | Leaflet + own React bindings + Geoman (polygon editing)   |
| ML inference       | onnxruntime-node (YOLOv26) in a `utilityProcess`           |
| LLM                | provider-agnostic (Ollama/LM Studio/llama.cpp, OpenAI, Claude, custom endpoint) |
| i18n               | i18next + react-i18next (de/en/fr)                        |
| IPC validation     | Zod at the IPC boundary                                   |
| Toolchain          | ESLint (incl. jsx-a11y) + Prettier                        |
| Tests              | Vitest (unit, fast-check) + Playwright (E2E, axe-core)    |
| Packaging          | electron-builder (mac/win)                                |
| Logging            | rotating local log file; no error-tracking service        |

## 3-Process Model

Core principle: strict separation of **Main / Preload / Renderer**. The
renderer runs sandboxed with no Node access; every bit of communication is
typed and Zod-validated over IPC.

```
┌─────────────────────────────────────────────────────────┐
│  RENDERER (sandboxed, no Node)                             │
│  React 19 + shadcn/ui + Tailwind + Zustand + Leaflet       │
│  ├─ components/  (map, dashboard, upload, ai, settings)    │
│  ├─ components/  (map, dashboard, upload, chat, settings…) │
│  ├─ store/       (Zustand stores)                          │
│  └─ lib/         (formatting, analytics, chat helpers)     │
└───────────────────────────▲──────────────────────────────┘
                             │  window.api.* (contextBridge)
┌────────────────────────────┴─────────────────────────────┐
│  PRELOAD (contextIsolation: true)                         │
│  Exposes only typed, whitelisted IPC channels             │
└───────────────────────────▲──────────────────────────────┘
                             │  ipcMain.handle  (Zod-validated)
┌───────────────────────────┴──────────────────────────────┐
│  MAIN (Node — "backend", replaces the Express server)     │
│  ├─ ipc/        (index.ts: handlers, sender checks)        │
│  ├─ services/   business logic:                           │
│  │   ├─ boundary.service   (source cascade: parcels+cars)  │
│  │   ├─ detection.service  (YOLOv26 ONNX inference)         │
│  │   ├─ risk.service       (hail score + hail EAL)         │
│  │   ├─ weather.service    (Open-Meteo CAPE + cache)       │
│  │   ├─ hail-history/      (DWD hail days, context only)   │
│  │   ├─ llm.service        (memos, chat, NL query, A2UI)   │
│  │   └─ export.service     (CSV/PDF/Excel/.drm)            │
│  ├─ db/         (Drizzle + better-sqlite3 repos)           │
│  └─ workers/    (ONNX inference, Overture dealer download) │
└──────────────┬────────────────────────────────────────────┘
               │ direct HTTP calls (no CORS in Main!)
        External APIs: Overpass, Nominatim, Photon, state cadastre
        (ALKIS), orthophotos, Overture Maps (STAC + S3), Open-Meteo,
        DWD, LLM providers, Hugging Face Hub, GitHub releases;
        local: Ollama / LM Studio / llama.cpp (loopback only)
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

1. **One boundary cascade instead of a chain of building sources** — the web
   stack merged ALKIS, OSM, Overture and MS Building Footprints. The desktop
   app runs a vehicle-led source cascade: the cadastral parcel at the point
   plus adjacent parcels on which detected vehicles stand, else the outline
   of the vehicle lot, a cached OSM dealer area, the bare parcel or a
   fallback octagon (see [docs/boundary-model.md](./docs/boundary-model.md)).
   Overture is used only for the offline dealer directory.
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
Earlier versions of the Esri image (World Imagery Wayback) are listed per
location by `wayback.service.ts` (IPC `imagery:timeline`) and can be pinned
as the map's satellite basemap; see docs/imagery-sources.md.

## Translation: DRM server → Electron

| DRM (Express server)              | Electron equivalent                          |
| ---------------------------------- | --------------------------------------------- |
| REST routes (`server/routes/*`)   | IPC handlers (`src/main/ipc/index.ts`)        |
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
│  │  ├─ ipc/                  # index.ts: all IPC handlers
│  │  ├─ services/             # boundary, detection, risk, weather, llm, export, …
│  │  ├─ db/                   # database.ts, versioned migrations, *.repo.ts
│  │  └─ workers/              # onnx-inference, overture-dealers (utilityProcess)
│  ├─ preload/
│  │  ├─ index.ts              # contextBridge → window.api
│  │  └─ index.d.ts
│  ├─ renderer/
│  │  ├─ index.html
│  │  └─ src/
│  │     ├─ components/        # + ui/ for shadcn
│  │     ├─ hooks/  store/  lib/  locales/  styles/
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
- Outgoing HTTP goes through `fetchWithResilience` (`http.service.ts`), whose
  transport is Electron's `net.fetch` in the main and utility processes:
  system proxy and OS certificate store, HTTP(S) only, no cookies
- Electron fuses (`electron-builder.json`): no `RunAsNode`, `NODE_OPTIONS` or
  `--inspect`; `app.asar` only, with integrity validation
- Updates (`update.service.ts`): GitHub "latest release" check; Windows
  downloads and installs through electron-updater (SHA-512 checked), unsigned
  macOS builds link to the release page
- Support (`log.service.ts`, `diagnostics.service.ts`,
  `data-reset.service.ts`): rotating log file with secret masking, a
  diagnostics export without portfolios, and "delete all data", which
  removes the app's files on the next start before anything opens them
