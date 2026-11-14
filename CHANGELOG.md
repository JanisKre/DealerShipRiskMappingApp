# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Installers ship the fine-tuned vehicle model.** Release builds bundle
  `dealer_vehicles` 2026-10-10 from a pinned model release, and the setup
  wizard downloads the same files, both checked by SHA-256. Before, the
  wizard pointed at a model file no release contained, so new installs
  counted vehicles from the lot area only
  (`docs/detection-benchmark.md`, "Shipped model").
- **Training studio** (`training/studio.py`): the detector pipeline in one
  local browser page, with progress, review links, training curves,
  threshold sweeps, export, install and the release pin.
- `npm run benchmark:detection` sweeps a model's base confidence through the
  app's own inference on the training validation tiles.

- **Hail EAL as a range over the stock.** Where the stock was counted on
  archived images, the hail EAL detail shows the EAL at the lowest, median
  and highest count, says when the analysed image shows an unusually full or
  empty day, and the hail EAL tile adds the portfolio range. The point EAL
  is unchanged. "Stock over time" on the dashboard counts the 20 locations
  with the highest EAL in one run. The range also goes into the location
  report and the Excel/CSV export (`docs/risk-model.md`, "Stock range").
- **Radar hail cells (DWD KONRAD3D).** The detail dialog lists the days on
  which a hail cell tracked by the DWD radar passed within 1 km of the
  location, with class, time and reflectivity. DWD keeps only 48 hours, so
  the app builds a local archive from the first use on. Context only, not
  part of the EAL (`docs/risk-model.md`, "Radar hail cells").
