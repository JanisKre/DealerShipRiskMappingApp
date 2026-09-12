<div align="center">

# 🚗 Dealership Risk Mapping

**Desktop app for physical risk assessment of dealership portfolios**

Upload CSV → detect lot boundaries → count vehicles with AI → score 5 natural hazards → visualise on map & dashboard → generate LLM memos → export

<br />

![Electron](https://img.shields.io/badge/Electron-36-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
![electron-vite](https://img.shields.io/badge/electron--vite-5-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)
![ONNX Runtime](https://img.shields.io/badge/ONNX_Runtime-YOLOv26-005CED?logo=onnx&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?logo=leaflet&logoColor=white)

![Status](https://img.shields.io/badge/status-work_in_progress-yellow)
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![Type](https://img.shields.io/badge/mode-single--user_·_local-important)
![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)

### ⬇️ Download

[![Download for macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple_Silicon-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/JanisKre/DealerShipRiskMappingApp/releases/latest/download/dealership-risk-desktop-mac-arm64.dmg)
[![Download for macOS (Intel)](https://img.shields.io/badge/macOS-Intel-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/JanisKre/DealerShipRiskMappingApp/releases/latest/download/dealership-risk-desktop-mac-x64.dmg)
[![Download for Windows](https://img.shields.io/badge/Windows-x64-0078D6?style=for-the-badge&logo=windowsterminal&logoColor=white)](https://github.com/JanisKre/DealerShipRiskMappingApp/releases/latest/download/dealership-risk-desktop-win-x64.exe)

*Builds are not code-signed (no paid developer certificate). macOS will show
"app is damaged" — right-click the app → **Open** once to bypass Gatekeeper.
Windows SmartScreen may warn "Unknown publisher" — click **More info → Run
anyway**. See [all releases](https://github.com/JanisKre/DealerShipRiskMappingApp/releases).*

</div>

---

## Contents

- [Download](#️-download)
- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [ONNX Model (required)](#onnx-model-required)
- [Scripts](#scripts)
- [Project Structure](#project-structure)
- [Security](#security)
- [Documentation](#documentation)
- [License](#license)

## Overview

**Dealership Risk Mapping** is a standalone Electron desktop app that assesses
dealership locations for their physical exposure to natural hazards. The app
runs entirely locally (single-user): location data, analyses, and API keys
stay on the machine. It is the desktop rebuild of an original web platform —
without that platform's multi-user infrastructure (OAuth, nginx, sharing,
rate limiting).

The core workflow in one sentence:

> **Import CSV → automatically detect lot boundaries → count vehicles on
> aerial imagery via YOLOv26 → score wind/lightning/snow/flood/hail →
> map + dashboard → AI underwriting memo → export.**

## Features

- 📥 **Data import** — CSV portfolio upload + manual single-entry input with
  address geocoding (Nominatim)
- 🗺️ **Lot boundary detection** — fallback chain
  ALKIS → OSM/Overpass → Overture → MS Building Footprints → synthetic circle,
  with confidence scoring and manual polygon correction (Geoman)
- 🤖 **AI vehicle detection** — YOLOv26 ONNX inference on aerial imagery tiles
  (sliding window + soft-NMS), with a stub fallback when no model is present
- 🌪️ **Risk scoring across 5 perils** — wind, lightning, snow, flood (pluvial),
  hail; EAL (Expected Annual Loss), PML, cluster risk, scenario simulation
- 📊 **Dashboard & analysis** — KPIs, charts (recharts), sortable/filterable
  table, detail dialog, portfolio comparison
- 🧠 **LLM layer** — underwriting memos, executive summaries, portfolio chat,
  and natural-language queries; provider-agnostic (Ollama / OpenAI / Claude /
  Gemini) with streaming
- 💾 **Local persistence** — SQLite in the `userData` path + persistent API
  cache
- 📤 **Export** — PDF, Excel, CSV, plus portfolio file export/import (`.drm`)
- 🌍 **i18n** — German, English, French

## Tech Stack

| Area              | Choice                                                   |
| ----------------- | --------------------------------------------------------- |
| Runtime/Shell     | Electron 36                                               |
| Build/Bundler     | electron-vite 5 + Vite 7                                  |
| Language          | TypeScript 5.8 (strict), separate tsconfigs (node/web)    |
| UI framework      | React 19                                                  |
| UI components     | shadcn/ui + Tailwind CSS 4 (Radix primitives)             |
| State             | Zustand 5                                                 |
| DB (local)        | better-sqlite3 + Drizzle ORM                              |
| Maps              | Leaflet + react-leaflet + Geoman                          |
| ML inference      | onnxruntime-node (YOLOv26) in a `utilityProcess`          |
| LLM               | provider-agnostic (Ollama / OpenAI / Claude / Gemini)     |
| IPC validation    | Zod at the IPC boundary                                   |
| i18n              | i18next + react-i18next (de/en/fr)                        |
| Packaging         | electron-builder (mac/win/linux)                          |

## Architecture

Strict **3-process model** (Main / Preload / Renderer). The renderer runs
sandboxed with no Node access; every bit of communication is typed and
Zod-validated over IPC.

```
┌──────────────────────────────────────────────┐
│  RENDERER (sandboxed)                          │
│  React 19 · shadcn/ui · Zustand · Leaflet      │
└───────────────────────▲────────────────────────┘
                         │ window.api.* (contextBridge)
┌────────────────────────┴────────────────────────┐
│  PRELOAD (contextIsolation)                       │
│  only typed, whitelisted IPC channels             │
└───────────────────────▲────────────────────────┘
                         │ ipcMain.handle (Zod)
┌────────────────────────┴────────────────────────┐
│  MAIN (Node — "backend")                          │
│  ipc/ · services/ · db/ · workers/ (ONNX) · config│
└────────────────────────┬────────────────────────┘
                         │ direct HTTP calls (no CORS)
              External APIs: Overpass · Nominatim · Buildings · Weather
```

Details, tech-stack rationale, and the web→Electron translation:
👉 **[ARCHITECTURE.md](./ARCHITECTURE.md)**

## Getting Started

Requires: **Node.js ≥ 22**.

```bash
cd desktop-app
npm install
npm run rebuild   # rebuild native modules (better-sqlite3, onnxruntime-node, sharp) against the Electron ABI
npm run dev       # starts Main + Preload + Renderer with HMR
```

## ONNX Model (required)

The vehicle detection model — YOLOv26s, fine-tuned on VisDrone (aerial
vehicle imagery), ~36 MB, see [`dronefreak/visdrone-yolov26s`](https://huggingface.co/dronefreak/visdrone-yolov26s)
on Hugging Face (AGPL-3.0) — is **not** included in the repo and must be
placed locally:

```
desktop-app/resources/models/yolov26s_aerial_vehicles.onnx
```

> If the model is missing, the app shows an installation wizard on startup
> (auto-download once a source is configured) and falls back until then to
> the `StubVehicleDetector` (an area-based heuristic) — the app still runs,
> but does not produce real vehicle detections.

## Scripts

Run from `desktop-app/`:

| Script              | Purpose                                  |
| ------------------- | ----------------------------------------- |
| `npm run dev`       | Development mode with HMR                 |
| `npm run build`     | Production build (`out/`)                 |
| `npm run typecheck` | TypeScript check (node + web)             |
| `npm run lint`      | ESLint (0 warnings allowed)                |
| `npm run test`      | Unit tests (Vitest)                        |
| `npm run pack`      | Build unpacked app (`release/`)            |
| `npm run dist`      | Build installer (dmg / nsis / AppImage)    |

## Project Structure

```
DealerShipRiskMapping/
├─ README.md                 # this document
├─ ARCHITECTURE.md           # target architecture & tech-stack rationale
├─ CONTRIBUTING.md           # development workflow & conventions
├─ CHANGELOG.md              # version history
└─ desktop-app/              # the Electron app
   ├─ src/
   │  ├─ main/               # IPC handlers, services, DB, ONNX worker
   │  ├─ preload/            # contextBridge → window.api
   │  ├─ renderer/           # React UI (components, store, styles)
   │  └─ shared/             # Zod schemas, types, IPC channels
   ├─ resources/             # sample_dealerships.csv, models/ (ONNX, gitignored)
   ├─ electron.vite.config.ts
   └─ electron-builder.json
```

## Security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- The renderer reaches Node **only** through channels exposed by the preload
- IPC payloads are validated at the boundary with **Zod**
- API keys are stored via `safeStorage` (OS-keychain-encrypted) — never in
  plain text
- ONNX inference runs in a `utilityProcess`, separate from the app/IPC event
  loop

## Documentation

| Document                                             | Content                                 |
| ----------------------------------------------------- | ---------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                 | Target architecture, 3-process model     |
| [CONTRIBUTING.md](./CONTRIBUTING.md)                 | Development workflow, conventions        |
| [CHANGELOG.md](./CHANGELOG.md)                       | Version history                          |
| [desktop-app/README.md](./desktop-app/README.md)     | App-specific details                     |
| [SECURITY.md](./SECURITY.md)                         | Reporting a vulnerability                |
| [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)           | Community guidelines                     |
| [LICENSE](./LICENSE)                                 | GPL-3.0-or-later License                              |

## License

GPL-3.0-or-later © [Janis Kretschmann](https://github.com/JanisKre) — see [LICENSE](./LICENSE).
