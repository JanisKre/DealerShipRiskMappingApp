# Dealership Risk Mapping

Desktop app for screening the hail risk of car dealership portfolios. It runs
locally for a single user and is source-available.

[![Release](https://img.shields.io/github/v/release/JanisKre/DealerShipRiskMappingApp?label=release&color=2563eb)](https://github.com/JanisKre/DealerShipRiskMappingApp/releases/latest)
[![License](https://img.shields.io/badge/license-PolyForm_Noncommercial_1.0.0-2563eb)](./LICENSE)

[Homepage](https://janiskre.github.io/DealerShipRiskMappingApp/) |
[Docs](https://janiskre.github.io/DealerShipRiskMappingApp/docs/) |
[Releases](https://github.com/JanisKre/DealerShipRiskMappingApp/releases)

## Download

- [macOS, Apple Silicon](https://github.com/JanisKre/DealerShipRiskMappingApp/releases/latest/download/dealership-risk-desktop-mac-arm64.dmg)
- [macOS, Intel](https://github.com/JanisKre/DealerShipRiskMappingApp/releases/latest/download/dealership-risk-desktop-mac-x64.dmg)
- [Windows x64](https://github.com/JanisKre/DealerShipRiskMappingApp/releases/latest/download/dealership-risk-desktop-win-x64.exe)

The builds are not code-signed yet. On macOS the app is reported as damaged.
Move it to Applications and clear the quarantine flag:

```bash
xattr -cr "/Applications/Dealership Risk Mapping.app"
```

On Windows, SmartScreen warns about an unknown publisher. Click "More info",
then "Run anyway". For Linux, build an AppImage from source with `npm run dist`.

## What it does

You import a list of dealership addresses. The app finds each lot, counts the
vehicles on aerial imagery and scores the hail exposure.

- Import CSV, TSV or Excel files, or single addresses. Geocoding uses
  Nominatim, Photon and official house coordinates where a state publishes
  them.
- Lot boundaries come from cadastral parcels (ALKIS), the outline of the
  detected vehicles, OpenStreetMap or a fallback shape. Each boundary has a
  confidence and review reasons and can be corrected by hand.
- Vehicles are counted with a YOLO model on aerial tiles.
- The hail score is based on GDV hail zones, a licensed provider or an
  Open-Meteo CAPE proxy. The app also estimates the expected annual loss and
  shows observed hail days from DWD.
- A dashboard with KPIs, charts, a location table and portfolio comparison.
- Optional AI memos and portfolio chat via Ollama, LM Studio, llama.cpp,
  OpenAI, Claude or a custom endpoint.
- Data stays in a local SQLite database. Export to PDF, Excel, CSV or a `.drm`
  portfolio file, which a colleague can open or merge into their own
  portfolio. The UI is available in German, English and French.

The results are screening estimates, not an engineering, legal or insurance
assessment. Sources and limitations are described in the
[risk model](./docs/risk-model.md).

## Sample data

The [German car dealership dataset](https://github.com/JanisKre/dealership_dataset)
contains 500 dealership locations from OpenStreetMap, with subsets of 250,
100, 50 and 10. The files import directly; for a first test use
[`car_dealerships_germany_10.csv`](https://github.com/JanisKre/dealership_dataset/raw/main/data/car_dealerships_germany_10.csv).
They contain no insurance terms such as insured value or deductible.
Data: OpenStreetMap contributors, ODbL 1.0.

## Development

Requires Node.js 22 or newer. Run from `desktop-app/`:

```bash
npm ci
npm run rebuild   # rebuild native modules for Electron
npm run dev
```

Other scripts: `typecheck`, `lint`, `test`, `test:coverage`, `build`,
`smoke`, `test:e2e`, `pack` and `dist`.

The vehicle detection model (`dealer_vehicles`, YOLO11s-OBB fine-tuned on
dealership orthophotos, about 39 MB, AGPL-3.0 weights) is not part of the
repository. Release installers bundle it from a pinned GitHub release; in a
development build the setup wizard downloads the same file and checks its
SHA-256. Without it the app estimates vehicle counts from the lot area. See
[docs/detection-benchmark.md](./docs/detection-benchmark.md#shipped-model-2026-11)
and [training/](./training/README.md) for how the model is trained.

The app is built with Electron, React, TypeScript, SQLite (better-sqlite3 and
Drizzle), Leaflet and onnxruntime-node. See [ARCHITECTURE.md](./ARCHITECTURE.md)
for the structure and the security model.

## Security

The renderer runs with context isolation and sandboxing and reaches the main
process only through typed IPC channels that are validated with Zod. API keys
are stored encrypted in the OS keychain. Network requests use the system proxy
and certificate store. To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## Code signing policy

Windows releases are being set up for signing with a certificate issued to the
SignPath Foundation. Until that is approved, Windows builds are unsigned. Free
code signing provided by [SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

- Only binaries built from this repository by the tag-driven
  [release workflow](./.github/workflows/release.yml) on GitHub-hosted runners
  are submitted for signing.
- The maintainer, [Janis Kretschmann](https://github.com/JanisKre), is
  committer, reviewer and approver. Signing requests are approved manually.
- Every account that can trigger or approve a signing request uses
  multi-factor authentication.
- Releases include SHA-256 checksums, a CycloneDX SBOM and build provenance
  attestations.
- macOS builds are not signed or notarized yet.

## Privacy

There is no telemetry and the maintainer receives no data. The app contacts
map, imagery, weather and AI services only for analyses you start. The local
database is not encrypted by the app, so keep full-disk encryption on. Details
in [PRIVACY.md](./PRIVACY.md).

## More documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [desktop-app/README.md](./desktop-app/README.md)
- [Accessibility](./docs/accessibility.md)
- [Support](./.github/SUPPORT.md)
- [Code of conduct](./CODE_OF_CONDUCT.md)

## License

[PolyForm Noncommercial 1.0.0](./LICENSE), Janis Kretschmann. You may use,
change and share the app for any noncommercial purpose, including research,
teaching and use by universities, charities and public institutions.
Commercial use requires a separate licence from the author.

Third-party components keep their own licences:

- npm dependencies: `npm run build` writes their licence texts to
  `desktop-app/out/licenses/THIRD_PARTY_NOTICES.txt`, and packaged builds ship
  them in `resources/licenses/`.
- Vehicle detection model: the weights are AGPL-3.0 and not part of this
  repository. The training data (VisDrone, DOTA, DLR 3K Munich) is released
  for research; check its terms before bundling the model or using it
  commercially. See [training/README.md](./training/README.md#licences).
- Data: OpenStreetMap (ODbL 1.0), Overture Maps (CDLA Permissive 2.0,
  Foursquare places Apache 2.0) and the state orthophoto services
  (dl-de/by-2-0, dl-de/zero-2-0, CC BY 4.0). The app shows the required
  attribution; see [imagery sources](./docs/imagery-sources.md) and
  [dealer directory](./docs/dealer-directory.md).