- **Boundary cascade v10** (`docs/boundary-model.md`, "Cascade v10"):
  parcels in all 16 states (Saarland's service had moved); addresses in
  Schleswig-Holstein, Mecklenburg-Vorpommern and Baden-Württemberg, land use
  in Mecklenburg-Vorpommern and Baden-Württemberg; a dense car lot (or a plot
  with the dealership's address) directly across a street joins as a second
  part and is flagged for review.
- **Correct a boundary without leaving the review run.** "Correct
  boundary" in the review strip opens the map editor; when the edit is done,
  the map offers to resume the review at that location.

- Lot boundaries use three more sources (boundary cascade v9,
  `docs/boundary-model.md`, "Cascade v9"):
  - the **address and land use the cadastre publishes with each parcel**
    (nine and seven states). Parcels with the address of the parcel at the
    point, or of the dealership, join the lot even without cars on them;
    roads are recognised by their registered use instead of their shape;
    housing and farmland join only when full of vehicles. A point that the
    geocoder put on the road or on a parcel with another house number moves
    to the parcel with the dealership's address.
  - **vegetation on the aerial image**: a parcel that is a meadow or a wood
    on the image does not join, and planted fringes without vehicles are
    trimmed off the result.
  - **parcels for Bayern**, read from the open parcel map of the Bayerische
    Vermessungsverwaltung (CC BY 4.0), so Bayern gets parcel-based
    boundaries instead of the vehicle outline.
- AI dashboards can be rearranged by drag and drop, like the tiles of the
  overview: a card or a whole row is picked up at the handle that appears on
  hover. Within a row, cards change places; a card dropped on a row of its
  kind (key figures with key figures, charts and tables with charts and
  tables) joins it, also between its cards; a card dragged out of a row gets
  a row of its own and can be dragged back. The new order is saved with the
  dashboard. A drop that would break the layout rules (a fifth card in a row,
  a row inside a row) is refused with a notice.
- Detector training: confirm instead of draw. `training/autolabel.py`
  labels each tile 8× with your own model and sorts boxes into sure /
  check / candidate; `training/review.py` is a local keyboard review page
  (J/N per question, one click per missed vehicle) that writes the same
  X-AnyLabeling JSON as before. Also: Claude Code as second reviewer
  (`claude_review.py`, measured against your labels), an audit of finished
  sites, pseudo-labels for train only with a stable validation split,
  corrections harvested from the app's map review, and an error report by
  vehicle type (`training/README.md`, "Confirm instead of draw").

- A vehicle model can carry its own calibrated base confidence
  (`defaultConfidence` in the manifest, `training/export.py --default-conf`).
  The app uses it while the detection-confidence parameter is still the
  default; a value set by the user always wins. For the fine-tuned
  dealership model, 0.45 instead of 0.22 lowers the count error on 11
  held-out sites from 18.5 to 8.5 vehicles per site and the bias from
  +12.5 % to +0.9 % (`docs/detection-benchmark.md`, "Model default
  threshold").

- Building footprints for Bayern from the open LoD2 building model of the
  Bayerische Vermessungsverwaltung (CC BY 4.0), read by 2 km tile and cached
  per tile. Bayern has no open building WFS; until now the roof mask and the
  vehicle outline had no footprints there, so outlines left the showroom
  out. A large city tile may arrive too late for the first analysis of a
  site and then helps from the next one (`docs/official-buildings.md`).
- Fewer review flags on correct boundaries: full confidence from 70 % lot
  coverage (was 80 %), "vehicles outside" from 25 % of the lot (was 15 %).
  On 76 sites judged by eye, flagged correct results fell from 25 to 13 of
  49, flagged flawed ones from 24 to 23 of 27 (`docs/boundary-model.md`,
  "Review calibration").
- Traffic areas for Bayern from the free ALKIS land-use map (WMS, CC BY 4.0):
  where no parcels exist, vehicle outlines are cut back at roads instead of
  running across them.

### Changed

- Lot boundary, cascade v8 (`docs/boundary-model.md`, "Cascade v8"): parcel
  results keep the whole car park and no longer have pieces cut out. Small
  adjacent plots join with five or more densely parked cars (was ten), a
  narrow plot full of cars (a parking strip or forecourt corner) joins
  without the lot growing on from it, plots the lot encloses on three sides
  join, and holes are filled. On 88 sites checked live, 24 results grow
  (for example 538 → 1,143 m² and 2,185 → 4,980 m² where half the
  forecourt was missing); a manually corrected site moves from 0.72 to
  0.86 IoU against the correction; the public fixtures from 0.509 to
  0.512. Existing boundaries change on re-analysis only.
- Lot boundary, cascade v4 (`docs/boundary-model.md`, "Cascade v4"): a
  dealership standing across field strips is outlined from its vehicles
  instead of returning one strip running into the field; a point that lies
  beside the vehicle lot is flagged ("the point lies beside the vehicle lot")
  with the lot's parcels offered as an alternative; imagery four or more
  years old sends the boundary to review.
- Fallback boundary: the octagon around the point now has a 160 m corner
  radius instead of 100 m. Calibrated on the 17 public boundary fixtures so it
  holds the whole lot on 16 of 17 (100 m: 6 of 17); a test recomputes the
  calibration (`docs/boundary-model.md`, "Fallback circle"). The larger shape
  also covers neighbouring lots, so vehicle count and capacity of a fallback
  location stay unreliable until the boundary is corrected. Sessions with the
  old default move to 160 m; a deliberately set radius is kept. Existing
  boundaries change on re-analysis only.
- Fallback boundaries are drawn dashed, and their label reads "Fallback
  boundary, review or edit for accurate detection" (map popup, tooltip in the
  location list). After an analysis the review hint names how many of the
  boundaries to check are fallbacks and filters the map to them on request.
- Boundary edits survive closing the app: the undo steps (up to 20 per
  location) and an edit not yet saved with "Save & update car detection" are
  stored with the portfolio, so Undo and the edit banner come back. Ctrl+Z
  (⌘Z on a Mac) undoes the last boundary change. A saved edit is no longer
  stored as still open.
- Documentation brought in line with the app: website pages for updates,
  hail history, AI dashboards, the import preview and the boundary review;
  the privacy table now lists the DWD hail history and the Overture dealer
  directory; README, ARCHITECTURE.md and desktop-app/README.md no longer
  describe the removed fusion engine, Overture CLI, executive summary,
  Gemini, Sentry or Husky.
- Lot boundary, cascade v3 (`docs/boundary-model.md`, "Cascade v3"):
  complete cadastre answers (WFS paging, smaller fallback query), a street
  test that keeps L-shaped and deep yards, no more empty meadows joined at
  the edge of a lot, a lower join threshold for small dealers, anchor reach
  from the showroom edge, a bounded continuation of large lots beyond 80 m
  (larger jumps offered as an alternative), a wider image when the lot
  reaches its edge, vehicle outlines that include the showroom and stop at
  the road, parking decks kept in the roof mask, and a bounded wait for
  official building footprints. On the 15 audited sites the mean IoU of the
  public fixtures rose from 0.37 to 0.54 (same sites the rules were designed
  on; not an independent result). Existing results keep their version until
  re-analysed.
- Boundary review names its reasons (low confidence, row of vehicles
  outside, incomplete cadastre, no lot at the point, winter imagery, …) in
  the location dialog. Vehicles outside count only as a real share of the
  lot, and not when parked on the street.
- `npm run benchmark:boundary` uses the app's imagery setting (`auto`)
  instead of Esri and applies the roof mask; `BOUNDARY_BENCHMARK_IMAGERY=esri`
  restores the old setting. New `npm run benchmark:boundary:replay` replays
  frozen inputs offline.

### Added

- Sample data: the docs (Import format → Sample datasets), the quick start
  and the READMEs link the
  [German car dealership dataset](https://github.com/JanisKre/dealership_dataset)
  with 10, 50, 100, 250 and 500 real dealership locations from OpenStreetMap
  (ODbL 1.0) as CSV and Excel. The files import without changes. In the
  app, the empty location list links to them (opens in the browser).
- App updates: packaged builds check this repository's GitHub releases at
  start-up and once a day. Windows downloads the update in the background
  and installs it on restart; unsigned macOS builds link to the release page.
  The check can be switched off under Settings → General → App & support.
- Support tools under Settings → General → App & support: a rotating log
  file (`userData/logs/main.log`, secrets masked), "Export diagnostics"
  (versions, settings without API keys, record counts, recent log; no
  portfolios) and "Delete all data" (everything except the downloaded
  detection model; the app restarts).
- Accessibility checks: `eslint-plugin-jsx-a11y` in the lint step and an
  axe-core end-to-end test of every page in light and dark theme against
  WCAG 2.2 AA. See `docs/accessibility.md`.
- OpenSSF Scorecard workflow; CodeQL (TypeScript, Python, workflows) runs
  through GitHub's default code-scanning setup.
- Property-based tests (`fast-check`) for the ZIP, XLSX and CSV import
  parsers.

- Parcel overlay (layer panel → Basemap → "Parcels (ALKIS)"): official
  Flurstück outlines from the open map services of 15 states (all except
  Saarland), from zoom 17, over any basemap: as published (mostly yellow)
  on Satellite, in one red on Streets and Terrain. Display only; see
  `docs/cadastre-overlay.md`.
- "Official map (basemap.de)" basemap: the official German topographic map
  of the BKG and the states, built from the same cadastre as the parcel
  overlay. Germany only.
- Roof mask with official building footprints (ALKIS) from 13 states, in
  addition to OSM. Car parks are recognised by their cadastral function and
  never masked. See `docs/official-buildings.md`.
- Official house coordinates for address-only records in 8 states: an exact
  match of street, number and postcode replaces Nominatim's point, which
  often lies on the street. The boundary's provenance names the source.

### Changed

- Interface wording: one term per concept in German (Standort, Exposure,
  Kumulation, Luftbild/Bildstand, Grundstücksgrenze, "Geschätzte Grenze
  (Kreis)" for the circle fallback, Fahrzeugerkennung/Erkennungsmodell for
  the vehicle detector vs. KI-Assistent/KI-Anbieter for the LLM), "du"
  throughout, and real singular/plural forms instead of "Standort(e)". The
  French interface is complete (about 300 missing texts, "Réglages" for the
  app settings next to "Paramètres"); a test keeps de, en and fr on the same
  keys and placeholders, and the offline chat and dashboard commands also
  understand French.
- Dependencies: 42 minor/patch updates for the desktop app (React 19.3,
  Radix, Tailwind 4.3, onnxruntime-node 1.31, Vitest 5.1, Prettier 3.9, …);
  `@types/node` 24 to match Electron's Node; the website on TypeScript 7,
  Vite 8 and `@vitejs/plugin-react` 6; GitHub Actions on checkout v7,
  setup-node v7, upload-artifact v7 and attest-build-provenance v4.
- Dependabot runs monthly with a cooldown and grouped PRs (at most two per
  ecosystem, npm for app and website together).
- Desktop app major updates: Recharts 3 (bar clicks are handled on the bars,
  whose whole row or column stays clickable), TanStack Table 9 (explicit sorting, search and
  pagination features), i18next 26 / react-i18next 17, lucide-react 1,
  Vite 8 with electron-vite 6 and `@vitejs/plugin-react` 6, TypeScript 6,
  ESLint 10 (errors now keep their `cause`). Prettier formatting is checked
  in CI (`npm run format:check`).
- Network requests from the main process and the dealer-directory worker
  use Electron's `net.fetch` instead of Node's fetch: the system proxy and the
  operating system's certificate store (company TLS inspection) now apply.
  Only HTTP(S) URLs are fetched.
- Packaged builds set Electron fuses (no `RunAsNode`, `NODE_OPTIONS` or
  `--inspect`; ASAR integrity validation; app code only from `app.asar`).
- The release workflow runs the end-to-end tests before packaging.
- Accessibility: `<html lang>` follows the interface language; "reduce
  motion" stops animations and map zoom effects; analysis progress, update
  status and chat answers are announced to screen readers; charts are
  keyboard-navigable; muted and success text colours meet 4.5:1 contrast;
  the hazard source select has a label; the dashboard tile toolbar is
  reachable with Tab.

- AI chat answers are short and stick to the question: lead with the
  answer, about 120 words at most unless more detail is asked for, no
  unasked summaries or recommendations, and a hard cap of 1,024 tokens.
  The chat now also knows each location's status, hail zone, vehicle count
  with its source and image date, exposure, EAL, review flag, the largest
  accumulation clusters and which location is selected on the map.
  Underwriting notes are still never sent.
- AI answers render Markdown fully: bold, italic, strikethrough, inline code,
  numbered and nested lists, tables, quotes and code blocks. Previously
  `**bold**` showed its asterisks. Links show their text, with the address
  as tooltip.
- Licence: the project is licensed under PolyForm Noncommercial 1.0.0. Use,
  study, changes and sharing are free for any noncommercial purpose (personal
  use, research, teaching, charities, public institutions); commercial use
  needs a separate licence from the author. Contributions are accepted under
  the terms in CONTRIBUTING.md.

### Fixed

- **Address search when Photon is unreachable.** When Photon (the online
  geocoder) refuses the connection, times out or rate-limits, the search now
  answers from the local dealer directory and the portfolios and says that
  online results are missing, instead of failing with "check your internet
  connection". Photon is asked less often: answers are cached, type-ahead
  requests are not retried, and Photon is paused for a few minutes after a
  failure (`docs/location-search.md`).
- Hailstorm scenario: the map drew the corridor in screen pixels, so its
  width changed with the zoom level and did not match the counted sites. It
  is now a geographic buffer of the set width, measured like the affected
  count.
- A website from the import file was labelled "manuell hinterlegt". It now
  reads "aus der Importdatei" and, like a typed link, is never replaced by
  the automatic lookup.
- The area figure of the fallback detector (no detection model installed)
  was called "Maschinell erkannte Fahrzeuge" and "Fahrzeugzahl aus der
  Luftbild-Erkennung". It now reads "aus der Grundstücksfläche geschätzt
  (keine Fahrzeugerkennung)", and the dashboard marks such values with "≈"
  (`docs/risk-model.md`, "Vehicle count provenance").
- UI/UX audit of all tabs: boundary editing no longer freezes with the
  hail-zone layer on; collapsed docks can be reopened; boundary review
  follows the filter; an import into the empty portfolio keeps its name and
  is saved at once; parameter fields read German numbers ("30.000"); the
  detection model can be installed from Einstellungen; checked boxes are
  visible in dark mode; icon buttons have tooltips; one page-header pattern,
  warning colours from theme tokens, numbers formatted in the UI language.
- Resuming an analysis after a restart: the inputs still to analyse were
  not written to the saved portfolio, so locations of a cut-short import
  that had not started yet were lost on closing the app. They are now
  stored with the session and offered for resuming again.
- Dashboard → Export → PDF report always failed with "autoTable is not a
  function": the bundled main process called the `jspdf-autotable` module
  object instead of its function. All five export types (PDF, Excel, CSV,
  read-only view, portfolio file) are now covered by a test.

### Removed

- The executive summary at the top of the AI chat panel. The chat now opens
  empty and answers only what is asked. Its now unused code (summary stream,
  prompt, the unrouted start page and conversation sidebar) is gone too.
- The "Light" and "Dark" basemaps. Satellite, Streets and Terrain remain; a
  saved light or dark choice opens as Streets.

## [0.4.0] – 2026-11-11

### Added

- Change history per location (detail dialog → Sources): analyses, confirmed
  and changed boundaries, manual and reviewed vehicle counts and changes of
  business type, with time and values. Kept with the portfolio, last 50
  entries.
- Optional own Overpass server (Settings → OpenStreetMap data), asked first
  with the public servers as fallback. With one, analyses wait up to 3 s for
  OSM so roof masking, website lookup and OSM dealer areas work every time.
  See `docs/local-overpass.md`.
- Cadastral parcels for Hamburg, Bremen, Mecklenburg-Vorpommern, Thüringen
  and Rheinland-Pfalz (14 of 16 states). Bayern and Saarland have no open
  service yet.

### Fixed

- Import: a row that could not be analysed (for example an address that
  cannot be found) is now named in the error notice instead of showing an
  internal ID, and "Retry" analyses it again. Before, retry did nothing for
  rows that never reached the map. When every row fails, the notice now also
  shows on the empty map.

### Security

- Website: updated vite to 7.3.7 for the `launch-editor` file-existence check
  bypass on Windows (development server only).
- Desktop app: updated vitest and @vitest/coverage-v8 to 5.0.5 (mock
  registration code injection and redirect allowlist bypass), and overrode
  minimatch to 11.0.5 for typescript-eslint, electron-builder and
  @electron/universal (globparts denial of service). `npm audit` reports no
  vulnerabilities. All are development or build-time dependencies.

### Changed

- Map legend: boundary sources are split into "Manually adjusted" (green;
  every boundary someone edited on the map, whatever its source was) and
  "Automatic, by source" (cadastre, vehicle outline, OSM, estimated circle).
- Map legend: hail zones, business types, boundary sources and vehicles that
  no location in the current map view uses are greyed out. Zoomed in on one
  location, only its entries stay active; zoomed out, those of every location
  in view. With the hail-zone layer on, all zones stay active.
- The vehicle model loads in the background at app start, so the first
  analysis does not wait for it.
- Vehicle detection runs on two inference processes on machines with four or
  more cores, each with half of the cores.
- During a batch analysis the next location's aerial tiles load into the
  cache while the current one is analysed.
- Lot boundaries now follow the detected vehicles (source cascade v2). The
  boundary is the cadastral parcel at the location plus every adjacent parcel
  on which at least ten detected vehicles stand. Where there is no cadastre,
  it is the outline of the vehicle lot. A cached OSM dealer area and the bare
  parcel are only used when no vehicles were seen. On the 17-site benchmark
  the mean overlap with the reference rose from 0.298 to 0.446. The limits
  were chosen on these same sites, so the gain still needs confirming on new
  ones. See "Source cascade" in `docs/boundary-model.md`.
- The analysis no longer waits for OpenStreetMap at all and uses it only when
  it is already cached. The boundary now waits for vehicle detection again.
- The context image for vehicle detection now covers 125 m around the
  location instead of 100 m, so large dealer centres fit.
- The boundary benchmark runs vehicle detection in-process with the installed
  model and no longer queries Overpass.
- An analysis no longer waits minutes for an overloaded Overpass. The roof
  mask, the boundary and the website lookup share one OSM request, which runs
  in the background for at most 60 s and is cached for the next analysis.
- The website lookup and the NatCat lookup run in parallel with imagery,
  detection and the boundary.
- The website comes from the boundary's OSM data instead of a separate
  Overpass query. It now searches 300 m around the site instead of 500 m.
- Each analysis logs its total time and the time of every step.
- Map notices share one layout with a concrete action each. Boundaries to
  check are walked through one by one ("Yes, confirm", "Correct", "Next").
  Editing shows its own notice with "Done", failed analyses offer "Try
  again", and the missing-model notice links to the settings.
- "Edit boundaries" and "Correct" open the layer panel at the boundaries
  section instead of leaving the editing controls hidden.
- The imagery version select is never disabled or replaced by a
  placeholder while archive versions load. It matches the basemap select and
  shows the drawn image's date and source below it. The counted image stays
  on while the selected site is within about one and a half viewports.
- The legend names boundary sources like the detail dialog, highlights the
  ones on the map, and lists retired sources only when such a boundary is
  shown.
- Map section made consistent after a full walk-through: layer-panel section
  titles in sentence case without wrapping, one style for every select and
  input, disabled actions explain why, marker popup buttons match the app's
  buttons, disclosure rows use the same chevron everywhere, all top notices
  share one layout and keep clear of the zoom control, and the locations
  header wraps its actions instead of clipping them.
- Deleting a location from the marker's context menu now asks for
  confirmation, like deleting from the list.
- The detail dialog's OpenStreetMap lookup gives up after 15 s instead of
  showing "loading" for minutes while Overpass is overloaded.
- Location detail dialog rebuilt for progressive disclosure: name, badges,
  four key figures (hail EAL with portfolio rank, vehicles, exposure,
  boundary status) and only actionable notices on top; overview, site,
  contract and sources tabs below. Boundaries can be confirmed, edited on
  the map or swapped for another computed candidate from the dialog,
  previous/next arrows step through the portfolio, and notes save
  automatically. Duplicate figures, positive "system messages" and the
  empty hail-source block are gone; candidate labels are translated.
- Taking another boundary suggestion now asks first (area and confidence of
  both, with a warning when it is less certain), offers "Undo" afterwards,
  and records that it was chosen manually. "Original boundary" restores the
  automatic result and recounts the vehicles. The vehicle outline is no
  longer offered next to parcels that already hold most of the vehicles,
  and a reviewer's earlier choice no longer replaces the original as the
  restore target.

### Removed

- The fusion engine, the legacy candidate ranking and their sources (Nominatim
  polygons, the Overture CLI adapter, the aerial paved-surface heuristic),
  together with `@turf/centroid`, `@turf/distance` and `@turf/intersect`.

## [0.3.0] – 2026-11-10

### Security

- Updated Electron to 44.10.2 and zod to 4.6.7, and refreshed transitive
  dependencies (dompurify, undici, vite) to clear the critical and high
  `npm audit` findings that blocked the release. zod 4 treats enum-keyed
  records as exhaustive, so the NatCat connector map now uses
  `z.partialRecord` to keep loading settings with only some providers
  configured.

### Changed

- Lot boundaries are now found by a source cascade instead of the
  multi-source fusion engine. The sources are asked in a fixed order: OSM
  car-dealer area at the point, the ALKIS parcel containing the point, OSM
  parking at the point, the aerial paved surface, and finally a 100 m circle.
  The first source whose rule matches wins. Nothing is blended or enlarged
  automatically; geometries from later sources are offered as alternatives
  in the candidate list. Only an OSM dealer area at the point passes without
  review. The detail dialog shows "Engine: Quellen-Kaskade" and one line per
  consulted source explaining why it was or was not used. Saved boundaries
  are kept; re-analyse a location to get a cascade result. See "Source
  cascade" in `docs/boundary-model.md`.

### Added

- Smarter location search. Queries are understood offline: "Müller" finds
  "Mueller", "VW" finds "Volkswagen", typos like "Autohaus Mueler" still
  match, a city or postcode at the end ("Autohaus Müller Dresden") focuses
  the search on that area, and kind words ("Motorradhändler", "Wohnmobil",
  "LKW", "Gebrauchtwagen") pick the matching Overture dealers. OSM and
  Overture hits are now ranked by one explainable score instead of source
  order, and a place both sources know is tagged "OSM + Overture". A
  suggestion that already is a saved portfolio location shows "In portfolio"
  with the start of its note and ranks higher. The app checks once a day
  whether Overture published a newer dealer release and says so in Settings
  and under the search results. See `docs/location-search.md`.

- Project homepage in `website/` (Vite, React, Tailwind CSS 4, shadcn/ui)
  with an overview and the download options, plus a user guide split into
  one page per topic under `/docs/` (old `/docs/#topic` links redirect). The
  site is available in English, German and French; a language switcher sits
  in the header, the first visit follows the browser language and the choice
  is remembered. The `Pages` workflow builds it on every change and deploys it
  to GitHub Pages from `main`.

### Removed

- All perils except hail (risk model `screening-0.5.0`): storm, lightning,
  snow, flood and heat are no longer scored, shown, exported or sent to the
  AI assistant. Removed with them: their score caps on the parameters page,
  the per-peril map overlays (replaced by a single "Hail score" layer), the
  extra scores in the location details, the hazard-coverage dashboard widget,
  the ZÜRS Geo import (flood and heavy-rain classes, incl. its IPC channels)
  and the flood providers JBA, Fathom and JRC. The NatCat settings now choose
  one hail source instead of a source per peril; providers are asked for
  `hail` only. Open-Meteo is queried for CAPE only. Saved portfolios and
  settings still load: values of removed perils and providers are dropped,
  and older results are offered for recalculation.

### Fixed

- Licences: replaced `react-leaflet` (Hippocratic-2.1, which adds use
  restrictions that conflict with the project's licence) with small in-house React
  bindings for Leaflet (`components/map/leaflet-react.tsx`) that keep the same
  component API. Corrected the orthophoto licences for Thüringen
  (dl-de/by-2-0), Mecklenburg-Vorpommern (CC BY 4.0), Hessen (dl-de/zero-2-0),
  Saarland (dl-de/by-2-0) and Bremen (CC BY 4.0) in the app's attribution and
  in `training/fetch_tiles.py`, as stated in the providers' metadata.
- Packaged builds now include `LICENSE` and a generated
  `THIRD_PARTY_NOTICES.txt` with the licence texts of all production
  dependencies (`resources/licenses/`).

### Added

- Lot boundaries (fusion engine v4): vehicles detected on the context image
  are now evidence for the boundary itself. Detection runs before the
  boundary instead of after it; parked-car clusters next to a partly mapped
  forecourt extend the lot. Vehicle evidence alone never confirms a site, is
  damped outside the site's cadastral parcels and ignored on another
  business's premises. Weighted by `boundaryVehicleEvidenceWeight` (0 turns
  it off). See `docs/boundary-model.md`.
- Address-only records are geocoded by scoring Nominatim hits (postcode,
  house number, dealership name, vehicle-trade POI) instead of taking the
  first hit; an additional name-and-address query finds the dealership POI.
  Distant hits that score alike are flagged for boundary review.
- Hail-focused dashboard, based on underwriter feedback: KPI row (locations,
  vehicles parked in the open, exposure, hail EAL, largest accumulation,
  locations in hail zone ≥ 4), a "Largest accumulations" list whose rows
  expand into their locations and open on the map, a hail-zone distribution,
  top locations by hail EAL, and rule-based "Review notes" that show the rule
  behind every note. Every tile has an ⓘ explanation of what it shows, how it
  is calculated, and its limits.
- Dashboard banner to recalculate locations scored with an older risk model.

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

- **Risk model `screening-0.4.0`: hail-only EAL** —
  `EAL = N × λ_z × (p_S·S_S + p_M·S_M + p_L·S_L)` with the vehicles parked in
  the open (N), damaging hail events per year by hail zone (λ_z), and the
  share (p) and per-vehicle loss (S) of small, medium, and large events. The
  defaults are uncalibrated placeholders and editable under Parameters → Hail
  EAL. Wind, flood, lightning, snow, and heat no longer contribute to the EAL;
  their scores remain in the detail view. Methodology: `docs/risk-model.md`.
- The critical review note now fires from hail zone 5 (`alertHailZone`)
  instead of a 0–100 score of 75.
- German is the default language for new installations; the dashboard no
  longer mixes German and English.

### Removed

- Dashboard tiles for the PML, peril coverage and concentration, the seasonal
  risk profile, the risk-level donut, "extreme risks", and the statistical
  outlier list (z-scores). The PML is still available to the AI assistant.

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

[Unreleased]: https://github.com/JanisKre/DealerShipRiskMappingApp/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/JanisKre/DealerShipRiskMappingApp/releases/tag/v0.4.0
[0.3.0]: https://github.com/JanisKre/DealerShipRiskMappingApp/releases/tag/v0.3.0
[0.2.1]: https://github.com/JanisKre/DealerShipRiskMappingApp/releases/tag/v0.2.1
[0.2.0]: https://github.com/JanisKre/DealerShipRiskMappingApp/releases/tag/v0.2.0
[0.1.0]: https://github.com/JanisKre/DealerShipRiskMappingApp/releases/tag/v0.1.0
