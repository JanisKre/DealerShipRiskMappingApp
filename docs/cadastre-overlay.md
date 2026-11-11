# Cadastral parcel overlay (Flurstücke)

The map can draw official parcel (Flurstück) outlines over any basemap
(layer panel → Basemap → "Parcels (ALKIS)"). Insurer tools such as ZÜRS Geo
show the same kind of layer, but they license ALKIS data. There is no open
nationwide parcel map, so the app combines the open map services (WMS) of
the individual states.

Implementation: `desktop-app/src/shared/cadastre-sources.ts` (registry,
tile template, view filter) and
`desktop-app/src/renderer/src/components/map/CadastreLayer.tsx` (map
layer). Tests: `cadastre-sources.test.ts`, `mapStore.test.ts`.

## Sources (verified 11 November 2026)

Each service was checked live: GetCapabilities lists the layer with
EPSG:3857, and a 256 px GetMap tile over a city centre returned transparent
PNG parcel outlines at zoom 17 and 18.

| State | Service | Layer (style) | Licence |
| --- | --- | --- | --- |
| BW | LGL `WMS_LGL-BW_ALKIS_Basis_transparent` | `nora:ALKIS_Basis_transparent` | dl-de/by-2-0 |
| BY | LDBV `od/wms/alkis/v1/parzellarkarte` | `by_alkis_parzellarkarte_umr_gelb` | CC BY 4.0 |
| BE | `gdi.berlin.de/services/wms/alkis_flurstuecke` | `flurstuecke` | dl-de/zero-2-0 |
| BB | `isk.geobasis-bb.de/ows/alkis_wms` | `adv_alkis_flurstuecke` (Gelb) | dl-de/by-2-0 |
| HB | LGLN `alkishb_wms` | `ALKIS` (Gelb, outlines only) | CC BY 4.0 |
| HH | `HH_WMS_INSPIRE_Flurstuecke` | `CP.CadastralParcel` | dl-de/by-2-0 |
| HE | INSPIRE Hessen CP view service | `CP.CadastralParcel` | dl-de/zero-2-0 |
| MV | `geodaten-mv.de/dienste/alkis_wms` | `adv_alkis_flurstuecke` (Gelb) | CC BY 4.0 |
| NI | LGLN INSPIRE `alkis-vs-cp` | `CP.CadastralParcel` | CC BY 4.0 |
| NW | `wms.nrw.de/geobasis/wms_nw_alkis` | `adv_alkis_flurstuecke` (Gelb) | dl-de/zero-2-0 |
| RP | `geo5.service24.rlp.de/wms/liegenschaften_rp.fcgi` | `Flurstueck` | dl-de/by-2-0 |
| SN | GeoSN `wms_geosn_flurstuecke` | `Flurstueck,Flurstuecksnummer` (`…_gelb`) | dl-de/by-2-0 |
| ST | LVermGeo `ST_LVermGeo_ALKIS_WMS_AdV_konform_App` | `st_alkis_flurstuecke` (Gelb) | dl-de/by-2-0 |
| SH | `SH_INSPIREVIEW_AI_CP_ALKIS` | `CP.CadastralParcel` | CC BY 4.0 |
| TH | `geoproxy.geoportal-th.de/…/adv_alkis_wms_th` | `adv_alkis_flurstuecke` | CC BY 4.0 |

Saarland has no open parcel WMS (the probed endpoints answered 404 or 400),
so the overlay stays empty there.

Services that were tried and not used: the AdV-conformant WMS of
Schleswig-Holstein (`WMS_SH_ALKIS_OpenGBD`) and the `adv_alkis_flurstuecke`
layer of Saxony only draw below 1:2,000 (zoom 19+), and the full ALKIS maps of
Hessen (`he_alk`) and Lower Saxony (`alkis_wms`) cover the basemap with
land-use colours.

## Official basemap

The basemap "Official map (basemap.de)" is the basemap.de Web Raster of the
BKG and the state surveying offices (WMTS `de_basemapde_web_raster_farbe`,
Web Mercator, CC BY 4.0, "© GeoBasis-DE / BKG"). Its buildings come from the
same cadastre, so they line up with the parcel overlay (checked in Leaflet
over Dresden-Reick, 11 November 2026). It covers Germany only; elsewhere the
tiles are empty.

## How it is drawn

- Leaflet requests one WMS GetMap tile per 256 px map tile, with the bounding
  box in EPSG:3857 (the same `{bbox-epsg-3857}` template the state
  orthophotos use). Tiles load directly in the renderer like the basemap; the
  main process is not involved.
- Only services whose rough state box meets the current view are mounted, so
  the attribution lists just those, and Leaflet skips tiles outside each box.
  Boxes of neighbouring states overlap; each service only draws its own
  parcels, so both can be shown at once.
- The overlay starts at zoom 17 (about 1:4,000). The services stop drawing
  between 1:5,000 and 1:20,000, and at zoom 16 the parcel numbers of the
  services that still draw overlap.
- Each state is asked for its outline-only style (yellow where the service
  offers one). Several default styles draw grey lines with a white halo,
  which vanish on the light streets and terrain basemaps.
- Over the satellite basemap the tiles are shown as served. Over streets
  and terrain an SVG filter (`feFlood` + `feComposite in SourceAlpha`)
  paints every drawn pixel in one red (`CADASTRE_MAP_COLOR`, `#e11d48`):
  dark lines disappear in OpenTopoMap's black building hatching and yellow
  ones on OpenStreetMap's light colours, red stays readable on both, and all
  states look alike.

## Limitations

- Display only. The overlay does not feed the lot-boundary detection (that
  uses the ALKIS WFS, `alkis.service.ts`) or any risk figure.
- It is not a legal boundary record. The authoritative proof of a parcel is
  the certified extract from the cadastre office.
- Over aerial imagery, styles differ per state (line colour, labels,
  boundary points), because each state renders its own map.
- The services can be slow, down or change their URL without notice; then
  the overlay is simply empty for that state.
