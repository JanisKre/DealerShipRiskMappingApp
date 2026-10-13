# Aerial imagery sources and capture dates

Vehicle counts are only as current as the image they are counted on. This
note documents which imagery the app uses, how the capture date is
determined, and how a source is chosen per location.

Implementation: `desktop-app/src/shared/imagery-sources.ts` (registry and
decision rule), `desktop-app/src/main/services/imagery-source.service.ts`
(candidates), `desktop-app/src/main/services/tiles.service.ts` (capture).
Tests: `imagery-sources.test.ts`, `imagery-source.service.test.ts`,
`tiles.service.test.ts`.

## Sources

| Source | Resolution | Capture date from | Coverage |
| --- | --- | --- | --- |
| Esri World Imagery | 0.3–0.5 m satellite, 0.1–0.2 m where Esri uses state orthophotos | Esri metadata layer for the zoom level (`World_Imagery/MapServer` layers 5–18, `SRC_DATE`) | worldwide |
| State orthophotos (DOP) | 0.1–0.2 m | BKG flight index `sgx.geodatenzentrum.de/wms_info`, layer `dop` (`bildflug`) | 14 states with an open, keyless service |

Esri is a mosaic: the same point can show a different scene, from a different
date, at each zoom level. In October 2026, for example, Dresden showed a
February 2025 GeoEye-1 scene at z12–19 and a 2020 Saxon orthophoto at z20,
the zoom vehicle detection runs at. Dates are therefore always resolved for a
specific point *and* zoom.

Hamburg and Sachsen-Anhalt had no verified open orthophoto endpoint when this
was written, so they always use Esri. The nationwide BKG orthophoto service
(`wms_dop`) needs a licence and is not used.

## Decision rule (`selectImagery`)

1. Candidates are Esri at z20 (only where Esri publishes z20 metadata, since
   Esri otherwise serves "Map data not yet available" placeholders), Esri at
   z19, and the state orthophoto.
2. Only dated sources with a resolution of 0.5 m or finer compete.
3. Among sources at most 183 days older than the newest one, the sharpest
   wins. Equal resolution goes to the newer source.
4. If no source is dated, Esri is used and the selection reason is
   `no-dated-source`.

Vehicle detection applies a stricter limit: only sources of 0.25 m or finer
compete (`DETECTION_MAX_RESOLUTION_M`). The dealership detector is trained on
0.10–0.20 m state orthophotos; on 0.3–0.5 m satellite scenes cars stay small
and blurry after resampling and are under-counted. The trade-off is
deliberate: a sharper but older image wins over a newer coarse one, so the
count may describe an older stock picture (the capture date is always stored
with the result). If no source is sharp enough, Esri is still used, the
selection reason is `no-sharp-source`, and the detection result carries a
limitation that the count is likely too low. The same limitation is added
whenever the published resolution of the chosen source, or the tile zoom
after a fallback to a lower zoom, is coarser than 0.25 m.

The 183-day tolerance (`IMAGERY_TOLERANCE_DAYS`) prefers a 10–20 cm
orthophoto from spring over a 30–50 cm satellite scene from summer, but not
over one from a later year. The map uses the same rule at the current map
zoom (from z15; below that, Esri's overview mosaic). Detection captures at
the chosen candidate's zoom, so it never mixes Esri's z19 and z20 scenes.

The settings offer "Automatic" (default), "Esri World Imagery" (Esri only;
still picks the newer of Esri z19/z20) and a custom WMS/XYZ template, which
now also accepts `{bbox-epsg-3857}` for plain WMS GetMap URLs.

## Provenance

Every detection stores the full selection (`DetectionResult.imagery`): the
chosen source, capture date and date source, resolution, zoom, attribution,
selection reason and every alternative considered. A one-line summary is
added to `evidence.limitations`, so reports and memos carry the capture date.
Analyses from before this change have no record. The detail dialog says so
and recommends re-analysing.

## Limitations

- The BKG date is the flight date of the version delivered to the BKG. A
  state service can serve a newer or an older flight. In spot checks in
  October 2026, the states' own info layers matched exactly for NW, MV, RP,
  SL and TH, and differed by about three weeks for SN. Services pinned to one
  flight year (Berlin `truedop_2024`, Bremen `dop10_2025_HB`) have a
  `vintageYear`. When BKG reports another year, the date is withheld and the
  candidate cannot win.
- Near state borders, a capture can extend past the coverage of the chosen
  state service. The selection is made for the centre of the capture.
- Mecklenburg-Vorpommern stamps a copyright mark into its tiles.
- Even the newest open source is usually 1–3 years old for orthophotos and
  months old for satellite scenes. This is a screening estimate, not a
  current stock count. Weeks-old imagery needs commercial tasking.
- State services are third-party endpoints. Their URLs, layers and licences
  were verified in October 2026 and can change.

## Imagery history (Esri World Imagery Wayback)

Esri archives every published version of World Imagery (about 200 since
February 2014, keyless). The app lists the versions in which the image at a
location actually changed, so an older and sometimes sharper image can be
viewed on the map. These versions do **not** change the automatic selection
or the risk model: `selectImagery` never sees Wayback candidates.

Implementation: `desktop-app/src/shared/imagery-wayback.ts` (URLs, parsing),
`desktop-app/src/main/services/wayback.service.ts` (lookup), IPC
`imagery:timeline`. Tests: `imagery-wayback.test.ts`,
`wayback.service.test.ts`.

- **Versions**: `waybackconfig.json` (release number, publication date,
  metadata service per version), cached for 24 hours.
- **Local changes**: the tilemap service
  (`World_Imagery/MapServer/tilemap/{release}/{z}/{y}/{x}`) names the release
  that holds the tile a version shows. The lookup starts at the newest
  version and continues just below each holder, so there is one request per
  change rather than one per version. It stops after 8 changes and flags
  the timeline as truncated. Where the newest version has no imagery at the
  requested zoom (z20 is missing in large parts of Germany), it drops one
  zoom level once.
- **Capture date**: the holder's own metadata service, queried like the
  live one (`SRC_DATE`, `SRC_RES`, `NICE_NAME`). Wayback metadata services
  number their layers 0–13 (1.9 cm to 150 m) instead of the live service's
  5–18, so the layer is `clamp(23 − zoom, 0, 13)`. Versions that show the same
  scene (same date, collection and resolution) are listed once.
- **Display**: a pinned version replaces the satellite basemap until the
  user returns to "Automatic". It is not persisted across restarts. The
  legend shows the capture date of the pinned version's image at the map
  centre: the newest listed change that is not newer than the pinned
  version.
- **Security**: tile, tilemap and metadata URLs are built from constants
  and validated integers. Metadata URLs from the configuration are only
  used on `https://metadata.maptiles.arcgis.com/arcgis/rest/services/<name>/MapServer`.

Limitations: Wayback holds Esri's mosaic only. State orthophotos are not
included unless Esri itself used them. Early versions (2014) have no
metadata service, so their dates are unknown. Most German locations show
a handful of distinct images, at intervals of one to several years.
Licence and attribution are the same as for Esri World Imagery.

## Licences and attribution

Each registry entry carries the attribution required by the provider, with the
retrieval year inserted at runtime. The attribution is shown in the map and
in the legend. Every state service is under dl-de/by-2-0, dl-de/zero-2-0 or
CC BY 4.0, as stated in the provider's metadata (see `STATE_DOP_SERVICES`).
