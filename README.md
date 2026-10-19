<div align="center">

# 🚗 Dealership Risk Mapping

**Desktop app for hail-risk screening of car dealership portfolios — local, single-user, open source**

[![Release](https://img.shields.io/github/v/release/JanisKre/DealerShipRiskMappingApp?label=release&color=2563eb)](https://github.com/JanisKre/DealerShipRiskMappingApp/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS_%7C_Windows-2563eb)](#download)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-2563eb)](./LICENSE)
[![Status](https://img.shields.io/badge/status-work_in_progress-2563eb)](./CHANGELOG.md)

**[Homepage](https://janiskre.github.io/DealerShipRiskMappingApp/) · [Docs](https://janiskre.github.io/DealerShipRiskMappingApp/docs/) · [Releases](https://github.com/JanisKre/DealerShipRiskMappingApp/releases)**

</div>

## Download

| Platform              | Installer                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS (Apple Silicon) | [dealership-risk-desktop-mac-arm64.dmg](https://github.com/JanisKre/DealerShipRiskMappingApp/releases/latest/download/dealership-risk-desktop-mac-arm64.dmg) |
| macOS (Intel)         | [dealership-risk-desktop-mac-x64.dmg](https://github.com/JanisKre/DealerShipRiskMappingApp/releases/latest/download/dealership-risk-desktop-mac-x64.dmg)     |
| Windows (x64)         | [dealership-risk-desktop-win-x64.exe](https://github.com/JanisKre/DealerShipRiskMappingApp/releases/latest/download/dealership-risk-desktop-win-x64.exe)     |

Builds are not code-signed yet. macOS reports the app as **"damaged"**: move
it to **Applications**, then clear the quarantine flag and open it normally:

```bash
xattr -cr "/Applications/Dealership Risk Mapping.app"
```

On Windows, SmartScreen may warn "Unknown publisher" — click **More info → Run
anyway**. Linux: build an AppImage from source (`npm run dist`).

## What it does

> **Import CSV → detect lot boundaries → count vehicles on aerial imagery →
> score hail and the hail EAL → map + dashboard → AI memo → export.**

- **Import** — CSV/TSV/Excel or single addresses, geocoded via Nominatim
- **Lot boundaries** — ALKIS → OSM/Overpass → MS Building Footprints →
  synthetic circle, with confidence scores and manual correction (Geoman)
- **Vehicle counts** — YOLOv26 ONNX inference on aerial imagery tiles; edited
  boundaries can be recounted
- **Hail risk** — hail only: score from GDV hail zones, a licensed provider or
  an Open-Meteo CAPE proxy; expected annual loss (EAL), accumulations and
  hailstorm scenarios
- **Dashboard** — KPIs, charts, sortable table, location details, portfolio
  comparison
- **AI layer (optional)** — underwriting memos, summaries and portfolio chat
  with a local runtime (Ollama, LM Studio, llama.cpp), OpenAI, Claude or a
  custom endpoint
- **Local & exportable** — SQLite in the user data folder, offline API cache;
  export to PDF, Excel, CSV and `.drm` portfolio files; German, English, French.
  There is no multi-user mode: share a `.drm` file (it carries manually edited
  boundaries and vehicle counts) and a colleague can open it as a new portfolio
  or merge it into theirs from the portfolio menu

Results are screening estimates, not an engineering, legal or insurance
decision — see the [risk model](./docs/risk-model.md) for sources and
limitations.

## Development

Requires **Node.js ≥ 22**. Run from `desktop-app/`:

```bash
npm ci
npm run rebuild   # native modules (better-sqlite3, onnxruntime-node, sharp) for Electron
npm run dev       # Main + Preload + Renderer with HMR
```

| Script                       | Purpose                                 |
| ---------------------------- | --------------------------------------- |
| `npm run typecheck` / `lint` | TypeScript check / ESLint (0 warnings)  |
| `npm test` / `test:coverage` | Unit tests (Vitest), with coverage      |
| `npm run build` / `smoke`    | Production build / smoke-test it        |
| `npm run pack` / `dist`      | Unpacked app / installer (dmg, nsis, AppImage) |

**Detection model:** the YOLOv26s weights
([`dronefreak/visdrone-yolov26s`](https://huggingface.co/dronefreak/visdrone-yolov26s),
~36 MB, AGPL-3.0) are not in the repo. Place them at
`desktop-app/resources/models/yolov26s_aerial_vehicles.onnx`, or let the
first-run wizard download them. Without the model the app falls back to an
area-based estimate.

**Stack:** Electron 44 · electron-vite 5 · TypeScript 5.8 · React 19 ·
shadcn/ui + Tailwind CSS 4 · Zustand · better-sqlite3 + Drizzle · Leaflet +
Geoman · onnxruntime-node · Zod · i18next · electron-builder.

```
desktop-app/src/
├─ main/       # IPC handlers, services, DB, ONNX worker
├─ preload/    # contextBridge → window.api
├─ renderer/   # React UI
└─ shared/     # Zod schemas, types, IPC channels
```

## Security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; the
  renderer reaches Node only through typed preload channels
- Every IPC payload is validated with **Zod** in the main process
- API keys are encrypted with `safeStorage` (OS keychain), never stored in
  plain text
- ONNX inference runs in a separate `utilityProcess`

Details: [ARCHITECTURE.md](./ARCHITECTURE.md) · Reporting a vulnerability:
[SECURITY.md](./SECURITY.md)

## Code signing policy

Windows releases are being set up for signing with a certificate issued to the
SignPath Foundation; until that is approved, Windows builds are unsigned. Free
code signing provided by [SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

- Only binaries built from this repository by the tag-driven
  [Release workflow](./.github/workflows/release.yml) on GitHub-hosted runners
  are submitted for signing.
- Roles: the maintainer, [Janis Kretschmann](https://github.com/JanisKre), is
  committer, reviewer and approver. Signing requests for release builds are
  approved manually.
- Multi-factor authentication is required for every account that can trigger
  or approve a signing request.
- Releases include SHA-256 checksums, a CycloneDX SBOM and GitHub build
  provenance attestations.
- macOS builds are not yet signed or notarized; see [Download](#download).

## Privacy

The app is local and single-user: the maintainer receives no data and there is
no telemetry. It contacts third-party map, imagery, weather and (optionally)
AI services only for analyses you start, and an AI memo is only generated when
you configure a provider. Details: [PRIVACY.md](./PRIVACY.md).

## More documentation

[ARCHITECTURE.md](./ARCHITECTURE.md) ·
[CONTRIBUTING.md](./CONTRIBUTING.md) ·
[CHANGELOG.md](./CHANGELOG.md) ·
[desktop-app/README.md](./desktop-app/README.md) ·
[SUPPORT.md](./.github/SUPPORT.md) ·
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## License

GPL-3.0-or-later © [Janis Kretschmann](https://github.com/JanisKre) — see
[LICENSE](./LICENSE). Third-party components keep their own licences:

- **npm dependencies** — `npm run build` writes their licence texts to
  `desktop-app/out/licenses/THIRD_PARTY_NOTICES.txt`; packaged builds ship it
  in `resources/licenses/`.
- **Vehicle detection model** — Ultralytics-based weights are AGPL-3.0 and not
  part of this repository. The training data has its own terms (VisDrone, DOTA
  and DLR 3K Munich are released for research); check them before bundling the
  model or using it commercially. See
  [training/README.md](./training/README.md#licences).
- **Data** — OpenStreetMap (ODbL 1.0), Overture Maps (CDLA Permissive 2.0;
  Foursquare-sourced places Apache 2.0) and the state orthophoto services
  (dl-de/by-2-0, dl-de/zero-2-0, CC BY 4.0). The app shows the required
  attribution; see [docs/imagery-sources.md](./docs/imagery-sources.md) and
  [docs/dealer-directory.md](./docs/dealer-directory.md).
