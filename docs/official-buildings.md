# Official buildings and house coordinates (ALKIS)

Two analysis steps use the official cadastre (ALKIS) of the German states
where it is openly published, in addition to OpenStreetMap:

1. **Roof mask.** Vehicle detections whose centre lies on a building roof
   are removed (solar panels, roof vents and fixtures read as cars). The
   footprints came from OSM only; now the cadastre's footprints are added.
2. **Anchor.** An address-only record is geocoded with Nominatim. Where the
   state publishes house coordinates, an exact match of street, house number
   and postcode near Nominatim's point replaces it.

Both only refine existing steps. Neither changes the risk formula, and both
fall back silently to the previous behaviour when a service is missing,
slow or fails.

Implementation: `desktop-app/src/main/services/alkis-buildings.service.ts`,
`desktop-app/src/main/services/detection/roof-mask.ts`,
`desktop-app/src/main/services/house-coordinates.service.ts`,
`geocodeDealership` in `analyze.service.ts`. Tests:
`alkis-buildings.service.test.ts`, `roof-mask.test.ts`,
`house-coordinates.service.test.ts`, `analyze.service.test.ts`.

## Roof mask with official footprints

**Method.** At the start of an analysis the app asks the state's building
WFS for footprints within 190 m (the 250 m context image plus margin), in
parallel to imagery and detection. The roof mask then takes the union of the
OSM footprints and the official ones. Rules unchanged from the OSM mask: a
detection is removed only when it lies at least 2 m inside a footprint, and
car parks are never masked.

**Car parks.** The cadastre names them by function code (Gebäudefunktion):
2460 Gebäude zum Parken, 2461 Parkhaus, 2462 Parkdeck and 2465 Tiefgarage
are left out of the mask, as are structures recorded below ground (Lage zur
Erdoberfläche 1200). Garages (2463) and vehicle halls (2464) keep their cars
inside, so their roofs are masked. INSPIRE building services carry no
function, so there an official footprint overlapping an OSM car park
(`building=parking`, `parking=multi-storey|rooftop`) is left out too.

**Provenance.** The detection's method names the sources, for example
`roof mask (OSM buildings + ALKIS buildings NRW)`, and its limitations count
the removed detections.

**Waiting.** The analysis never waits for OSM (`OSM_WAIT_MS` 0) and uses the
same deadline for the cadastre. Because the request starts with the
analysis, it is usually in by the time the mask runs after detection; a
slower answer still fills the cache (30 days) for the next analysis.

| State | Service | Feature type | Function |
| --- | --- | --- | --- |
| NW | `wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht` | `ave:GebaeudeBauwerk` | yes |
| TH | `geoproxy.geoportal-th.de/…/adv_alkis_wfs` (UTM 32N box) | `ave:GebaeudeBauwerk` | yes |
| RP | `geo5.service24.rlp.de/wfs/alkis_rp.fcgi` | `ave:GebaeudeBauwerk` | yes |
| NI | LGLN `alkis_wfs_sf` | `adv:AX_Gebaeude` | yes |
| HB | LGLN `alkishb_wfs_sf` | `adv:AX_Gebaeude` | yes |
| HE | `gds.hessen.de/wfs2/aaa-suite/cgi-bin/alkis/nas/wfs` | `adv:AX_Gebaeude` | yes |
| BE | `gdi.berlin.de/services/wfs/alkis_gebaeude` | `alkis_gebaeude:gebaeude` | partly |
| SN | INSPIRE `alkis/bu-core2d/dls/wfs` | `bu-core2d:Building` | no |
| MV | INSPIRE `inspire_bu_core2d_alkis_download` | `bu-core2d:Building` | no |
| SH | INSPIRE `SH_INSPIREDOWNLOAD_AIII_BU` | `bu-core2d:Building` | no |
| ST | INSPIRE `ows_INSPIRE_LVermGeo_ALKIS_BU_WFS` | `bu-core2d:Building` | no |
| BB | INSPIRE `bu_alkis_wfs` | `bu-core2d:Building` | no |
| BW | INSPIRE `WFS_INSP_BW_Gebaeude_ALKIS` | `bu-core2d:Building` | no |
| BY | LoD2 CityGML tiles `download1/2.bayernwolke.de/a/lod2/citygml/{e}_{n}.gml` (no WFS) | `bldg:Building` ground surfaces | yes |

