# Luftbilder und Fahrzeugerkennung: Verbesserungen bestehender Funktionen (Stand 19.11.2026)

Hinweise zur Lesart: Repo-Pfade sind relativ zum Repository-Wurzelverzeichnis verlinkt. "Eigene Abfrage" heißt: GetCapabilities, GetMap, GetFeatureInfo oder Kachelabruf per `curl` am 18.11.2026 (UTC), ohne Projekt- oder Nutzerdaten, an öffentlichen Testpunkten (Köln, München, Magdeburg, Hamburg, Dresden, Berlin, Bremen, Bern, Utrecht, Wien, Paris). Alles, was nicht so oder per Quelle belegt ist, steht unter "Gaps" oder ist als "nicht verifiziert" markiert.

## 1. Welche Bildquellen nutzt die App heute, mit welcher Auflösung und welchem Aufnahmedatum? Wo fällt sie auf schlechtere Bilder zurück?

### Takeaway
Die App nutzt Esri World Imagery (z19/z20) und 14 offene Länder-DOP-Dienste, datiert über Esri-Metadaten bzw. den BKG-Flugindex. Die größten Schwächen sind konkret messbar: Der BKG-Index lag an zwei Stichpunkten zwei Jahre hinter dem tatsächlich ausgelieferten Länderbild, Bremen kann wegen der Jahrgangsprüfung derzeit nie gewinnen, Bayern liefert auf z20 nur Fehler, und Sachsen-Anhalt und Hamburg haben entgegen der Doku offene Dienste.

### Cited Findings

**Ist-Zustand laut Code und Doku**
- Kandidaten sind Esri z20 (nur mit Metadatensatz), Esri z19 und das Länder-DOP. Nur datierte Quellen mit ≤ 0,5 m konkurrieren; für die Erkennung gilt ≤ 0,25 m (`DETECTION_MAX_RESOLUTION_M`). Innerhalb von 183 Tagen gewinnt die schärfste Quelle — [docs/imagery-sources.md](../../docs/imagery-sources.md), [desktop-app/src/shared/imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts)
- Das Datum eines Länder-DOP kommt ausschließlich aus dem BKG-Flugindex (`sgx.geodatenzentrum.de/wms_info`, Layer `dop`, Feld `bildflug`), nicht vom Landesdienst selbst — [desktop-app/src/main/services/imagery-source.service.ts](../../desktop-app/src/main/services/imagery-source.service.ts)
- Registrierte Länderdienste: BW, BY (XYZ/WMTS), BE (`truedop_2024`, `vintageYear` 2024), BB, HB (`dop10_2025_HB`, `vintageYear` 2025), HE (`minZoom` 16), MV, NI, NW (10 cm), RP, SL, SN, SH, TH. Hamburg und Sachsen-Anhalt fehlen ("no verified open endpoint") — [desktop-app/src/shared/imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts)
- Stimmt das BKG-Jahr nicht mit `vintageYear` überein, wird `capturedAt` auf `null` gesetzt; undatierte Kandidaten können in `selectImagery` nicht gewinnen — [desktop-app/src/main/services/imagery-source.service.ts](../../desktop-app/src/main/services/imagery-source.service.ts)
- Fallbacks: ohne datierte Quelle Esri (`no-dated-source`); ohne Quelle ≤ 0,25 m Esri mit Hinweis "count likely too low" (`no-sharp-source`); unter 50 % gültiger Kacheln eine Zoomstufe tiefer bis z15; fehlende Kacheln werden grau (128) gefüllt — [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts), [desktop-app/src/main/services/detection/yolo.ts](../../desktop-app/src/main/services/detection/yolo.ts)
- WMS-Dienste werden als 256-px-Kacheln in EPSG:3857 auf z20 abgerufen (`stateTileTemplate`), also serverseitig auf ca. 0,09–0,10 m hochgerechnet, auch wenn das Produkt 0,20 m hat — [desktop-app/src/shared/imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts)
- Esri beschreibt World Imagery als Mosaik aus Vantor-Satellitenprodukten (Vivid Premium 15 cm HD, Vivid Advanced 30 cm HD, Vivid Standard) und Community-Luftbildern von 30 cm bis 3 cm — [ArcGIS-Item World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9)

**Eigene Abfragen (18.11.2026)**
- Alle 14 registrierten Dienste antworten und führen die im Code eingetragenen Layer (z. B. `nw_dop_rgb`, `ni_dop20`, `sn_dop_020`, `th_dop`, `bebb_dop20c`, `he_dop20_rgb`, `truedop_2024`, `dop10_2025_HB`) — z. B. [NRW GetCapabilities](https://www.wms.nrw.de/geobasis/wms_nw_dop?SERVICE=WMS&REQUEST=GetCapabilities), [Bremen GetCapabilities](https://geodienste.bremen.de/wms_dop_lb?SERVICE=WMS&REQUEST=GetCapabilities)
- **BKG-Datum veraltet, Köln:** BKG `bildflug` = 2023-03-01, der NRW-Dienst selbst meldet für dieselbe Kachel `Bildflugdatum = 11.05.2025`, Bodenauflösung 0,10 m (Layer `nw_dop_utm_info`) — [BKG wms_info](https://sgx.geodatenzentrum.de/wms_info?SERVICE=WMS&REQUEST=GetCapabilities), [NRW wms_nw_dop](https://www.wms.nrw.de/geobasis/wms_nw_dop?SERVICE=WMS&REQUEST=GetCapabilities)
- **BKG-Datum veraltet, München:** BKG `bildflug` = 2022-08-14, der bayerische Dienst meldet `ua = 24.08.2024` (Layer `by_dop20_info`) — [Bayern WMS dop20](https://geoservices.bayern.de/od/wms/dop/v1/dop20?SERVICE=WMS&REQUEST=GetCapabilities)
- **Bremen:** BKG `bildflug` = 2023-04-21, die App liefert `dop10_2025_HB` mit `vintageYear` 2025. Nach der Regel oben wird das Datum also zurückgehalten. Der Dienst führt auch `dop10_2023_HB` — [Bremen GetCapabilities](https://geodienste.bremen.de/wms_dop_lb?SERVICE=WMS&REQUEST=GetCapabilities)
- **Berlin:** BKG `bildflug` = 2024-03-26 (passt zu `truedop_2024`). Es gibt zusätzlich `dop_2025_fruehjahr` (Layer `dop20_2025`, `dop_2025`, "DOP20RGBI 2025", 0,20 m, dl-de/zero-2-0), den die App nicht kennt — [Berlin dop_2025_fruehjahr](https://gdi.berlin.de/services/wms/dop_2025_fruehjahr?SERVICE=WMS&REQUEST=GetCapabilities)
- **Bayern z20:** Die Kachel für München antwortet auf z20 mit HTTP 400, auf z19 mit HTTP 200 (JPEG). `DETECTION_ZOOM` ist 20 — [Bayern-Kachel z20](https://wmtsod1.bayernwolke.de/wmts/by_dop/smerc/20/558002/363902), [Bayern-Kachel z19](https://wmtsod1.bayernwolke.de/wmts/by_dop/smerc/19/279001/181951), [desktop-app/src/shared/constants.ts](../../desktop-app/src/shared/constants.ts)
- **Sachsen-Anhalt:** `ST_LVermGeo_DOP_WMS_OpenData/guest`, Layer `lsa_lvermgeo_dop20_2`, liefert GetMap in EPSG:3857 als JPEG (HTTP 200, MaxWidth/Height 4096). Der BKG-Index hat dort ein Datum (Magdeburg 2024-07-21) — [ST GetCapabilities](https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest?SERVICE=WMS&REQUEST=GetCapabilities)
- **Hamburg:** `wms_dop_zeitreihe_unbelaubt` (TIME 2001–2026, Default 2026) und `wms_dop_zeitreihe_belaubt` (TIME 2005–2024), GetMap in EPSG:3857 HTTP 200; BKG-Datum vorhanden (2024-05-08) — [HH unbelaubt](https://geodienste.hamburg.de/wms_dop_zeitreihe_unbelaubt?SERVICE=WMS&REQUEST=GetCapabilities), [HH belaubt](https://geodienste.hamburg.de/wms_dop_zeitreihe_belaubt?SERVICE=WMS&REQUEST=GetCapabilities)
- **Lizenzabweichung Thüringen:** Der Dienst nennt "Creative Commons BY 4.0 … Namensnennung: © GDI-Th", die App führt `dl-de/by-2-0` — [TH GetCapabilities](https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP?SERVICE=WMS&REQUEST=GetCapabilities), [desktop-app/src/shared/imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts)
- Die Doku nennt für Oktober 2026 exakte Übereinstimmung BKG/Land für NW, MV, RP, SL, TH und ca. drei Wochen Abweichung für SN — [docs/imagery-sources.md](../../docs/imagery-sources.md); dem widerspricht die Köln-Abfrage oben.

**Abdeckungsmatrix Deutschland (Ist gegen offen verfügbar)**

| Land | In der App | Auflösung | Datum heute | Offen verfügbar, nicht genutzt (verifiziert) |
|---|---|---|---|---|
| BW | WMS `IMAGES_DOP_20_RGB` | 0,20 m | BKG | kein Info-Layer im Dienst |
| BY | WMTS `by_dop` (nur bis z19) | 0,20 m | BKG (München 2 Jahre alt) | `by_dop20_info` (Feld `ua`), `histdop` 2003–2025 |
| BE | `truedop_2024` | 0,20 m | BKG + Jahrgang | `dop_2025_fruehjahr`, `truedop_2023`, `truedop_2022`, `dop_2021` |
| BB | `bebb_dop20c` | 0,20 m | BKG | `bb_dop_info` |
| HB | `dop10_2025_HB` | 0,10 m | zurückgehalten (BKG 2023) | Jahreslayer 2002–2025, u. a. `dop10_2023_HB` |
| HH | fehlt (Esri) | – | – | `dop_zeitreihe_unbelaubt` 2001–2026, `…_belaubt` 2005–2024 |
| HE | `he_dop20_rgb` | 0,20 m | BKG | `he_dop_rgb_info` |
| MV | `mv_dop` | 0,20 m | BKG | `mv_dop_info` |
| NI | `ni_dop20` | 0,20 m | BKG | `ni_dop20_info`, `doph_wms` 2005–2024 |
| NW | `nw_dop_rgb` | 0,10 m | BKG (Köln 2 Jahre alt) | `nw_dop_utm_info`, `wms_nw_hist_dop` 1951–2024, `wms_nw_vdop` |
| RP | `rp_dop20` | 0,20 m | BKG | `rp_dop20_info`, `rp_hkdop20` 1994–2025 |
| SL | `sl_dop` | 0,20 m | BKG | `sl_dop_info` |
| SN | `sn_dop_020` | 0,20 m | BKG | `sn_dop_020_info` (Feld `Datum`, z. B. "19.03. + 07.04.2024") |
| ST | fehlt (Esri) | – | – | `lsa_lvermgeo_dop20_2` |
| SH | `sh_dop20_rgb` | 0,20 m | BKG | kein Info-Layer im Dienst |
| TH | `th_dop` | 0,20 m | BKG | `th_dop_info`, `dop20rgbi_utm_metadaten` |

Quellen der Matrix: [desktop-app/src/shared/imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts) und die GetCapabilities-Antworten der jeweiligen Dienste (URLs in Abschnitt 2).

### Inferences
- In Köln schreibt die App "counted on DOP10 NRW (2023-03-01)" in die Evidenz, obwohl das gezählte Bild vom 11.05.2025 stammt. Das Datum fließt in die 183-Tage-Regel und in Berichte ein; der Fehler ist also fachlich relevant und nicht nur kosmetisch.
- Für Bayern ist die Übertragung plausibel, aber nicht bewiesen: Die App nutzt den WMTS `by_dop`, die Datumsabfrage lief gegen den WMS `dop20`. Ob beide denselben Jahrgang ausliefern, wurde nicht geprüft.
- In Bremen kann das 10-cm-DOP 2025 derzeit nicht gewählt werden (Datum `null`), solange der BKG-Index 2023 meldet. Die App zählt dort auf Esri, obwohl ein schärferes, neueres offenes Bild existiert.
- In Bayern lädt jede Aufnahme zuerst alle z20-Kacheln (bei 125 m Radius rechnerisch ca. 170–200 Anfragen), bekommt HTTP 400 und fällt dann über die 50-%-Regel auf z19. Fehlschläge werden nicht gecacht, der Aufwand wiederholt sich bei jeder Analyse.
- Auf z20 ist ein Pixel bei 51° N ca. 0,094 m, bei 48° N ca. 0,100 m. DOP20 wird also vom WMS-Server etwa um den Faktor 2 hochgerechnet (Verfahren je Land unbekannt) und in der App nochmals um 0,94 umgerechnet.

### Gaps
- Nicht geprüft: Info-Layer-Felder für BB, HE, MV, NI, RP, SL, TH (nur Existenz der Layer bestätigt; Feldnamen bestätigt für NW, BY, SN).
- Hamburg: Bodenauflösung der Zeitreihen-Layer nicht im Dienst angegeben. Die LGV-Seite nennt 20 cm und 40 cm und eine jährliche Frühjahrsbefliegung — [hamburg.de Digitale Orthophotos](https://www.hamburg.de/politik-und-verwaltung/behoerden/behoerde-fuer-stadtentwicklung-und-wohnen/aemter-und-landesbetrieb/landesbetrieb-geoinformation-und-vermessung/produkte-und-dienstleistungen/geodaten-des-lgv/digitaleorthophotos-244130). GetFeatureInfo ist dort abgeschaltet, ein Datum je Kachel gibt es nur über BKG.
- Wie häufig BKG und Land bundesweit auseinanderliegen, ist offen (zwei Stichpunkte abweichend, Berlin/Magdeburg/Hamburg nicht gegengeprüft).

## 2. Welche offenen Orthophoto-Dienste (Länder, Zeitreihen, Ausland) sind noch nicht eingebunden?

### Takeaway
Zwei Länder (ST, HH), ein neuerer Berliner Jahrgang, Flugdatum-Infolayer in zehn Ländern und historische Jahreslayer in mindestens sieben Ländern sind offen, schlüssellos und verifiziert erreichbar. Im Ausland sind PDOK (8 cm), swisstopo (10 cm), Luxemburg, Flandern und IGN (20 cm) technisch sofort nutzbar; die Hürde ist dort das Aufnahmedatum je Standort.

### Cited Findings

**Deutschland, aktuelle Dienste (alle schlüssellos, eigene Abfrage)**

| Dienst | URL | Layer | Auflösung | Datum je Kachel | Lizenz laut Dienst | Fallstricke |
|---|---|---|---|---|---|---|
| Sachsen-Anhalt DOP20 | [ST_LVermGeo_DOP_WMS_OpenData](https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest?SERVICE=WMS&REQUEST=GetCapabilities) | `lsa_lvermgeo_dop20_2` | 0,20 m | nur BKG (kein Info-Layer) | im Dienst leer; LVermGeo nennt dl-de/by-2-0 — [LVermGeo-Faltblatt Open Data](https://www.geodatenportal.sachsen-anhalt.de/gfds/de/datei/download/id/26238,501/faltblatt_opendata_md.pdf) | MaxWidth 4096; neuer Host |
| Hamburg DOP Zeitreihe | [wms_dop_zeitreihe_unbelaubt](https://geodienste.hamburg.de/wms_dop_zeitreihe_unbelaubt?SERVICE=WMS&REQUEST=GetCapabilities) | `dop_zeitreihe_unbelaubt`, Parameter `TIME=YYYY` | 20 cm laut LGV (im Dienst nicht genannt) | nur Jahr (TIME) und BKG | dl-de/by-2-0, Quellenvermerk FHH/LGV | GetFeatureInfo abgeschaltet; `…_belaubt` enthält laut Dienst auch "Pléiades 1A/B © CNES (2022) … Andere geschlossene Lizenz", also Jahr 2022 dort meiden |
| Berlin DOP 2025 | [dop_2025_fruehjahr](https://gdi.berlin.de/services/wms/dop_2025_fruehjahr?SERVICE=WMS&REQUEST=GetCapabilities) | `dop20_2025` | 0,20 m | Jahrgang im Dienstnamen | dl-de/zero-2-0 | BKG meldete am Testpunkt noch 2024; Dienstname wechselt je Jahrgang |
| NRW vorläufiges DOP | [wms_nw_vdop](https://www.wms.nrw.de/geobasis/wms_nw_vdop?SERVICE=WMS&REQUEST=GetCapabilities) | `nw_vdop_rgb`, `nw_vdop_info` | wie DOP | `nw_vdop_info` | wie NRW-DOP | Dienst ist "mit einem kennzeichnenden Wasserzeichen ausgestaltet"; für die Erkennung ungeeignet, höchstens als Datumshinweis |

**Flugdatum direkt vom Land (statt BKG)**
- NRW `nw_dop_utm_info`: Felder `Kachelname`, `Bildflugdatum` (TT.MM.JJJJ), `Bodenauflösung` — [wms_nw_dop](https://www.wms.nrw.de/geobasis/wms_nw_dop?SERVICE=WMS&REQUEST=GetCapabilities)
- Bayern `by_dop20_info`: Feld `ua` (TT.MM.JJJJ) — [Bayern dop20](https://geoservices.bayern.de/od/wms/dop/v1/dop20?SERVICE=WMS&REQUEST=GetCapabilities)
- Sachsen `sn_dop_020_info`: Feld `Datum` als Freitext mit mehreren Tagen ("19.03. + 07.04.2024") — [Sachsen wms_geosn_dop-rgb](https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest?SERVICE=WMS&REQUEST=GetCapabilities)
- Info-Layer vorhanden (Felder nicht geprüft): `bb_dop_info`, `he_dop_rgb_info`, `mv_dop_info`, `ni_dop20_info`, `rp_dop20_info`, `sl_dop_info`, `th_dop_info` — [BB](https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms?SERVICE=WMS&REQUEST=GetCapabilities), [HE](https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows?language=ger&SERVICE=WMS&REQUEST=GetCapabilities), [MV](https://www.geodaten-mv.de/dienste/adv_dop?SERVICE=WMS&REQUEST=GetCapabilities), [NI](https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms?SERVICE=WMS&REQUEST=GetCapabilities), [RP](https://geo4.service24.rlp.de/wms/rp_dop20.fcgi?SERVICE=WMS&REQUEST=GetCapabilities), [SL](https://geoportal.saarland.de/freewms/dop?SERVICE=WMS&REQUEST=GetCapabilities), [TH](https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP?SERVICE=WMS&REQUEST=GetCapabilities)
- Der BKG-Dienst führt neben `dop` auch `dop_upd`, `truedop` und `spitzenakt` — [BKG wms_info](https://sgx.geodatenzentrum.de/wms_info?SERVICE=WMS&REQUEST=GetCapabilities)

**Historische DOP-Zeitreihen (für die bestehende Fahrzeug-Zeitreihe)**

| Land | URL | Layer-Schema | Datum | Lizenz laut Dienst |
|---|---|---|---|---|
| NRW | [wms_nw_hist_dop](https://www.wms.nrw.de/geobasis/wms_nw_hist_dop?SERVICE=WMS&REQUEST=GetCapabilities) | `nw_hist_dop_1951` … `nw_hist_dop_2024` | `nw_hist_dop_info` liefert je Jahrgang `Bildflugdatum` und Originalauflösung; Köln: 2023-03-01, 2021-06-02, 2019-06-17, jeweils 0,1 m | Open Data NRW (dl-de/zero); 1951–1969 dl-de/by-2-0 |
| Bayern | [histdop](https://geoservices.bayern.de/od/wms/histdop/v1/histdop?SERVICE=WMS&REQUEST=GetCapabilities) | `by_dop_2003_h` … `by_dop_2025_h`, je `…_info` | Feld `ua`, München 2022: 14.08.2022 | CC BY 4.0 |
| Niedersachsen | [doph_wms](https://opendata.lgln.niedersachsen.de/doorman/noauth/doph_wms?SERVICE=WMS&REQUEST=GetCapabilities) | `ni_dop20h_rgb_2008` … `_2024`, `ni_dop40h_rgb_2005`, je `…_info` | Info-Layer (Felder nicht geprüft) | CC BY 4.0 |
| Rheinland-Pfalz | [rp_hkdop20](https://geo4.service24.rlp.de/wms/rp_hkdop20.fcgi?SERVICE=WMS&REQUEST=GetCapabilities) | `rp_dop20_rgb_1994` … `_2025`, je `rp_dop20_info_YYYY` | Info-Layer (Felder nicht geprüft) | dl-de/by-2-0 |
| Bremen | [wms_dop_lb](https://geodienste.bremen.de/wms_dop_lb?SERVICE=WMS&REQUEST=GetCapabilities) | `dop10_2017_HB`, `_2019`, `_2021`, `_2023`, `_2025`, ältere 20/25 cm | nur Jahr im Layernamen | CC BY, LGB |
| Hamburg | [wms_dop_zeitreihe_unbelaubt](https://geodienste.hamburg.de/wms_dop_zeitreihe_unbelaubt?SERVICE=WMS&REQUEST=GetCapabilities) | `TIME=2001…2026` | nur Jahr | dl-de/by-2-0 |
| Berlin | [truedop_2023](https://gdi.berlin.de/services/wms/truedop_2023?SERVICE=WMS&REQUEST=GetCapabilities), [truedop_2022](https://gdi.berlin.de/services/wms/truedop_2022?SERVICE=WMS&REQUEST=GetCapabilities), [dop_2021](https://gdi.berlin.de/services/wms/dop_2021?SERVICE=WMS&REQUEST=GetCapabilities) | ein Dienst je Jahrgang | nur Jahr | dl-de/zero-2-0 (für 2024/2025 bestätigt) |

**Ausland (schlüssellos, eigene Abfrage; Lizenz aus den genannten Quellen)**

| Land | Endpunkt | Layer | Auflösung / max. Zoom | Datum je Standort | Lizenz, Namensnennung | Fallstricke |
|---|---|---|---|---|---|---|
| Niederlande | [PDOK luchtfotorgb WMTS](https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0?request=GetCapabilities&service=WMTS) | `Actueel_orthoHR`, Jahreslayer `2021_orthoHR` … `2026_orthoHR`, `Actueel_ortho25` | 8 cm laut Layer-Abstract; Kacheln bis z21 geliefert (Utrecht) | nur Jahr über Jahreslayer; kein Tagesdatum gefunden | CC-BY 4.0 — [data.overheid.nl Luchtfoto 2026 RGB](https://data.overheid.nl/dataset/77581-luchtfoto-beeldmateriaal-2026-5cm---8cm-rgb-open-data) | "Actueel" wechselt jährlich den Jahrgang; Pfad `…/EPSG:3857/{z}/{x}/{y}.jpeg` |
| Schweiz | [swisstopo WMTS](https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml) | `ch.swisstopo.swissimage` (current), `ch.swisstopo.swissimage-product` mit Time 1997–2025 | 10 cm im Flachland, 25 cm in den Alpen — [opendata.swiss SWISSIMAGE 10 cm](https://ckan.opendata.swiss/dataset/swissimage-10-cm-digitale-orthophotomosaik-der-schweiz); z20 geliefert (Bern) | Flugjahr und GSD je Blatt über `ch.swisstopo.swissimage-product.metadata` (Felder `flightyear`, `gsd`) per [api3 identify](https://api3.geo.admin.ch/rest/services/all/MapServer/identify) | "Open use. Must provide the source." (OGD seit 1.3.2021) — [swisstopo Terms](https://www.swisstopo.admin.ch/en/terms-and-conditions) | nur Jahr, kein Tag; Fair-Use-Grenzen nicht verifiziert |
| Luxemburg | [geoportail.lu WMTS](https://wmts1.geoportail.lu/opendata/service?SERVICE=WMTS&REQUEST=GetCapabilities) | `ortho_latest`, `ortho_2025`, `ortho_2025_winter`, `ortho_2023` … | nicht im Dienst genannt | nur Jahr über Layer | im Dienst "Fees none, AccessConstraints none" | Auflösung und Lizenztext nicht verifiziert |
| Belgien (Flandern) | [OMWRGBMRVL](https://geo.api.vlaanderen.be/OMWRGBMRVL/wms?SERVICE=WMS&REQUEST=GetCapabilities), [OMW Jahrgänge](https://geo.api.vlaanderen.be/OMW/wms?SERVICE=WMS&REQUEST=GetCapabilities) | `Ortho`, `Vliegdagcontour`; `OMWRGB25VL` + `OMWRGB25VL_vdc` (Flugtag-Konturen) | nicht im Dienst genannt | Layer `Vliegdagcontour` / `_vdc` (Felder nicht geprüft) | kostenlos, Nutzungsrecht laut verlinkter Seite | Winterbilder ("winteropnamen") |
| Frankreich | [Géoplateforme WMTS](https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities) | `ORTHOIMAGERY.ORTHOPHOTOS`, `HR.ORTHOIMAGERY.ORTHOPHOTOS` ("Ortho 20 cm"), `…ORTHO-EXPRESS.2025`, Jahreslayer | 20 cm; z19 HTTP 200, z20 HTTP 404 (Paris) | laut Layer-Abstract nur über ein PDF je Département — [Dates des prises de vues](https://data.geopf.fr/annexes/ressources/fiches/photographies-aeriennes-RVB/geoportail_dates_des_prises_de_vues_aeriennes-RVB.pdf) | Licence Ouverte Etalab 2.0 — [IGN BD ORTHO](https://geoservices.ign.fr/bdortho); CGU unter cartes.gouv.fr | kein z20 (gleiches Problem wie Bayern); Datum nicht maschinenlesbar je Punkt |
| Österreich | [basemap.at WMTS](https://mapsneu.wien.gv.at/basemapneu/1.0.0/WMTSCapabilities.xml) | `bmaporthofoto30cm`, Pfad `…/normal/google3857/{z}/{y}/{x}.jpeg` | 29 cm allgemein, 15 cm in Detailgebieten; z20 geliefert (Wien) — [basemap.at Orthofoto](https://basemap.at/en/category/products/basemap-at-orthofofo/) | kein Datumsdienst gefunden; Produktseite nennt Flugjahr als Wasserzeichen | CC-BY 4.0, "Data source: basemap.at" — [basemap.at](https://basemap.at/en) | 29 cm liegt über der 0,25-m-Grenze der Erkennung; Wasserzeichen kann Fehlerkennungen auslösen |
| Spanien | [PNOA-MA WMTS](https://www.ign.es/wmts/pnoa-ma?request=GetCapabilities&service=WMTS) | (Layername nicht ausgelesen) | nicht verifiziert | nicht verifiziert | "CC BY 4.0 scne.es" laut Dienst | Mosaik enthält laut Titel auch Sentinel-2 |
| Polen | [Geoportal ORTO HighResolution](https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution?SERVICE=WMS&REQUEST=GetCapabilities) | `Raster` | nicht verifiziert | nicht verifiziert | Nutzung = Annahme des Geoportal-Regulamin | Bedingungen nicht geprüft |

- WMS-Maximalgrößen der deutschen Dienste: HE 3000, SN/ST 4096, MV 4192, NW/TH/SH 5000, BB 8000, RP/SL 10000, HB 14276, NI/BW 15000 px — GetCapabilities der Dienste (URLs oben)
- Hessen erlaubt ausdrücklich den "automatisierten Abruf" und jede kommerzielle Nutzung ohne Bedingung — [HE GetCapabilities](https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows?language=ger&SERVICE=WMS&REQUEST=GetCapabilities)

### Inferences
- ST und HH passen ohne Umbau in das vorhandene Muster (`STATE_DOP_SERVICES` + BKG-Datum): neue Einträge in [imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts) und [training/fetch_tiles.py](../../training/fetch_tiles.py), Doku in [docs/imagery-sources.md](../../docs/imagery-sources.md). Für HH braucht `stateTileTemplate` einen optionalen festen `TIME`-Parameter.
- Die Länder-Infolayer lösen das Datumsproblem aus Abschnitt 1 an der Quelle: gleiche GetFeatureInfo-Technik wie `getBkgFlightInfo`, nur je Land ein eigener Parser. Sachsen braucht eine Regel für Mehrtagesangaben (z. B. spätester Tag).
- Für Bremen und Berlin wäre eine Jahrgangsliste je Dienst robuster als ein fest verdrahteter Layer: zum BKG-Jahr passenden Layer wählen (`dop10_2023_HB`) oder den neuesten Jahrgang mit Jahresgenauigkeit ausweisen.
- Auslandsdienste verlangen eine Verallgemeinerung von `GermanState` auf eine Regions-ID und eine zweite Datumsquelle. Mit Jahresgenauigkeit (CH, NL, LU) funktioniert die 183-Tage-Regel nur eingeschränkt; das muss als Limitation in die Provenienz.
- Neue Hosts für die Allowlist: `www.geodatenportal.sachsen-anhalt.de`, `geodienste.hamburg.de`, `geoservices.bayern.de`; optional `service.pdok.nl`, `wmts.geo.admin.ch`, `api3.geo.admin.ch`, `wmts1.geoportail.lu`, `geo.api.vlaanderen.be`, `data.geopf.fr`, `mapsneu.wien.gv.at`.

### Gaps
- Keine historischen Dienste gefunden für SN, BB, TH, SH, HE, BW, MV, SL (geratene URLs lieferten 404/500; kein Katalog durchsucht).
- Dänemark, Tschechien, Wallonien, US NAIP: nicht verifiziert. Für Wallonien und ČÚZK antworteten die Capabilities, Layer und Lizenz wurden nicht ausgelesen. NAIP und Dänemark (Token-Pflicht) wurden nicht abgefragt.
- Abruflimits (Requests pro Sekunde) von swisstopo, PDOK, IGN und basemap.at wurden nicht gefunden.
- Auflösung von Luxemburg, Flandern, Spanien, Polen nicht aus Primärquelle bestätigt.

## 3. Wie arbeitet der aktuelle Detektor, was misst der Benchmark, welche Fehlerbilder sind dokumentiert?

### Takeaway
Der Detektor ist ein YOLO11s-OBB (640 px, 0,10 m/px, Basis-Konfidenz 0,45) mit eigenem Fenster-Slicing und hartem NMS; das ist solide. Der Benchmark misst aber nur einzelne 640-px-Kacheln von 11 deutschen DOP-Standorten und damit weder das Mosaik-Slicing noch Esri- oder Wayback-Bilder, auf denen die App ebenfalls zählt.

### Cited Findings
- Ausgeliefertes Modell: `dealer_vehicles` 2026-10-10, YOLO11s-OBB, feinabgestimmt auf Länder-DOP-Kacheln von Händlerstandorten und DLR 3K München, zwei Klassen (car, large_vehicle), Manifest-Schwelle 0,45; ein Ein-Klassen-Modell ist vorbereitet — [docs/detection-benchmark.md](../../docs/detection-benchmark.md)
- Pipeline: Mosaik auf `gsdM` umrechnen (Faktor begrenzt auf 0,5–2,5, bikubisch hoch, Lanczos runter), Fenster in Modellgröße mit 30 % Überlappung (mindestens 16 m, höchstens halbes Fenster), Dekodierung `detect`/`obb`/`end2end`, Größenfilter (≥ 1,2 m breit, ≤ 16 m lang, Seitenverhältnis ≤ 5), klassenunabhängiges hartes NMS (OBB: IoU ≥ 0,5 oder Schnitt/kleinere Box ≥ 0,7), Grenz-Clip, Dachmaske — [desktop-app/src/main/services/detection/yolo.ts](../../desktop-app/src/main/services/detection/yolo.ts), [desktop-app/src/main/services/detection.service.ts](../../desktop-app/src/main/services/detection.service.ts)
- Dachmaske: Boxzentren ≥ 2 m innerhalb eines OSM- oder ALKIS-Gebäudes werden entfernt, Parkdecks ausgenommen; ohne Grundrisse wird nichts entfernt — [docs/detection-benchmark.md](../../docs/detection-benchmark.md), [desktop-app/src/main/services/detection/roof-mask.service.ts](../../desktop-app/src/main/services/detection/roof-mask.service.ts)
- Inferenz: zwei `utilityProcess`-Worker ab 4 Kernen, je halbe Kernzahl als `intraOpNumThreads`, `executionProviders: ["cpu"]`, `graphOptimizationLevel: "all"` — [desktop-app/src/main/workers/onnx-inference.worker.ts](../../desktop-app/src/main/workers/onnx-inference.worker.ts)
- Export: ONNX opset 17, `simplify=True`, `dynamic=False`, FP32 — [training/export.py](../../training/export.py)
- Training: Start von DOTA-vortrainiertem `yolo11s-obb.pt`, 640 px, Rotation 180°, Flips, `scale=0.3`; die Hälfte der scharfen Kacheln (NRW, Bremen, DLR) bekommt eine auf 0,18–0,25 m verschlechterte Kopie — [training/train.py](../../training/train.py), [training/README.md](../../training/README.md)
- Trainingskacheln entstehen als ein einzelnes WMS-GetMap mit 640 × 640 px bei 0,10 m/px (Bayern: z19-Kacheln, bikubisch); die App dagegen setzt 256-px-z20-Kacheln zusammen und rechnet um — [training/fetch_tiles.py](../../training/fetch_tiles.py), [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts)
- Benchmark: `npm run benchmark:detection` ruft `inferWindow` je Validierungskachel auf (99 Kacheln, 11 Standorte, 1.638 Fahrzeuge), summiert je Standort und berechnet MAE, Bias und Anteil innerhalb 10 %. Grenz-Clip, Dachmaske, Umrechnung und Fenster-Slicing laufen nicht mit — [desktop-app/src/main/services/detection/detection-sweep.run.test.ts](../../desktop-app/src/main/services/detection/detection-sweep.run.test.ts), [desktop-app/src/main/services/detection-benchmark.ts](../../desktop-app/src/main/services/detection-benchmark.ts)
- Ergebnis des ausgelieferten Modells bei 0,45: MAE 8,0 Fahrzeuge, Bias +0,2 %, 73 % der Standorte innerhalb 10 %. Zwei neuere Läufe (Pseudo-Label, YOLO26s) sind "not better than the noise of 11 sites" — [docs/detection-benchmark.md](../../docs/detection-benchmark.md)
- Die Doku nennt selbst als Grenzen: 11 Standorte, Schwelle auf denselben Standorten gewählt, Kacheln ganz bewertet, nur deutsche Länder-DOP — [docs/detection-benchmark.md](../../docs/detection-benchmark.md)
- Dokumentierte Fehlerbilder bei 0,45: 93 % der Fahrzeuge gefunden; große Fahrzeuge zu 24 % verfehlt, kleine oder angeschnittene zu 21 %, Fahrzeuge am Kachelrand zu 13 %, dichte Reihen nur zu 5 %; gelbe Busse und Transporter fallen auf; eingebrannte Quellenvermerke ("© GeoBasis-DE/…") werden teils als Fahrzeug erkannt — [training/README.md](../../training/README.md)
- Solarmodulreihen auf Dächern lesen sich als Fahrzeuge; dafür gibt es harte Negative und die Dachmaske — [training/README.md](../../training/README.md)
- Fahrzeuge unter Dächern, Carports oder dichten Bäumen sind nicht sichtbar und werden nicht gelabelt — [docs/detection-benchmark.md](../../docs/detection-benchmark.md), [training/README.md](../../training/README.md)
- Esri-Kacheln werden bewusst nicht für das Training verwendet — [training/README.md](../../training/README.md)
- Schlägt ein Fenster im Worker fehl, wird es übersprungen (`if (res.error || !res.detections) continue;`), ohne Eintrag in `limitations` — [desktop-app/src/main/services/detection.service.ts](../../desktop-app/src/main/services/detection.service.ts)
- `make_dataset.py` behält am Kachelrand angeschnittene Fahrzeuge mit beschnittener Box — [training/README.md](../../training/README.md)
- Der Link auf den DLR-3K-Datensatz in `convert_public.py` (`…/public-datasets/3k-vehicle-detection`) liefert HTTP 404; der Datensatz liegt jetzt unter "DLR-MVDA" mit dem Archiv `MunichDatasetVehicleDetection-2015-old.zip` — [training/convert_public.py](../../training/convert_public.py), [DLR-MVDA](https://www.dlr.de/en/eoc/about-us/remote-sensing-technology-institute/photogrammetry-and-image-analysis/public-datasets/dlr-mvda)

### Inferences
- Der Benchmark zählt angeschnittene Fahrzeuge in beiden Nachbarkacheln (Soll und Ist doppelt), die App zählt sie nach Mosaik-NMS einmal. Die aus dem Kachel-Benchmark gewählte Schwelle 0,45 ist deshalb für die App-Pipeline nicht exakt übertragbar.
- Die neun Kacheln je Standort bilden ein lückenloses 3 × 3-Raster (1.920 px). Sie lassen sich offline zu einem Mosaik zusammensetzen und durch `planCrops` + `nms` schicken. Damit würde der bestehende Benchmark das echte Slicing und die Nahtlogik messen, ohne neue Daten.
- Mit 11 Standorten sind Unterschiede wie MAE 7,5 gegen 8,0 nicht belastbar. Ein Bootstrap-Konfidenzintervall über Standorte (deterministisch mit festem Seed) im Sweep-JSON würde das sichtbar machen.
- Das Akzeptanzziel "MAE ≤ 10 % der gelabelten Anzahl" und die berichtete absolute MAE passen nicht zueinander; 1.638 / 11 ergibt im Mittel 149 Fahrzeuge je Standort, MAE 8,0 entspricht etwa 5 % davon, aber 3 von 11 Standorten liegen außerhalb von 10 %.
- Für Esri z19/z20 und Wayback gibt es keine Messung, obwohl dort gezählt wird (HH, ST, Bremen laut Abschnitt 1, alle Zeitreihen-Zählungen). Ein kleiner Esri-Benchmark-Satz (nur lokal, nicht fürs Training) würde die Zeitreihe erstmals bewertbar machen.
- Trainingsbild (ein GetMap, 0,10 m) und App-Bild (256-px-JPEG-Kacheln, Faktor 0,94 Lanczos) unterscheiden sich systematisch; der Effekt ist unbekannt, weil der Benchmark nur das Trainingsformat sieht.

### Gaps
- Kein Wert zur Zählgenauigkeit auf Esri-Bildern, auf DOP20 gegen DOP10 getrennt in der App-Pipeline, oder zur Wirkung der Dachmaske.
- Inferenzzeit je Standort ist nicht dokumentiert (nur "about a third less" nach der Überlappungsänderung).

## 4. Welche offen lizenzierten Luftbild-Fahrzeugdatensätze helfen beim Fine-Tuning oder Benchmarking im Training Studio?

### Takeaway
Keiner der geprüften öffentlichen Datensätze ist nachweislich für kommerzielle Nutzung frei; fast alle sind auf Forschung oder nicht-kommerzielle Nutzung beschränkt oder unklar. Lizenzsauber erweiterbar ist nur der bereits gewählte Weg: eigene Labels auf offenen Orthophotos, künftig auch aus ST, HH, historischen Jahrgängen und ggf. PDOK/swisstopo.

### Cited Findings

| Datensatz | GSD | Umfang | Annotation | Lizenz / kommerziell | Bezug |
|---|---|---|---|---|---|
| DLR 3K München (DLR-MVDA) | ca. 0,13 m laut Repo | Archiv 163 MB | Boxen mit Orientierung | auf der Seite nicht genannt; Bildnachweis "DLR (CC BY-NC-ND 3.0)" | [DLR-MVDA](https://www.dlr.de/en/eoc/about-us/remote-sensing-technology-institute/photogrammetry-and-image-analysis/public-datasets/dlr-mvda), [convert_public.py](../../training/convert_public.py) |
| EAGLE (DLR) | 5–45 cm | 318 Bilder, 215.986 Fahrzeuge, Aufnahmen 2006–2019 | orientierte Boxen (4 Ecken), Sichtbarkeit, klein/groß | nicht ausdrücklich; Bildnachweis CC BY-NC-ND 3.0; Direktdownload 3,15 GB | [DLR EAGLE](https://www.dlr.de/en/eoc/about-us/remote-sensing-technology-institute/photogrammetry-and-image-analysis/public-datasets/eagle) |
| VEDAI | Utah-AGRC-Orthophotos "6 inch", Bildsätze 512 und 1024 px | – | Annotationsdateien je Bildgröße | "research, and non-commercial purposes only … Any use for commercial and / or industrial purpose is forbidden" | [VEDAI Terms](https://downloads.greyc.fr/vedai/TermsandConditionsofUseVeDAI2014.pdf), [VEDAI](https://downloads.greyc.fr/vedai/) |
| COWC | 15 cm | 32.716 Autos, 58.247 harte Negative; Toronto, Selwyn, Potsdam, Vaihingen, Columbus, Utah | Punktannotationen laut Projekt | Seite nennt keine Datenlizenz; das Code-Repo trägt AGPL-3.0 | [COWC](https://gdo152.llnl.gov/cowc/), [LLNL/cowc LICENSE](https://github.com/LLNL/cowc/blob/master/LICENSE) |
| DOTA | je Bild verschieden | – | orientierte Boxen | "academic purposes only", "any commercial use is prohibited"; Google-Earth-Bilder zusätzlich nach Google-Bedingungen | [DOTA](https://captain-whu.github.io/DOTA/dataset.html) |
| ITCVD | 10 cm (Nadir) | 135 Trainingsbilder mit 23.543 Fahrzeugen, 38 Testbilder mit 5.545 | achsparallele Boxen | CC BY-NC-SA 4.0 (DANS) | [arXiv 1801.07339](https://arxiv.org/abs/1801.07339), [DANS-Datensatz](https://doi.org/10.17026/dans-xnc-h2fu) |
| ArtifiVe-Potsdam | Basis ISPRS Potsdam | reale und künstliche 600-px-Bilder | JSON je Teilmenge | CC BY-NC-SA 3.0; kommerziell nur auf Anfrage | [ArtifiVe-Potsdam](https://rs.ipb.uni-bonn.de/data/artifive-potsdam/index.html) |
| ISPRS Potsdam / Vaihingen | 5 cm / 9 cm | Vaihingen 33 Kacheln | semantische Masken (Klasse Auto) | Nutzungsbedingungen in verlinktem Dokument, nicht abgerufen | [ISPRS 2D Semantic Labeling](https://www.isprs.org/resources/datasets/benchmarks/UrbanSemLab/semantic-labeling.aspx) |
| xView | Satellit | – | achsparallele Boxen | CC BY-NC-SA 4.0 laut Aggregator; ein Challenge-Forum fand keine klare Lizenz | [datasetninja xView](https://datasetninja.com/xview), [CodaLab-Forum](https://codalab.lisn.upsaclay.fr/forums/9563/1286) |
| VisDrone | Drohne, teils schräg | – | Boxen | widersprüchlich: Kartentext CC BY-NC-SA 3.0, Metadaten cc-by-sa-3.0 | [HF-Spiegel VisDrone2019-DET](https://huggingface.co/datasets/Voxel51/VisDrone2019-DET/blob/main/README.md?code=true) |
| CARPK | Drohne | 1.448 Bilder | Boxen | Lizenz nicht gefunden | [CARPK-Eintrag](https://cs.paperswithcode.com/dataset/carpk) |

- Die App-Doku hält fest: Modellgewichte stammen von Ultralytics (AGPL-3.0), sind auf DOTA vortrainiert und mit DLR 3K feinabgestimmt, "both released for research"; die App selbst ist PolyForm Noncommercial — [docs/detection-benchmark.md](../../docs/detection-benchmark.md)
- Die Doku stuft VisDrone und CARPK als nützlich für Modellvergleiche, aber nicht als Ersatz für händlerspezifische Validierung ein — [docs/detection-benchmark.md](../../docs/detection-benchmark.md)
- Offene Orthophotos sind dagegen ausdrücklich frei: dl-de/zero-2-0 (NRW, Berlin), CC BY 4.0 (BY, NI, SH, TH, HB), dl-de/by-2-0 (BB, BW, RP, HH), Hessen "ohne Einschränkung oder Bedingung" — GetCapabilities der Dienste (Abschnitt 2)

### Inferences
- Größter Hebel im bestehenden Studio ist mehr Vielfalt aus offenen Quellen, nicht ein weiterer Forschungsdatensatz: `SERVICES` in [training/fetch_tiles.py](../../training/fetch_tiles.py) um ST und HH ergänzen (heute übersprungen laut README) und um historische Jahreslayer (NRW, BY, NI, RP) erweitern. Derselbe Standort in anderem Jahr und anderer Jahreszeit liefert neue Schatten, Belaubung und Bestände bei gleicher Lizenzlage.
- EAGLE passt technisch am besten (orientierte Boxen, 5–45 cm, viele Sensoren und Jahreszeiten) und wäre mit einem zweiten Konverter neben [convert_public.py](../../training/convert_public.py) nutzbar, verschärft aber die NC/ND-Frage. Für einen reinen lokalen Benchmark (keine Gewichte, keine Weitergabe) ist das Risiko kleiner als fürs Training; rechtlich klären.
- ITCVD (10 cm Nadir, 29.088 Fahrzeuge) wäre ein guter externer Zähl-Benchmark für "anderes Land, andere Kamera", ebenfalls nur nicht-kommerziell.
- VisDrone, CARPK, UAVDT sind Drohnenbilder mit anderer Perspektive; die Repo-Erfahrung (VisDrone-Modell unterzählt dichte Reihen) spricht gegen sie als Trainingsquelle.
- Der tote DLR-Link in [convert_public.py](../../training/convert_public.py) und [training/README.md](../../training/README.md) sollte auf die DLR-MVDA-Seite zeigen; neuer Download-Host wäre `pba-freesoftware.eoc.dlr.de` (nur für das Studio relevant).

### Gaps
- Lizenztexte von DLR-MVDA, EAGLE (über den Bildnachweis hinaus), COWC-Daten, ISPRS, CARPK, UAVDT und FAIR1M konnten nicht aus Primärquellen bestätigt werden.
- GSD, Bild- und Instanzzahlen für VEDAI, DOTA, xView, VisDrone, FAIR1M, UAVDT wurden nicht aus Primärquellen erhoben.
- Kein offen (kommerziell) lizenzierter Luftbild-Fahrzeugdatensatz gefunden; ob es einen gibt, bleibt offen.

## 5. Welche gut belegten Inferenztechniken verbessern die Zählung kleiner Objekte in der bestehenden Pipeline?

### Takeaway
Die wichtigsten belegten Techniken (Slicing, GSD-Normalisierung, orientierte Boxen, Naht-NMS) sind bereits umgesetzt; der verbleibende Gewinn liegt eher darin, App- und Trainingsbild anzugleichen und die Schwelle auf der echten Pipeline zu kalibrieren. Beschleuniger (CoreML/DirectML, INT8) sind möglich, aber die Evidenz ist gemischt und muss lokal gemessen werden.

### Cited Findings
- SAHI: Slicing nur zur Inferenz erhöht die AP auf VisDrone und xView um 6,8 / 5,1 / 5,3 Punkte (FCOS, VFNet, TOOD); mit Slicing-Fine-Tuning kumuliert 12,7 / 13,4 / 14,5 — [arXiv 2202.06934](https://arxiv.org/abs/2202.06934)
- Adaptive Slice-Zahl (ASAHI) meldet 20–25 % weniger Inferenzzeit gegenüber SAHI — [arXiv 2604.19233](https://arxiv.org/abs/2604.19233)
- Auflösung: Die Erkennungsleistung fällt von mAP 0,53 bei 30 cm auf 0,11 bei 4,8 m; Super-Resolution von 30 auf 15 cm bringt 13–36 % mAP — [arXiv 1812.04098](https://arxiv.org/abs/1812.04098)
- Weighted Boxes Fusion nutzt die Scores aller überlappenden Boxen statt sie zu verwerfen und behandelt gespiegelte Eingaben als eigene Modelle (Test-Time-Augmentation) — [arXiv 1910.13302](https://arxiv.org/abs/1910.13302)
- Das Studio nutzt 8-fache TTA (4 Rotationen × Spiegelung) schon beim Autolabeln: 92 % der Fahrzeuge landen in `sure`, Präzision dort ca. 94–98 % — [training/README.md](../../training/README.md)
- Soft-NMS wurde in der App bewusst durch hartes NMS ersetzt, weil Nahtduplikate überlebten — [docs/detection-benchmark.md](../../docs/detection-benchmark.md)
- Ultralytics-OBB-Modelle sind auf DOTAv1 bei 1024 px vortrainiert; YOLO26s-obb: mAP50 80,9 (e2e), 218 ms je 1024-px-Bild auf CPU-ONNX, 9,8 M Parameter — [Ultralytics OBB](https://docs.ultralytics.com/tasks/obb/)
- Die App unterstützt das NMS-freie `end2end`-Format bereits im Decoder — [desktop-app/src/main/services/detection/yolo.ts](../../desktop-app/src/main/services/detection/yolo.ts)
- onnxruntime-node: CPU überall, CoreML nur macOS, DirectML nur Windows, CUDA nur Linux x64, WebGPU experimentell — [onnxruntime-node 1.24.3 (socket.dev)](https://socket.dev/npm/package/onnxruntime-node/overview/1.24.3), [README 1.23.2 (Debian)](https://sources.debian.org/src/onnxruntime/1.23.2%2Bdfsg-6/js/node/README.md)
- CoreML-EP: `MLProgram` braucht macOS 12+, Operatorabdeckung ist je Format eingeschränkt, ANE-Nutzung des ganzen Modells ist nicht garantiert — [ONNX Runtime CoreML EP](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)
- INT8: Eine Studie zu YOLO12 misst für statisches INT8 (TensorRT) 1,5–3,3× Tempo bei 3–7 Punkten weniger mAP50-95; dynamisches UINT8 über ONNX Runtime hielt die Genauigkeit, war aber langsamer — [arXiv 2508.19600](https://arxiv.org/abs/2508.19600)
- Ein CPU-Bericht (YOLOX, ONNX Runtime) nennt für statisches INT8 2,3–2,5× bei 0,007–0,025 mAP Verlust, für dynamisches INT8 4–6× langsamer als FP32 — [NashTech-Blog](https://blog.nashtechglobal.com/real-time-ai-on-a-plain-cpu-how-far-can-you-get-without-a-gpu/)
- Ultralytics exportiert seit v8.4.60 ONNX-INT8 direkt (`int8=True` mit Kalibrierdaten); v8.4.196 stellt auf Per-Channel-Quantisierung um (COCO-mAP 0,3557 → 0,3814 laut Release-Notiz) — [Ultralytics v8.4.60](https://community.ultralytics.com/t/new-release-ultralytics-v8-4-60/2023), [Ultralytics 8.4.196](https://newreleases.io/project/pypi/ultralytics/release/8.4.196)
- Das Repo pinnt `ultralytics>=8.4,<8.5` und `onnxruntime-node ^1.31.1` — [training/requirements.txt](../../training/requirements.txt), [desktop-app/package.json](../../desktop-app/package.json)
- NRW lieferte ein einzelnes GetMap mit 2048 × 2048 px bei 0,10 m in EPSG:25832 in 2,2 s (510 KB); eine einzelne 256-px-z20-Kachel dauerte 0,8 s — [NRW wms_nw_dop](https://www.wms.nrw.de/geobasis/wms_nw_dop?SERVICE=WMS&REQUEST=GetCapabilities) (eigene Messung, Einzelwerte)

### Inferences
- **GSD-Normalisierung an der Quelle:** Für WMS-Quellen kann [tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts) das Bild direkt mit `manifest.gsdM` in wenigen großen GetMap-Kacheln (z. B. 1024–2048 px, unter den MaxWidth-Werten aus Abschnitt 2) holen. Das entspricht dem Trainingsformat aus `fetch_tiles.py`, spart die zweite Umrechnung und reduziert ca. 170–200 Anfragen auf 4–9. Der Kachel-Cache-Schlüssel muss dann Größe und BBOX-Raster enthalten.
- **TTA/WBF:** Die Autolabel-Zahlen im Repo zeigen, dass 8-fach-TTA die Trefferquote hebt. In der App kostet das 2–8× Rechenzeit; sinnvoll wäre höchstens 2-fach (Spiegelung) und nur, wenn der End-to-End-Benchmark einen Zählgewinn zeigt. WBF passt nicht direkt auf orientierte Boxen; hier wäre die Mehrheitsregel aus `autolabel.Buckets` (Box in ≥ n Durchläufen) die deterministische Entsprechung.
- **Dichte-NMS:** Geringer Nutzen, da dichte Reihen laut Fehleranalyse nur zu 5 % verfehlt werden; die offenen Lücken sind große Fahrzeuge und Randfälle.
- **Große Fahrzeuge / Randfälle:** 24 % Fehlquote bei großen Fahrzeugen spricht für mehr solche Beispiele im Training (EAGLE-Klasse "large", eigene Labels auf Nutzfahrzeughändlern) statt für Inferenztricks. Die Randfehlquote (13 %) betrifft den Kachel-Benchmark; in der App liegt jedes Fahrzeug dank 16-m-Überlappung vollständig in einem Fenster.
- **Kalibrierung:** Die Bias-Tabelle zeigt +12,5 % bei 0,22 und −4,5 % bei 0,60; die Zählung hängt stark an einer Schwelle. Robuster wäre, die Schwelle per Leave-one-site-out auf dem End-to-End-Benchmark zu wählen und im Manifest neben `defaultConfidence` die gemessene Streuung abzulegen, damit die App sie als Unsicherheit in `limitations` nennen kann.
- **Fenstergröße:** Ein Export mit 1024 px (Vortrainingsgröße) würde die Fensterzahl je Mosaik etwa dritteln und Nähte reduzieren; `manifest.imgsz` und `windowStride` unterstützen das bereits. Ob Genauigkeit und Laufzeit profitieren, muss ein Sweep zeigen.
- **Ausführungsprovider:** `executionProviders: ["coreml", "cpu"]` (macOS) bzw. `["dml", "cpu"]` (Windows) wäre eine Einzeiländerung in [onnx-inference.worker.ts](../../desktop-app/src/main/workers/onnx-inference.worker.ts) plus Rückfall auf CPU. Ergebnisgleichheit zur CPU ist nicht garantiert; die Zählung müsste über den Benchmark gegen CPU geprüft und der Provider in der Evidenz vermerkt werden.
- **INT8:** Wegen der gemischten Evidenz nur als gemessene Option: statisch mit Kalibrierkacheln aus dem Trainingssatz, Zähl-MAE im App-Benchmark vergleichen, nie dynamisch.

### Gaps
- Keine Messung von CoreML/DirectML oder INT8 für YOLO-OBB in onnxruntime-node gefunden; ob der OBB-Kopf vollständig auf CoreML läuft, ist offen.
- Kein Beleg speziell für Zählfehler (statt mAP) durch TTA oder WBF bei Luftbild-Fahrzeugen gefunden.
- Die ONNX-Runtime-README im Hauptzweig war nicht abrufbar; die Provider-Tabelle stammt aus Spiegeln für 1.23/1.24, nicht für die eingesetzte 1.31.

## 6. Wie robust ist die Fahrzeug-Zeitreihe und was verbessert sie konkret?

### Takeaway
Die Zeitreihe hängt ganz an Esri Wayback: Datum und Szene werden nur für eine Kachel am Standortpunkt bestimmt, gezählt wird aber auf einem 250-m-Mosaik, und die Bilder liegen Jahre auseinander. Historische Länder-DOP mit tagesgenauem Flugdatum (NRW 10 cm, BY, NI, RP, HB, HH, BE) sind die wirksamste Ergänzung innerhalb der bestehenden Funktion.

### Cited Findings
- Ablauf: `waybackTimeline` bei z20, nur datierte Bilder ≤ 0,25 m, höchstens vier (`VEHICLE_TIMELINE_MAX_DATES`), neueste zuerst; Median, Minimum, Maximum — [desktop-app/src/main/services/vehicle-timeline.service.ts](../../desktop-app/src/main/services/vehicle-timeline.service.ts), [desktop-app/src/shared/vehicle-timeline.ts](../../desktop-app/src/shared/vehicle-timeline.ts)
- Lokale Änderungen werden über die Tilemap genau einer Kachel (`lon2tile`/`lat2tile` des Punkts) ermittelt, das Datum über einen Punkt-Identify am selben Ort — [desktop-app/src/main/services/wayback.service.ts](../../desktop-app/src/main/services/wayback.service.ts)
- Der Rücklauf bricht ab, sobald eine Version auf der Zoomstufe keine Kachel hat (`if (!map.hasTile) break;`); auf z19 wird nur gewechselt, wenn schon die neueste Version auf z20 nichts hat — [desktop-app/src/main/services/wayback.service.ts](../../desktop-app/src/main/services/wayback.service.ts)
- Duplikate werden über `capturedAt|collection|resolutionM` zusammengefasst; Versionen ohne Metadatendienst bleiben undatiert und fallen für die Zählung weg — [desktop-app/src/main/services/wayback.service.ts](../../desktop-app/src/main/services/wayback.service.ts)
- Die Zeitreihe erfasst immer 125 m Radius (`contextBbox`-Standard); die Analyse nimmt bei großen Höfen 190 m (`WIDE_CONTEXT_CAPTURE_RADIUS_M`) — [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts), [desktop-app/src/main/services/analyze.service.ts](../../desktop-app/src/main/services/analyze.service.ts)
- Die Doku spricht von "100 m radius"; der Code nutzt 125 m — [docs/imagery-sources.md](../../docs/imagery-sources.md), [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts)
- Die Zeitreihe prüft `validTileCount` nicht; fehlende Kacheln sind graue Flächen — [desktop-app/src/main/services/vehicle-timeline.service.ts](../../desktop-app/src/main/services/vehicle-timeline.service.ts), [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts)
- Dokumentierte Grenzen: Bilder ein bis mehrere Jahre auseinander, oft verschiedene Jahreszeiten, aktuelle Grenze auch auf alte Bilder angewandt, Satellitenszenen durch die Auflösungsgrenze ausgeschlossen, Wayback enthält Länder-DOP nur, wenn Esri sie übernommen hat — [docs/imagery-sources.md](../../docs/imagery-sources.md)
- Esri unterscheidet in Wayback ausdrücklich Veröffentlichungsdatum der Kartenversion und Aufnahmedatum des Bildes; das Aufnahmedatum kommt aus dem Metadaten-Popup — [Esri-Blog Wayback with World Imagery Metadata](https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/imagery/wayback-with-world-imagery-metadata)
- Esris eigene Bibliothek filtert Duplikate standardmäßig über die Bilddaten; die Option, nur nach Kachelgröße zu filtern, "may wrongly exclude some unique releases". `getMetadata` liefert Datum, Anbieter, Quelle, Auflösung, Genauigkeit — [@esri/wayback-core README](https://cdn.jsdelivr.net/npm/@esri/wayback-core@1.1.0/README.md)
- In der Esri-Community gibt es unbeantwortete Meldungen, dass Wayback-Bild und Wayback-Metadaten nicht zusammenpassen — [Esri Community](https://community.esri.com/discussion/1696060/wayback-imagery-and-wayback-metadata-do-not-tally-any-explanation)
- Historische Länder-DOP mit Datum sind verfügbar: NRW `nw_hist_dop_YYYY` (Köln: 2019-06-17, 2021-06-02, 2023-03-01, je 0,1 m), Bayern `by_dop_YYYY_h` (München 2022: 14.08.2022), Niedersachsen `ni_dop20h_rgb_YYYY`, Rheinland-Pfalz `rp_dop20_rgb_YYYY`, Bremen `dop10_YYYY_HB`, Hamburg `TIME=YYYY`, Berlin je Jahrgang ein Dienst — URLs in Abschnitt 2
- Die Schweiz bietet `ch.swisstopo.swissimage-product` mit Zeitdimension 1997–2025 und Flugjahr/GSD je Blatt; die Niederlande `2021_orthoHR` bis `2026_orthoHR` — [swisstopo WMTS](https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml), [PDOK WMTS](https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0?request=GetCapabilities&service=WMTS)

### Inferences
- **Szenenmix:** Ein 250-m-Mosaik umfasst auf z20 rund 13 × 13 Kacheln. Liegt eine Szenengrenze im Bild, mischt die Zählung zwei Aufnahmetage unter einem Datum. Abhilfe ohne neue Funktion: Tilemap und Metadaten zusätzlich an den vier Bildecken abfragen und bei Abweichung die Zählung verwerfen oder kennzeichnen.
- **Abbruch auf z20:** Wo Esri z20 erst seit Kurzem führt, endet die Historie nach ein bis zwei Einträgen, obwohl auf z19 ältere 0,2-m-Orthophotos vorliegen können. Der Rücklauf sollte beim ersten `hasTile=false` auf z19 weiterlaufen.
- **Vergleichbarkeit:** Bei großen Höfen zählt die Analyse auf 190 m, die Zeitreihe auf 125 m. Der Radius der Analyse sollte am Ergebnis gespeichert und in `aerialImageForContextFrom` wiederverwendet werden; sonst unterschätzt die Zeitreihe systematisch und `snapshot` meldet fälschlich "high".
- **Länder-Zeitreihe:** `ImageryCandidate` kennt bereits `state-dop` mit `capturedAt`; historische Jahreslayer wären zusätzliche Kandidaten in der Zeitreihe (nicht in der automatischen Auswahl). In NRW bekäme man damit vier bis fünf 10-cm-Bilder im Zweijahresabstand mit Tagesdatum, auf genau der Bildart, auf der das Modell trainiert und gemessen ist.
- **Auswahl der vier Bilder:** "Neueste zuerst" bündelt die Zählungen auf die letzten Jahre. Eine Auswahl nach zeitlicher Streuung (und bevorzugt gleicher Jahreszeit wie das Hauptbild) wäre repräsentativer; Monat und Wochentag lassen sich aus `capturedAt` ableiten und in der bestehenden Limitation-Zeile nennen.
- **Unabhängigkeit:** Die neueste Wayback-Version ist das aktuelle Esri-Bild. Wurde die Hauptzählung auf derselben Szene gemacht, steckt sie doppelt in Median und Spanne; ein Abgleich über `capturedAt` reicht zur Kennzeichnung.
- **Teilbilder:** Eine Zählung auf einem Mosaik mit fehlenden Kacheln kann das Minimum verfälschen; `validTileCount / tileCount` sollte je Zählung geprüft und gespeichert werden.

### Gaps
- Keine Zahl dazu, wie oft `SRC_DATE` in den Wayback-Metadaten vom tatsächlichen Aufnahmetag abweicht; Esri veröffentlicht dazu nichts Auffindbares.
- Der Esri-Blog war nicht direkt abrufbar (HTTP 403); die Aussage stammt aus der Suchzusammenfassung.
- Ob Wochentag oder Saison den Händlerbestand messbar verändern, ist nicht belegt.

## 7. Robustheit und Performance: Cache, Abruflimits, Nutzungsbedingungen, Fehlerbehandlung, Speicher, Worker

### Takeaway
Die offenen Länderdienste sind rechtlich unkritisch, Esri dagegen ist eine Grauzone: Lizenz ist der Esri Master License Agreement, der Layer ist nicht für Kachel-Export gedacht, und die App hält Kacheln 30 Tage vor, obwohl Esri 24 Stunden vorgibt. Technisch fehlen hostweite Limits für Bilddienste, Fehler bleiben teils unsichtbar, und der Detektor reserviert Speicher für alle Fenster auf einmal.

### Cited Findings

**Nutzungsbedingungen**
- World Imagery: "licensed under the Esri Master License Agreement"; "This layer is not intended to be used to export tiles for offline"; Datenerfassung und Editieren in ArcGIS-Apps sind erlaubt — [ArcGIS-Item World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9)
- Die produktbezogenen Esri-Bedingungen (E300) enthalten seit 13.11.2025 die Fußnote "may not extract, or store results in external databases, nor create derivative works or use machine learning/artificial intelligence to generate external databases"; laut Änderungsnotiz gilt sie für das neue Produkt Google Photorealistic 3D Basemap — [Esri E300-Änderungsnotiz 13.11.2025](https://www.esri.com/content/dam/esrisites/en-us/media/legal/ma-and-prod-spec-scope-of-use-changes/term-changes-web-notice-e300-11-13-25.pdf)
- Esri-Kacheln kommen mit `Cache-Control: max-age=86400` — [Esri-Kachel](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/19/175000/268000?blankTile=false) (eigene Abfrage)
- Die App cacht Kacheln 30 Tage (`TILE_TTL`), Bildmetadaten 7 Tage (`TTL.imageryMetadata`) — [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts), [desktop-app/src/main/services/cache.service.ts](../../desktop-app/src/main/services/cache.service.ts)
- Länderdienste: NRW "gebührenfrei nach Open Data-Prinzipien", Hessen "automatisierter Abruf … kostenfrei", Berlin dl-de/zero-2-0, Bayern CC BY 4.0 — GetCapabilities der Dienste (Abschnitt 2)
- Mecklenburg-Vorpommern stempelt einen Copyright-Vermerk in die Kacheln — [docs/imagery-sources.md](../../docs/imagery-sources.md)

**Abruf und Cache**
- Hostweite Limits (`HOST_POLICIES`) gibt es für Nominatim, Overpass, Photon, Wayback, DWD, nicht aber für `server.arcgisonline.com`, `services.arcgisonline.com`, `sgx.geodatenzentrum.de` oder die Länder-WMS; je Aufnahme gelten 8 parallele Kachelabrufe, dazu bis zu 2 Vorab-Ladevorgänge — [desktop-app/src/main/services/http.service.ts](../../desktop-app/src/main/services/http.service.ts), [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts)
- Nur erfolgreiche Kacheln werden gecacht; Fehlschläge (404/400) werden bei jeder Aufnahme erneut versucht — [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts)
- Kacheln liegen als Base64-Text in der SQLite-Tabelle `api_cache`; abgelaufene werden beim Start in 500er-Schritten entfernt, eine Größenobergrenze gibt es nicht — [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts), [desktop-app/src/main/services/cache.service.ts](../../desktop-app/src/main/services/cache.service.ts)
- Der Cache-Schlüssel für Live-Kacheln enthält Quelle, Zoom und Kachel, aber keinen Bildstand (`…:live:z/y/x`) — [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts)
- Retries: 2 Wiederholungen bei 408/425/429/5xx, 15 s Timeout — [desktop-app/src/main/services/http.service.ts](../../desktop-app/src/main/services/http.service.ts)

**Fehlerbehandlung**
- Fehlende Kacheln werden grau gefüllt; erst unter 50 % gültiger Kacheln wechselt die Zoomstufe. `validTileCount` wird nur in `site-check` und `location-report` ausgewertet, nicht in der Analyse — [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts)
- Fehlgeschlagene Inferenzfenster werden ohne Hinweis übersprungen; `runWindow` hat kein Timeout — [desktop-app/src/main/services/detection.service.ts](../../desktop-app/src/main/services/detection.service.ts)
- Schlägt die Bildauswahl fehl, nutzt die Aufnahme stillschweigend Esri ohne Provenienz (`imagery = undefined`) — [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts)

**Speicher und Worker**
- Alle Fensterausschnitte werden sofort beim Planen kopiert (`crops.map(… this.extractCrop(…))`) und per `postMessage` an die Worker gegeben — [desktop-app/src/main/services/detection.service.ts](../../desktop-app/src/main/services/detection.service.ts)
- `resetDetector()` setzt nur die Referenz auf `null`; in `detection.service.ts` gibt es keinen `kill`- oder `dispose`-Aufruf für die Worker, und der `before-quit`-Handler schließt nur Agent-Gateway und Datenbank — [desktop-app/src/main/services/detection.service.ts](../../desktop-app/src/main/services/detection.service.ts), [desktop-app/src/main/index.ts](../../desktop-app/src/main/index.ts)
- Die Worker laufen mit `enableCpuMemArena: true` und bleiben für die Sitzung bestehen — [desktop-app/src/main/workers/onnx-inference.worker.ts](../../desktop-app/src/main/workers/onnx-inference.worker.ts)
- Die weite Aufnahme kostet laut Code "about 2.3× the tiles and inference time" — [desktop-app/src/main/services/tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts)

### Inferences
- **Cache gegen Datum:** Esri kann die Szene wechseln, während die App 30 Tage alte Kacheln mit 7 Tage alten oder frischen Metadaten kombiniert. Dann steht ein neues Aufnahmedatum an einem alten Bild oder umgekehrt. Abhilfe: Kachel-TTL an die Metadaten-TTL koppeln oder den Cache-Schlüssel um einen Bildstand erweitern (Esri: `release`/`SRC_DATE` aus dem Identify, DOP: Flugdatum).
- **Rechtlich:** Für Esri wurde keine Klausel gefunden, die automatische Auswertung von World Imagery ausdrücklich erlaubt oder verbietet. Das schlüssellose Abrufen, 30 Tage Vorhalten und maschinelle Zählen ist deshalb ungeklärt; die offenen Länder-DOP sind die risikoarme Standardquelle. Jede neue Länderquelle (ST, HH) verkleinert die Esri-Abhängigkeit.
- **Speicher:** Bei 125 m Radius entsteht rechnerisch ein Mosaik von ca. 3.584 px Kantenlänge (51 MB RGBA), nach Umrechnung ca. 64 Fenster zu je 1,6 MB, also gut 100 MB zusätzliche Kopien plus IPC-Klone; bei 190 m ca. 4.864 px (95 MB) und rund 100 Fenster. Ausschnitte erst unmittelbar vor dem Senden zu erzeugen begrenzt das auf wenige Fenster je Worker.
- **Worker-Leck:** Nach einer Modellinstallation im Assistenten (`resetDetector`) bleiben die alten Prozesse mit geladenem Modell vermutlich bis zum App-Ende bestehen; ein `dispose()` am Detektor, das die Prozesse beendet, behebt das.
- **Sichtbarkeit:** Graue Kacheln und übersprungene Fenster senken die Zählung unbemerkt. Beides sollte als Eintrag in `evidence.limitations` landen (Anteil gültiger Kacheln, Anzahl fehlgeschlagener Fenster); die Felder existieren bereits.
- **Lastverhalten:** Ohne hostweite Grenze addieren sich parallele Analysen bei einem Portfolio-Import auf mehrere × 8 Anfragen je Dienst. Einträge für die Bildhosts in `HOST_POLICIES` (z. B. 6–8 gleichzeitig) und ein kurzer Negativ-Cache für 4xx-Kacheln sind kleine Änderungen.
- **Eingebrannte Vermerke:** Texte in Kacheln (MV, vDOP-Wasserzeichen, basemap.at-Flugjahr) erzeugen Fehlerkennungen; solche Kacheln gehören als harte Negative ins Studio und Dienste mit Wasserzeichen nicht in die Erkennung.

### Gaps
- Ob Esri den schlüssellosen Zugriff auf `server.arcgisonline.com` für Drittanwendungen duldet oder ein Konto verlangt, konnte nicht geklärt werden (Entwickler-Bedingungen und Community-Antwort nicht abrufbar).
- Der Text des Esri Master License Agreement zu automatisierter Analyse und Caching wurde nicht gelesen.
- Nutzungsbedingungen des BKG für `wms_info` und Abruflimits der Länderdienste wurden nicht geprüft.
- Tatsächlicher Speicherverbrauch und die Zahl parallel laufender Analysen wurden nicht gemessen (nur aus dem Code gerechnet).

## 8. Priorisierte Empfehlungen (Nutzen gegen Aufwand)

### Takeaway
Zuerst die vier kleinen Korrekturen mit direkter Wirkung auf Datum und Quelle (Länder-Infolayer, Bremen/Berlin, Bayern-Zoom, ST/HH), dann die Angleichung von App-Bild und Benchmark, danach die Zeitreihe auf Länder-DOP. Beschleuniger und Auslandsquellen lohnen erst danach.

### Cited Findings
Rangfolge; die Belege stehen in den genannten Abschnitten.

| Rang | Maßnahme | Betroffene Dateien | Nutzen | Aufwand | Beleg |
|---|---|---|---|---|---|
| 1 | Flugdatum aus dem Infolayer des Landes lesen, BKG nur als Rückfall | [imagery-source.service.ts](../../desktop-app/src/main/services/imagery-source.service.ts), [imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts), [docs/imagery-sources.md](../../docs/imagery-sources.md) | hoch: Datum war in Köln und München 2 Jahre falsch | klein bis mittel (Parser je Land) | Abschnitt 1, 2 |
| 2 | Bremen und Berlin: Jahrgang passend zum Datum wählen statt Datum zurückhalten; Berlin 2025 aufnehmen | [imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts), [imagery-source.service.ts](../../desktop-app/src/main/services/imagery-source.service.ts), [fetch_tiles.py](../../training/fetch_tiles.py) | hoch für HB (10-cm-DOP wird wieder nutzbar) | klein | Abschnitt 1 |
| 3 | `maxZoom` je Dienst (Bayern 19) | [imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts), [tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts) | mittel: spart ca. 170–200 Fehlanfragen je Analyse in Bayern | klein | Abschnitt 1 |
| 4 | Sachsen-Anhalt und Hamburg einbinden | [imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts), [fetch_tiles.py](../../training/fetch_tiles.py) (`select_sites.py` liest `SERVICES` von dort), Doku | hoch: zwei Länder von Esri auf DOP20 | klein (HH braucht `TIME`) | Abschnitt 1, 2 |
| 5 | Lizenzangabe Thüringen korrigieren (CC BY 4.0) | [imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts), [fetch_tiles.py](../../training/fetch_tiles.py) | klein, aber Pflicht | sehr klein | Abschnitt 1 |
| 6 | Kachel-Cache an Bildstand koppeln; Negativ-Cache; `HOST_POLICIES` für Bildhosts | [tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts), [http.service.ts](../../desktop-app/src/main/services/http.service.ts), [cache.service.ts](../../desktop-app/src/main/services/cache.service.ts) | mittel: Datum und Bild passen sicher zusammen, weniger Last | klein | Abschnitt 7 |
| 7 | Teilbilder und fehlgeschlagene Fenster in `limitations` ausweisen; Fenster-Timeout | [detection.service.ts](../../desktop-app/src/main/services/detection.service.ts), [tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts), [vehicle-timeline.service.ts](../../desktop-app/src/main/services/vehicle-timeline.service.ts) | mittel: stille Unterzählung wird sichtbar | klein | Abschnitt 3, 7 |
| 8 | Benchmark auf zusammengesetzten 3 × 3-Mosaiken durch die App-Pipeline, mit Bootstrap-Intervall; kleiner Esri-Satz nur zum Messen | [detection-sweep.run.test.ts](../../desktop-app/src/main/services/detection/detection-sweep.run.test.ts), [detection-benchmark.ts](../../desktop-app/src/main/services/detection-benchmark.ts), [docs/detection-benchmark.md](../../docs/detection-benchmark.md) | hoch: Grundlage für jede weitere Modell- und Schwellenentscheidung | mittel | Abschnitt 3 |
| 9 | WMS-Aufnahme als wenige große GetMap-Kacheln in Modellauflösung | [tiles.service.ts](../../desktop-app/src/main/services/tiles.service.ts), [imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts) | mittel bis hoch: App-Bild gleich Trainingsbild, 20–40× weniger Anfragen | mittel (Cache, Kartenansicht bleibt bei 256 px) | Abschnitt 5 |
| 10 | Zeitreihe: historische Länder-DOP als Kandidaten (NRW, BY, NI, RP, HB, HH, BE); Radius wie Analyse; z19-Fortsetzung; Eckenprüfung der Szene; Doku "100 m" korrigieren | [vehicle-timeline.service.ts](../../desktop-app/src/main/services/vehicle-timeline.service.ts), [wayback.service.ts](../../desktop-app/src/main/services/wayback.service.ts), [imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts), [docs/imagery-sources.md](../../docs/imagery-sources.md) | hoch in NRW (10 cm, Tagesdatum), mittel sonst | mittel bis hoch | Abschnitt 6 |
| 11 | Fensterausschnitte verzögert erzeugen; Worker beim Detektorwechsel beenden | [detection.service.ts](../../desktop-app/src/main/services/detection.service.ts) | mittel bei großen Höfen und schwachen Rechnern | klein | Abschnitt 7 |
| 12 | Studio: historische Jahrgänge und ST/HH als Kachelquelle; DLR-Link reparieren; mehr große Fahrzeuge | [fetch_tiles.py](../../training/fetch_tiles.py), [convert_public.py](../../training/convert_public.py), [training/README.md](../../training/README.md) | mittel: Vielfalt ohne Lizenzrisiko | klein bis mittel plus Labelzeit | Abschnitt 3, 4 |
| 13 | Ausführungsprovider CoreML/DirectML mit CPU-Rückfall; 1024-px-Export; INT8 nur nach Messung | [onnx-inference.worker.ts](../../desktop-app/src/main/workers/onnx-inference.worker.ts), [export.py](../../training/export.py) | unklar, nur Tempo | klein, aber Messaufwand | Abschnitt 5 |
| 14 | Auslandsquellen (NL 8 cm, CH 10 cm, LU, Flandern, FR) | [imagery-sources.ts](../../desktop-app/src/shared/imagery-sources.ts), [imagery-source.service.ts](../../desktop-app/src/main/services/imagery-source.service.ts) | hoch nur bei Auslandsportfolios | hoch (Regionsmodell, Datumsquellen) | Abschnitt 2 |
| 15 | TTA mit Mehrheitsregel, dichte-abhängiges NMS | [detection.service.ts](../../desktop-app/src/main/services/detection.service.ts), [yolo.ts](../../desktop-app/src/main/services/detection/yolo.ts) | gering bis unklar | mittel, 2–8× Rechenzeit | Abschnitt 5 |

### Inferences
- Die Ränge 1–5 ändern für manche Standorte die gewählte Quelle oder das Datum und damit Zählung und Hagel-EAL. Nach den Repo-Regeln brauchen sie eine kurze Methodiknotiz in [docs/imagery-sources.md](../../docs/imagery-sources.md) und deterministische Tests (`imagery-sources.test.ts`, `imagery-source.service.test.ts`).
- Rang 8 sollte vor Rang 9, 13 und 15 stehen: Ohne End-to-End-Messung lässt sich nicht zeigen, ob diese Änderungen die Zählung verbessern oder verschlechtern.
- Keine Maßnahme braucht neue UI-Bausteine, einen Cloud-Dienst mit Schlüssel oder ein LLM. Neue Hosts stehen in Abschnitt 2.
- Rang 10 ist an der Grenze zwischen "neue Datenquelle in bestehender Funktion" und "Funktionserweiterung"; die Kandidaten nutzen aber vorhandene Typen (`ImageryCandidate`, `VehicleTimelineCount`) und dieselbe Anzeige.

### Gaps
- Die Nutzen-Einschätzungen sind nicht gemessen; sie beruhen auf zwei Datumsstichpunkten, Codeanalyse und den Benchmark-Zahlen des Repos.
- Wie viele Standorte in typischen Portfolios in HB, HH, ST, BY liegen, ist nicht bekannt; davon hängt der reale Nutzen der Ränge 2–4 ab.