Verified live on 11 November 2026 with a 190 m request over a city centre
(between 44 and 401 footprints per state, car parks recognised in NW, NI,
HB and HE). Not covered: Hamburg (its INSPIRE building WFS answers every
BBOX request with a mixed-SRID server error) and Saarland (no open building
WFS found).

**Bayern (since November 2026).** Bayern publishes no open building or
parcel WFS. Its open data contains the LoD2 building model (CC BY 4.0,
"Bayerische Vermessungsverwaltung – www.geodaten.bayern.de") as CityGML
tiles of 2 × 2 km in UTM 32, named by the south-west corner in kilometres.
`bavaria-lod2.service.ts` picks the tiles the 190 m box touches, streams
them, keeps only the ground surfaces and the building function (car parks
2460–2462 and 2465 as above) and caches them per tile for 180 days, so other
sites in the same tile need no download. A tile is 1–160 MB (Munich centre
around 60 MB, rural tiles mostly under 15 MB). Because the analysis waits at
most `OFFICIAL_BUILDINGS_WAIT_MS` after detection, a large tile may arrive
too late for the first analysis of a site and helps from the next one. The
request names only the tile, not the site's coordinates. Points in
neighbouring states inside Bayern's rough outline are answered by their own
state's service first. Schleswig-Holstein answered in 14–20 s and Brandenburg
in about 6 s, so there the footprints usually help only from the second
analysis of a site.

## House coordinates for the anchor

**Method.** After Nominatim's hit is chosen (`pickGeocodeHit`), the address
is split into street, number, suffix and postcode. The state's address WFS
is asked with a FES filter: within 400 m of the hit and house number equal
to the requested one. INSPIRE addresses link their street; the names of the
linked streets are fetched by feature id (ten per request). A candidate
matches when number with suffix, normalised street name ("Str." = "Straße",
umlauts folded) and, where both sides have one, postcode agree. If matches
lie more than 30 m apart, nothing is chosen.

The dealership's own POI (a vehicle-trade POI carrying its name) is kept
even when a house coordinate exists: it marks the lot, the house coordinate
marks the address building. The boundary's provenance records the source,
for example `anchor: official house coordinate (ALKIS Sachsen)`.

| State | Service |
| --- | --- |
| NI | INSPIRE `alkis-dls-ad` |
| SN | INSPIRE `alkis/ad/dls/wfs` |
| SH | INSPIRE `SH_INSPIREDOWNLOAD_AI_AD` |
| BB | INSPIRE `ad_alkis_wfs` |
| MV | INSPIRE `inspire_ad_alkis_download` |
| BW | INSPIRE `WFS_INSP_BW_Adr_Hauskoord_ALKIS` |
| SL | INSPIRE `inspirewfs_Adressen_Hauskoordinaten` |
| BE | `gdi.berlin.de/services/wfs/adressen_berlin` (street inline) |

Verified live on 11 November 2026 with one real address per state; all
eight matched, moving the test anchor 25–344 m onto the address building.
Not covered: Hamburg (same server error as its building service), NRW,
Hessen (house coordinates carry only a street key), Thüringen,
Rheinland-Pfalz, Sachsen-Anhalt, Bremen and Bayern.

## Limitations

- The official data is screening input like OSM, not a survey. Footprints
  and imagery are not perfectly registered; the 2 m inset absorbs most of
  that.
- New buildings appear in the cadastre with a delay of weeks to months;
  demolished ones may linger.
- Where only INSPIRE footprints exist, a car park that OSM does not tag as
  one is masked: vehicles on its roof are then removed. This was already
  the behaviour with untagged OSM footprints.
- A wrong postcode or street spelling in the import prevents the house
  coordinate match; the Nominatim anchor is used then.
- Services change URLs without notice. A failing service is skipped and
  retried on the next analysis; failures are never cached.
