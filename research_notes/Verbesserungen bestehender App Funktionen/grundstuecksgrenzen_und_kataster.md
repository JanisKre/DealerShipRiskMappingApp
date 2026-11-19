# Grundstücksgrenzen, Kataster und amtliche Gebäude: Verbesserungen an bestehenden Funktionen (Stand 19. November 2026)

Hinweise zur Lesart:

- "Live geprüft" heißt: am 19.11.2026 mit `curl` (neutraler User-Agent, Koordinaten von Stadtzentren, keine Projekt- oder Kundendaten) ein GetCapabilities und, wo angegeben, ein GetFeature abgesetzt. Die verlinkte URL ist die geprüfte Anfrage oder ihr Dienst-Endpunkt.
- Repo-Pfade sind relativ zur Notizdatei verlinkt (Repo-Wurzel = `../../`).
- Die Gesamt-Rangliste aller Empfehlungen (Nutzen gegen Aufwand) und die Liste der Hosts stehen am Ende des letzten Abschnitts unter "Inferences".
- Rahmen: keine neuen Funktionen, keine neuen UI-Bausteine, alles deterministisch ohne LLM. Jede Empfehlung nennt die betroffene Datei.

## Frage 1: Welche Bundesländer (und Länder) sind heute durch Flurstücke, Gebäude, Nutzung und Adresspunkte abgedeckt, welche nicht? (Abdeckungsmatrix)

### Takeaway

Flurstücksgeometrie gibt es im Code für alle 16 Länder (Bayern nur aus der gerenderten Parzellarkarte), aber die Zusatzattribute haben Lücken: Nutzung fehlt in 6 Ländern (BB, BE, HB, HE, SH, SL), Gebäudefunktion in 6 (BB, BW, MV, SH, SN, ST), Gebäude ganz in 2 (HH, SL), Hauskoordinaten in 8 (BY, HB, HE, HH, NW, RP, ST, TH). Für fast alle diese Lücken antwortet heute ein offener Dienst auf einem Host, den die App schon benutzt; außerhalb Deutschlands hat die App keine Flurstücksquelle.

### Cited Findings

**Matrix Ist-Zustand (Code) gegen offen verfügbar (live geprüft 19.11.2026).** "FN" = Feature-Typ `ave:NutzungFlurstueck` (Nutzungsabschnitt je Flurstück mit Geometrie), "GB" = `ave:GebaeudeBauwerk` (Gebäude mit Funktion), "AD" = INSPIRE `ad:Address`.

| Land | Flurstücke: heute | Nutzung: heute → verfügbar | Gebäude: heute → verfügbar | Adresspunkte: heute → verfügbar |
| --- | --- | --- | --- | --- |
| BW | INSPIRE `cp:CadastralParcel`, Adresse/Nutzung aus `nora:`-Layern | Anteile per 14×14-Raster → unverändert | INSPIRE ohne Funktion → `nora:v_al_gebaeude` mit `gebaeudefunktion_id/_name` | INSPIRE AD (abgedeckt) |
| BY | Raster-Parzellarkarte (0,25 m/px), keine Vektoren | aus Füllfarbe; offene Abschnitte ≥ 100 m² als eigene Einheit | LoD2-Kacheln (mit Funktion) | keine → keine offene Quelle gefunden |
| BE | `alkis_flurstuecke:flurstuecke`, nur Geometrie | keine → `alkis:tatsaechlichenutzungflaechen` (`bezeich`, `bezfkt`) | `alkis_gebaeude:gebaeude` (Funktion teilweise) | `adressen_berlin` (abgedeckt) |
| BB | `ave:Flurstueck` (Adresse, kein `tntxt`) | keine → FN mit `nutzart`/`bez`/`flstkennz` | INSPIRE ohne Funktion → GB mit `funktion`/`gfkzshh` | INSPIRE AD (abgedeckt) |
| HB | `adv:AX_Flurstueck`, nur Geometrie | keine → nur über einzelne `adv:AX_*`-Nutzungstypen (nicht geprüft) | `adv:AX_Gebaeude` (mit Funktion) | keine → `AX_LagebezeichnungMitHausnummer` hat nur Schlüssel, keine Geometrie |
| HH | `ave:Flurstueck` (Adresse + Nutzung) | Anteile aus `tntxt` → zusätzlich FN | **keine** → GB mit Funktion (WFS und OGC API) | keine → Adresse am Gebäude (`lagebeztxt` in GB) |
| HE | `ave:Flurstueck` (Adresse, kein `tntxt`) | keine → FN | NAS `adv:AX_Gebaeude` (mit Funktion) | keine → Adresse am Gebäude (`lagebeztxt` in GB) |
| MV | `ave:Flurstueck` UTM 33 (Adresse + Nutzung) | Anteile → FN laut Capabilities | INSPIRE ohne Funktion → GB mit Funktion | INSPIRE AD (abgedeckt) |
| NI | `ave:Flurstueck` (Adresse + Nutzung) | Anteile → FN | `adv:AX_Gebaeude` (mit Funktion) | INSPIRE AD (abgedeckt) |
| NW | `ave:Flurstueck` (Adresse + Nutzung) | Anteile → FN (WFS und OGC API) | GB (mit Funktion) | **keine** → INSPIRE AD `wfs_nw_inspire-adressen_gebref` |
| RP | `ave:Flurstueck` (Adresse + Nutzung) | Anteile → `ave:Nutzung` (Flächen, ohne Flurstücksbezug) | GB (mit Funktion) | keine → Adresse am Gebäude (`lagebeztxt` in GB) |
| SL | INSPIRE `cp:CadastralParcel`, nur Geometrie | keine → INSPIRE `elu:ExistingLandUseObject` (HILUCS) | **keine** → INSPIRE `bu-core2d:Building` | INSPIRE AD (abgedeckt) |
| SN | `ave:Flurstueck` (Adresse + Nutzung) | Anteile → FN | INSPIRE ohne Funktion → GB mit Funktion und `lagebeztxt` | INSPIRE AD (abgedeckt) |
| ST | `ave:Flurstueck` (Adresse + Nutzung) | Anteile → FN laut Capabilities | INSPIRE ohne Funktion → GB mit Funktion | keine → Adresse am Gebäude (`lagebeztxt` in GB) |
| SH | `ave:Flurstueck` per Stored Query (nur Adresse) | keine → `ave:Nutzung` steckt schon in derselben Antwort | INSPIRE ohne Funktion → GB steckt schon in derselben Antwort | INSPIRE AD (abgedeckt) |
| TH | `ave:Flurstueck` (Adresse + Nutzung) | Anteile → `ave:Nutzung` (kein FN) | GB (mit Funktion) | keine → INSPIRE AD `INSPIREad_wfs` (nur Capabilities geprüft) |

- Flurstücksendpunkte, CRS und Fallbacks je Land stehen in der Tabelle `ALKIS_ENDPOINTS` — [alkis.service.ts](../../desktop-app/src/main/services/alkis.service.ts)
- "Addresses are now published for 12 states and land use for 9; Berlin and Bremen remain geometry-only, Bayern has parcels from the parcel map" — [docs/boundary-model.md, Cascade v10](../../docs/boundary-model.md)
- Gebäude: 13 WFS-Länder plus Bayern (LoD2); mit Funktion NW, TH, RP, NI, HB, HE, BE (teilweise), BY; ohne Funktion SN, MV, SH, ST, BB, BW; nicht abgedeckt Hamburg und Saarland — [docs/official-buildings.md](../../docs/official-buildings.md), [alkis-buildings.service.ts](../../desktop-app/src/main/services/alkis-buildings.service.ts)
- Hauskoordinaten: NI, SN, SH, BB, MV, BW, SL, BE; nicht abgedeckt HH, NW, HE, TH, RP, ST, HB, BY — [docs/official-buildings.md](../../docs/official-buildings.md), [house-coordinates.service.ts](../../desktop-app/src/main/services/house-coordinates.service.ts)
- Kataster-Overlay (WMS, nur Anzeige): 15 Länder, Saarland fehlt — [docs/cadastre-overlay.md](../../docs/cadastre-overlay.md)
- Außerhalb Deutschlands: "in Austria the answer is the outline of the detected vehicles, a cached OSM dealer area or the circle" — [docs/boundary-model.md, Limitations](../../docs/boundary-model.md)
- Die Capabilities der vereinfachten ALKIS-Dienste listen `ave:Flurstueck, ave:FlurstueckPunkt, ave:GebaeudeBauwerk, ave:KatasterBezirk, ave:Nutzung, ave:NutzungFlurstueck, ave:VerwaltungsEinheit` in NW, SN, NI, SH, ST, BB, HE, MV; Thüringen ohne `NutzungFlurstueck` und `FlurstueckPunkt`; RLP nur `Flurstueck`, `GebaeudeBauwerk`, `Nutzung` (live geprüft) — z. B. [Sachsen GetCapabilities](https://geodienste.sachsen.de/aaa/public_alkis/vereinf/wfs?service=WFS&version=2.0.0&request=GetCapabilities), [Thüringen](https://www.geoproxy.geoportal-th.de/geoproxy/services/adv_alkis_wfs?service=WFS&version=2.0.0&request=GetCapabilities), [RLP](https://geo5.service24.rlp.de/wfs/alkis_rp.fcgi?service=WFS&version=2.0.0&request=GetCapabilities)
- 15 von 16 Ländern stellen ALKIS vollständig oder im vereinfachten Schema als Open Data bereit; "Lediglich Bayern schert hier ... aus" (Vortragsankündigung, keine amtliche Quelle) — [FOSSGIS 2025, "Open ALKIS?"](https://pretalx.com/fossgis2025/talk/TRJW9F/)

### Inferences

- Die größte Lücke ist nicht mehr die Geometrie, sondern die Attributierung: Die Regeln ab v9 (Straße nach Nutzung, gleiche Adresse, fremde Nutzung) greifen in BE, HB, SL gar nicht und in BB, HE, SH nur mit Adresse. Genau dort liefern FN, `ave:Nutzung`, Berlins Nutzungsflächen und Saarlands INSPIRE-Bodennutzung die fehlende Nutzung.
- Der Gebäudedienst ist in sechs Ländern unnötig schwach gewählt: Dieselben Hosts, die schon die Flurstücke liefern, bieten GB mit Funktion; der INSPIRE-Dienst ohne Funktion könnte Fallback bleiben (gleiches Muster wie `fallback` bei den Flurstücken).
- Hamburg und Saarland lassen sich bei den Gebäuden schließen, Nordrhein-Westfalen und wahrscheinlich Thüringen bei den Hauskoordinaten, jeweils mit dem Schema, das der Code schon liest.

### Gaps

- Bremen: Ob sich aus den `adv:AX_*`-Nutzungstypen von `alkishb_wfs_sf` mit vertretbarem Aufwand Nutzung je Flurstück bilden lässt, wurde nicht geprüft; ein vereinfachter Dienst `alkishb_wfs_einfach` existiert nicht (HTTP 400 "keine interne URL gefunden").
- Sachsen-Anhalt, Hessen, Rheinland-Pfalz: Kein offener INSPIRE-Adress-WFS gefunden (drei geratene ST-Pfade antworteten 403/404). Die Aussage "kein Dienst" ist damit nicht belegt, nur "nicht gefunden".
- Bayern: Hauskoordinaten als Open Data nicht gefunden; die OpenData-Startseite nennt keine Produktliste im abrufbaren Text.

## Frage 2: Gibt es für die nicht (voll) abgedeckten Bundesländer offene ALKIS-WFS / OGC-API-Features-Dienste für Flurstücke und Gebäude? (Endpunkte, Feature-Typen, Lizenzen, Erreichbarkeit)

### Takeaway

Ja. Alle unten genannten Dienste haben am 19.11.2026 geantwortet. Die drei ergiebigsten Funde: (a) `ave:NutzungFlurstueck` liefert den Nutzungsschnitt innerhalb eines Flurstücks, den v12 nur in Bayern hat und der in BB und HE zugleich die fehlende Nutzung bringt; (b) `ave:GebaeudeBauwerk` gibt Gebäudefunktion für SN, ST, BB, MV, SH und erstmals Gebäude für Hamburg; (c) Schleswig-Holsteins Stored-Query-Antwort enthält Gebäude und Nutzung bereits, die App wirft sie weg.

### Cited Findings

**A. Nutzungsabschnitte je Flurstück (`ave:NutzungFlurstueck`)**

- GetFeature mit BBOX lieferte je 40 Features mit `nutzart`, `bez`, `flstkennz` und Flächengeometrie (`gml:MultiSurface`/`Polygon`) in Sachsen, Hessen, Brandenburg, Niedersachsen, NRW und Hamburg; Beispiel Hessen: `nutzart=Straßenverkehr; name=Braubachstraße; flstkennz=060460011000100007__`, Beispiel Brandenburg: `nutzart=Industrie- und Gewerbefläche; bez=Handel und Dienstleistung` — [Sachsen](https://geodienste.sachsen.de/aaa/public_alkis/vereinf/wfs?service=WFS&version=2.0.0&request=GetCapabilities), [Hessen](https://www.gds.hessen.de/wfs2/aaa-suite/cgi-bin/alkis/vereinf/wfs?service=WFS&version=2.0.0&request=GetCapabilities), [Brandenburg](https://isk.geobasis-bb.de/ows/alkis_vereinf_wfs?service=WFS&version=2.0.0&request=GetCapabilities), [Niedersachsen](https://opendata.lgln.niedersachsen.de/doorman/noauth/alkis_wfs_einfach?service=WFS&version=2.0.0&request=GetCapabilities), [NRW](https://www.wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht?service=WFS&version=2.0.0&request=GetCapabilities), [Hamburg](https://geodienste.hamburg.de/WFS_HH_ALKIS_vereinfacht?service=WFS&version=2.0.0&request=GetCapabilities)
- Die Projektdoku nennt genau diese Quelle als offen: "Sub-parcel land use (`ave:NutzungFlurstueck`) would give the same cut as in Bayern and is not read yet" — [docs/boundary-model.md, Limitations of v12](../../docs/boundary-model.md)
- Der Schlüssel zum Flurstück ist `flstkennz`; `ave:Flurstueck` trägt ihn ebenfalls (NRW-Beispiel: `flstkennz=05123900100477______`, dazu `flaeche`, `aktualit`, `gemarkung`, `lagebeztxt`, `tntxt`), der Parser liest heute nur `lagebeztxt` und `tntxt` — [NRW GetFeature ave:Flurstueck](https://www.wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht?service=WFS&version=2.0.0&request=GetCapabilities), [alkis.service.ts `parseParcelFeatures`](../../desktop-app/src/main/services/alkis.service.ts)
- Hamburg schreibt die Nutzungsnamen anders ("Industrie Und Gewerbeflaeche", "Strassenverkehr"); `classifyLandUse` normalisiert Umlaute und Kleinschreibung bereits — [Hamburg](https://geodienste.hamburg.de/WFS_HH_ALKIS_vereinfacht?service=WFS&version=2.0.0&request=GetCapabilities), [alkis.service.ts `normaliseUse`](../../desktop-app/src/main/services/alkis.service.ts)
- Rheinland-Pfalz: kein FN; `ave:Nutzung` lieferte 18 Flächen mit `nutzart` (ohne Flurstücksbezug). Der separate Dienst "WFS RP ALKIS vereinfacht Flurstuecksabschnitte" (`ave:Flurstuecksabschnitte`, dl-de/by-2-0) lieferte Attribute `flstkennz`, `flaeche`, `tng` ("1381 m² Friedhof"), in der Probeantwort aber keine Flächengeometrie — [RLP alkis_rp](https://geo5.service24.rlp.de/wfs/alkis_rp.fcgi?service=WFS&version=2.0.0&request=GetCapabilities), [RLP fav_rp](https://geo5.service24.rlp.de/wfs/fav_rp.fcgi?service=WFS&version=2.0.0&request=GetCapabilities), [Dienstliste RLP](https://www.geoportal.rlp.de/spatial-objects/?f=json)
- Berlin: Der Sammeldienst `gdi.berlin.de/services/wfs/alkis` hat `alkis:tatsaechlichenutzungflaechen` (30 Features, `bezeich=AX_IndustrieUndGewerbeflaeche`, `bezfkt=Handel und Dienstleistung`), `alkis:gebaeudeflaechen` und `alkis:flurstuecke`; der Einzeldienst `alkis_tatsaechlichenutzungflaechen` antwortet 404 — [Berlin alkis](https://gdi.berlin.de/services/wfs/alkis?service=WFS&version=2.0.0&request=GetCapabilities)
- Saarland: INSPIRE `elu:ExistingLandUseObject` lieferte 5 Features mit HILUCS-Codes (z. B. `5_1_PermanentResidentialUse`, `3_TertiaryProduction`), dl-de/by-2-0 — [Saarland Existierende Bodennutzung](https://geoportal.saarland.de/gdi-sl/inspirewfs_Existierende_Bodennutzung_ALKIS?service=WFS&version=2.0.0&request=GetCapabilities)

**B. Gebäude mit Funktion (`ave:GebaeudeBauwerk`, `nora:v_al_gebaeude`, INSPIRE BU)**

- Sachsen: 25 Gebäude, `funktion` und `gfkzshh` (z. B. `31001_2460` "Gebäude zum Parken"), dazu `lagebeztxt` ("Altmarkt 4, 5, 6; ...") — [Sachsen](https://geodienste.sachsen.de/aaa/public_alkis/vereinf/wfs?service=WFS&version=2.0.0&request=GetCapabilities)
- Sachsen-Anhalt: 32 Gebäude mit `funktion`; Tiefgarage als `gebnutzbez=Bauteil; funktion=Tiefgarage; rellage=Unter der Erdoberfläche` — [Sachsen-Anhalt](https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_ALKIS_WFS_OpenData/guest?service=WFS&version=2.0.0&request=GetCapabilities)
- Brandenburg: 40 von 184 Gebäuden zurück, `funktion`/`gfkzshh`, `numberMatched` gesetzt — [Brandenburg](https://isk.geobasis-bb.de/ows/alkis_vereinf_wfs?service=WFS&version=2.0.0&request=GetCapabilities)
- Mecklenburg-Vorpommern: 30 von 142 Gebäuden, BBOX in EPSG:25833, `funktion`, `gfkzshh`, `lagebeztxt` — [MV](https://www.geodaten-mv.de/dienste/alkis_wfs_einfach?service=WFS&version=2.0.0&request=GetCapabilities)
- Hamburg: 40 Gebäude/Bauteile mit `funktion`/`gfkzshh` per BBOX über den vereinfachten Dienst; der bisher probierte INSPIRE-Dienst scheitert laut Doku an jedem BBOX-Request. `numberReturned="0"` wie bei den Flurstücken; Bauteile ("Arkade", "Durchfahrt im Gebäude", "Überdachung", "Keller" mit `rellage=Unter der Erdoberfläche`) kommen als eigene Features — [Hamburg WFS](https://geodienste.hamburg.de/WFS_HH_ALKIS_vereinfacht?service=WFS&version=2.0.0&request=GetCapabilities), [docs/official-buildings.md](../../docs/official-buildings.md)
- Hamburg als OGC API Features (GeoJSON, `numberMatched`, `next`-Link): Collections `Flurstueck, GebaeudeBauwerk, KatasterBezirk, Nutzung, NutzungFlurstueck, VerwaltungsEinheit` — [api.hamburg.de](https://api.hamburg.de/datasets/v1/alkis_vereinfacht/collections?f=json)
- NRW als OGC API Features: Collections `flurstueck, flurstueck_punkt, gebaeude_bauwerk, katasterbezirk, nutzung, nutzung_flurstueck, verwaltungseinheit`; Items mit `bbox` in lon/lat, `numberMatched` und `next`-Link — [ogc-api.nrw.de](https://ogc-api.nrw.de/lika/v1/collections?f=json)
- Schleswig-Holstein: Die Stored-Query-Antwort für eine 150-m-Box war 2,75 MB groß und enthielt 31 `Flurstueck`, 51 `GebaeudeBauwerk` (mit `funktion`), 24 `Nutzung`, 6 `KatasterBezirk`, 5 `VerwaltungsEinheit`; 2,4 MB davon sind `VerwaltungsEinheit`. `onlyFeatureMembers(text, "Flurstueck")` behält nur die Flurstücke — [SH Dienst](https://service.gdi-sh.de/WFS_SH_ALKIS_vereinf_OpenGBD?service=WFS&version=2.0.0&request=GetCapabilities), [alkis.service.ts `onlyFeatureMembers`](../../desktop-app/src/main/services/alkis.service.ts)
- Baden-Württemberg: `nora:v_al_gebaeude` mit `gebaeudefunktion_id=1123`, `gebaeudefunktion_name=Wohn- und Geschäftsgebäude`, `hochhaus`, `lage_id` (40 von 69); `nora:v_al_flurstueck` mit `flurstueckskennzeichen`, `amtliche_flaeche`; der Host ist derselbe wie für die Adress- und Nutzungslayer — [BW nora](https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_LGL-BW_ALKIS?service=WFS&version=2.0.0&request=GetCapabilities), [bw-parcel-attributes.ts](../../desktop-app/src/main/services/bw-parcel-attributes.ts)
- Saarland: INSPIRE `bu-core2d:Building` lieferte 20 Gebäude für eine Innenstadt-Box (3,1 s), ohne Funktion — [Saarland Gebäude 2D](https://geoportal.saarland.de/gdi-sl/inspirewfs_2D_Gebaeude_ALKIS?service=WFS&version=2.0.0&request=GetCapabilities), [Dienstliste Saarland](https://geoportal.saarland.de/spatial-objects/?f=json)

**C. Adressen**

- NRW: `wfs_nw_inspire-adressen_gebref` hat `ad:Address`, `ad:ThoroughfareName`, `ad:PostalDescriptor`, `ad:AdminUnitName`. Ein FES-Filter aus BBOX und Hausnummer "1" (dieselbe Filterform wie `addressFilter`) lieferte 30 Treffer, alle mit Designator "1", Positionen als `gml:pos` in lat/lon — [NRW INSPIRE Adressen](https://www.wfs.nrw.de/geobasis/wfs_nw_inspire-adressen_gebref?service=WFS&version=2.0.0&request=GetCapabilities), [house-coordinates.service.ts `addressFilter`](../../desktop-app/src/main/services/house-coordinates.service.ts)
- Thüringen: `INSPIREad_wfs` antwortet mit Capabilities (`ad:Address`, `ad:ThoroughfareName`, ...; CC BY 4.0, "© GDI-Th"; DefaultCRS EPSG:25832). GetFeature mit Filter wurde nicht geprüft — [Thüringen INSPIRE Adressen](https://www.geoproxy.geoportal-th.de/geoproxy/services/INSPIREad_wfs?service=WFS&version=2.0.0&request=GetCapabilities)
- Adresse am Gebäude: `lagebeztxt` steht in GB bei 40/40 (TH), 28/28 (RP), 29/32 (ST), 22/40 (HH), 18/40 (HE), 13/40 (NW), 23/40 (BB), 19/25 (SN) der Probe-Features. NW, TH und RP ruft die App für die Dachmaske bereits ab und verwirft das Feld — [alkis-buildings.service.ts `parseOfficialBuildings`](../../desktop-app/src/main/services/alkis-buildings.service.ts), [Thüringen](https://www.geoproxy.geoportal-th.de/geoproxy/services/adv_alkis_wfs?service=WFS&version=2.0.0&request=GetCapabilities)
- Bremen: `adv:AX_LagebezeichnungMitHausnummer` liefert `lage=48390; hausnummer=94` ohne Straßennamen und ohne Geometrie — [Bremen alkishb_wfs_sf](https://opendata.lgln.niedersachsen.de/doorman/noauth/alkishb_wfs_sf?service=WFS&version=2.0.0&request=GetCapabilities)

**D. Lizenzen und Quellenvermerke (aus den Capabilities, live gelesen)**

| Land | Lizenz | Geforderter Vermerk (Wortlaut aus dem Dienst) |
| --- | --- | --- |
| NW | dl-de/zero-2-0 | keiner ("Jede Nutzung ist ohne Einschränkungen oder Bedingungen zulässig") |
| BE | dl-de/zero-2-0 | keiner |
| HE | frei nach § 24 HVGG | keiner ("ohne Einschränkung oder Bedingung erlaubt") |
| NI | CC BY 4.0 | "LGLN (Jahr) ... CC BY 4.0" |
| HB | CC BY 4.0 | "GeoBremen (Jahr) ... CC BY 4.0" |
| SH | CC BY 4.0 | "© GeoBasis-DE/LVermGeo SH/CC BY 4.0" |
| TH | CC BY 4.0 | "© GDI-Th" |
| BB | dl-de/by-2-0 | "© GeoBasis-DE/LGB, dl-de/by-2-0, (Daten geändert)" |
| BW | dl-de/by-2-0 | "LGL-BW (Jahr) Datenlizenz Deutschland - Namensnennung - Version 2.0, www.lgl-bw.de" |
| RP | dl-de/by-2-0 | "©GeoBasis-DE / LVermGeoRP (Jahr), dl-de/by-2-0, http://www.lvermgeo.rlp.de [Daten bearbeitet]" |
| SL | dl-de/by-2-0 | "© GeoBasis DE/LVGL-SL (Jahr), dl-de/by-2-0, www.lvgl.saarland.de" |
| SN | kostenfrei mit Quellenangabe | "Landesamt für Geobasisinformation Sachsen (GeoSN)" |
| MV | Quellenvermerk Pflicht | "© GeoBasis-DE/M-V <Jahr der letzten Datenlieferung>" |
| HH | keine Zugriffsbeschränkung | "Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV)" |
| ST | verweist auf Nutzungsbedingungen | Capabilities nennen `lvermgeo.sachsen-anhalt.de/de/nutzungsbedingungen.html` und unter "Fees" die Kostenverordnung; die Overlay-Doku führt dl-de/by-2-0 |

- Quelle aller Zeilen: die Felder `Fees` und `AccessConstraints` der jeweiligen GetCapabilities — z. B. [NRW](https://www.wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht?service=WFS&version=2.0.0&request=GetCapabilities), [Brandenburg](https://isk.geobasis-bb.de/ows/alkis_vereinf_wfs?service=WFS&version=2.0.0&request=GetCapabilities), [Saarland](https://geoportal.saarland.de/gdi-sl/inspirewfs_Flurstuecke_Grundstuecke_ALKIS?service=WFS&version=2.0.0&request=GetCapabilities), [Sachsen-Anhalt](https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_ALKIS_WFS_OpenData/guest?service=WFS&version=2.0.0&request=GetCapabilities), [docs/cadastre-overlay.md](../../docs/cadastre-overlay.md)

**E. Bayern**

- Flurstücke bleiben gebührenpflichtig: Die Gebührenanlage nennt laut Suchergebnis 1,80 € je Flurstück (bayernweit 970.000 €), Verwaltungsgebiete und Tatsächliche Nutzung dagegen kostenfrei über Download, API oder Dienste (Volltext nicht selbst gelesen) — [BayGebOVerm Anlage 1](https://www.gesetze-bayern.de/Content/Pdf/BayGebOVerm-ANL_1?all=False), [GVBl. 2026, Anlage GebOVerm](https://www.verkuendung-bayern.de/files/gvbl/2026/12/anhang/2013-2-9-F_GebOVerm_Anlage.pdf)
- Die Projektdoku hält denselben Stand fest (geprüft 13.11.2026: Gebühr je Flurstück, ALKIS-WFS mit Login, Hausumringe nur als Shapefile-Download) — [docs/boundary-model.md, Cascade v3 → Data sources](../../docs/boundary-model.md)
- Der kostenfreie WMS "ALKIS-Parzellarkarte" kam im Juni 2024 hinzu — [Newsletter BVV 06/2024](https://geodaten.bayern.de/odd/m/3/pdf/newsletter_archiv/2024_06.pdf)
- Live: Die Parzellarkarte bietet die Layer `by_alkis_parzellarkarte_farbe`, `_grau`, `_umr_gelb`, `_umr_schwarz`; der Nutzungs-WMS die Layer `by_alkis_tn_komplett`, `_siedlung`, `_vegetation`, `_verkehr`, `_gewaesser`, `_texte`. Geratene WFS-Pfade unter `geoservices.bayern.de/od/wfs/...` antworten 404 — [Parzellarkarte WMS](https://geoservices.bayern.de/od/wms/alkis/v1/parzellarkarte?service=WMS&request=GetCapabilities), [TN WMS](https://geoservices.bayern.de/od/wms/alkis/v1/tn?service=WMS&request=GetCapabilities)

**F. Technische Fallstricke, die beim Anbinden gelten**

- DefaultCRS ist bei allen vereinfachten Diensten projiziert (EPSG:25832 bzw. 25833 in SN, BB, MV); geografische CRS müssen per `srsName` verlangt werden; Thüringen filtert nur auf einer UTM-32-Box, MV und SH arbeiten nur in UTM — [alkis.service.ts, `AlkisEndpoint`](../../desktop-app/src/main/services/alkis.service.ts)
- Achsenreihenfolge lat/lon in EPSG:4258/4326 (WFS 2.0, URN-Schreibweise); `CQL_FILTER=INTERSECTS` wird still ignoriert, nur BBOX wirkt — [docs/boundary-model.md, Verified negative results](../../docs/boundary-model.md)
- `numberMatched="unknown"` in SN, NI, HE, HH, ST, NW (FN); `numberReturned="0"` in Hamburg trotz 40 Features — live geprüft, z. B. [Hamburg](https://geodienste.hamburg.de/WFS_HH_ALKIS_vereinfacht?service=WFS&version=2.0.0&request=GetCapabilities)
- Innenringe kommen vor: 6 `gml:interior` in 25 Dresdner Gebäuden, je 1–2 in ST, HH, NW (FN), RP (Nutzung) — live geprüft, z. B. [Sachsen](https://geodienste.sachsen.de/aaa/public_alkis/vereinf/wfs?service=WFS&version=2.0.0&request=GetCapabilities)
- Niedersachsen ignoriert `startIndex` (jede Seite ist die erste) — [docs/boundary-model.md, Cadastre coverage](../../docs/boundary-model.md)
- Antwortzeiten der Probe: 0,3–1,5 s für die vereinfachten Dienste, 2,7 s NRW FN, 2,5 s SH Stored Query, 3,1 s Saarland Gebäude; die Doku nennt für die INSPIRE-Gebäudedienste 14–20 s (SH) und etwa 6 s (BB) — [docs/official-buildings.md](../../docs/official-buildings.md)

### Inferences

- Vorschlag 1 (Nutzungsschnitt): In `alkis.service.ts` neben `ave:Flurstueck` für NW, SN, NI, HH, HE, BB (ST, MV nach kurzer GetFeature-Probe) `ave:NutzungFlurstueck` abrufen, über `flstkennz` dem Flurstück zuordnen und (1) daraus `landUse`-Anteile bilden, wo `tntxt` fehlt (HE, BB), (2) offene Abschnitte ≥ 100 m² als eigene Einheit führen, mit derselben Regel wie `splitOpenSections` in [bavaria-parcels.service.ts](../../desktop-app/src/main/services/bavaria-parcels.service.ts). Das Ergebnis bleibt auf Katasterlinien (Vorgabe aus v12). Betroffen: `alkis.service.ts` (`AlkisEndpoint`, `parseParcelFeatures`, Cache-Version `alkis:v5` → `v6`), `cascade-config.ts` (Version 14), Tests `alkis.service.test.ts`, Doku `docs/boundary-model.md`. Kein neuer Host.
- Vorschlag 2 (Gebäudefunktion): In `BUILDING_ENDPOINTS` SN, ST, BB, MV auf `ave:GebaeudeBauwerk` umstellen (MV braucht `utmZone: 33` wie bei den Flurstücken), Hamburg neu aufnehmen, BW auf `nora:v_al_gebaeude`, Saarland mit INSPIRE BU neu; die INSPIRE-Dienste als Fallback behalten. `classifyBuilding` liest `funktion`/`gfkzshh`/`rellage` schon; für BW fehlen `gebaeudefunktion_id` und `gebaeudefunktion_name` in der Feldliste, für Bauteile wie "Überdachung", "Arkade", "Durchfahrt im Gebäude" ist zu entscheiden, ob sie maskiert werden (ein Carport-Dach verdeckt Fahrzeuge, eine Durchfahrt nicht). Betroffen: [alkis-buildings.service.ts](../../desktop-app/src/main/services/alkis-buildings.service.ts), `docs/official-buildings.md`. Kein neuer Host.
- Vorschlag 3 (SH ohne Mehrabruf): Die Stored-Query-Antwort einmal parsen und `GebaeudeBauwerk` sowie `Nutzung` mit ablegen statt zu verwerfen; damit entfallen der 14–20 s langsame INSPIRE-Gebäudeabruf und die Nutzungslücke in SH. Nebeneffekt: Vor dem Cachen die 2,4 MB `VerwaltungsEinheit` nicht mit in den Speicher ziehen. Betroffen: `alkis.service.ts` (`onlyFeatureMembers`), `alkis-buildings.service.ts`.
- Vorschlag 4 (Nutzung für BE, SL, TH, RP): Flächenlayer ohne Flurstücksbezug mit dem vorhandenen Raster-Sampling aus `sampleLandUse` (BW) zuordnen: Berlin `alkis:tatsaechlichenutzungflaechen` (`bezeich` → Klasse), Saarland `elu:ExistingLandUseObject` (HILUCS → Klasse), Thüringen/RLP `ave:Nutzung` für den Schnitt innerhalb des Flurstücks. Betroffen: [bw-parcel-attributes.ts](../../desktop-app/src/main/services/bw-parcel-attributes.ts) (verallgemeinern), `alkis.service.ts`.
- Vorschlag 5 (Hauskoordinaten): `ADDRESS_ENDPOINTS` um NRW (`kind: "inspire"`, geprüft) und Thüringen (nach GetFeature-Probe; DefaultCRS 25832, also `srsName` 4258 verlangen) erweitern. Für HE, RP, ST, HH ließe sich die Adresse aus `lagebeztxt` der Gebäude gewinnen (Mittelpunkt des Gebäudes mit passender Adresse); das ist aufwendiger, weil die Gebäude nur 190 m um den Geocoder-Punkt geladen werden, die Hauskoordinatensuche aber 400 m abdeckt. Betroffen: [house-coordinates.service.ts](../../desktop-app/src/main/services/house-coordinates.service.ts).
- OGC API Features (NRW, Hamburg) ist als zweiter Fallback geeignet (GeoJSON, verlässliches `numberMatched`, `next`-Link statt `startIndex`), bringt aber zwei neue Hosts und einen zweiten Parser; solange der WFS läuft, ist der Nutzen gering.

### Gaps

- `ave:NutzungFlurstueck` in ST und MV nur über die Capabilities belegt, nicht per GetFeature; in SH steht der Typ in den Capabilities, die Stored-Query-Antwort enthielt aber keine solchen Features.
- Ob `ave:Flurstuecksabschnitte` (RLP) eine Geometrie liefert, ist offen (in der Probe keine `gml:Polygon`/`MultiSurface`).
- Ein FES-Filter `PropertyIsLike` auf `lagebeztxt` (serverseitige Adresssuche über Gebäude oder Flurstücke) wurde nicht geprüft.
- Paging-Verhalten (`startIndex`, `sortBy`) der neuen Feature-Typen wurde nicht geprüft.
- Bayern: Stand der Gebührenordnung nur über Suchergebnis und Projektdoku, nicht im Volltext der Anlage verifiziert.

## Frage 3: Welche bundesweiten und europäischen Quellen gibt es, die die bestehende Architektur aufnehmen kann?

### Takeaway

Eine offene bundesweite Flurstücksquelle gibt es nicht. Bundesweit nutzbar sind die basemap.de-Vektorkacheln (Gebäude, Adressen, Siedlungs- und Verkehrsflächen, Barrieren; kein Flurstückslayer) und Overture (GeoParquet, das die App schon liest). Für das Ausland antworten offene Parzellendienste in den Niederlanden, Frankreich, Tschechien und Spanien direkt per WFS/GeoJSON; Österreich bietet Vektorkacheln und einen GeoPackage-Stichtagsabzug, die Schweiz ist kantonsabhängig.

### Cited Findings

- basemap.de Web Vektor: Kacheln `https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/tiles/v2/bm_web_de_3857/{z}/{x}/{y}.pbf`, Zoom 0–15, Attribution "GeoBasis-DE"; Layer u. a. `Adresse` (Zoom 15; `strasse`, `hausnummer`, `ort`), `Gebaeudeflaeche` (ab 12; `klasse`, `lage`, `hoehe`), `Siedlungsflaeche`, `Verkehrsflaeche` (`funktion`, `nutzung`, `oberflaeche`), `Vegetationsflaeche`, `Barrierenlinie` (`funktion`, `hoehe`); kein Flurstückslayer (`Grenze_Flaeche`/`Grenze_Linie` sind Verwaltungsgrenzen) — [TileJSON](https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/tiles/v2/bm_web_de_3857/bm_web_de_3857.json), [Style](https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json)
- Der Style nennt als Quellenvermerk "© 2026 basemap.de / BKG | Datenquellen: © GeoBasis-DE"; für das Rasterprodukt führt die Projektdoku CC BY 4.0 — [Style](https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json), [docs/cadastre-overlay.md](../../docs/cadastre-overlay.md)
- Der Host `sgx.geodatenzentrum.de` wird bereits verwendet (Basiskarte, Bildquellen) — [basemapTiles.ts](../../desktop-app/src/renderer/src/components/map/basemapTiles.ts), [imagery-source.service.ts](../../desktop-app/src/main/services/imagery-source.service.ts)
- Die App hat keinen MVT-Decoder: In `package.json` stehen `hyparquet`, `hyparquet-compressors`, `sharp`, `@turf/*`, aber weder `pbf` noch `@mapbox/vector-tile` — [package.json](../../desktop-app/package.json)
- Overture, Release `2026-11-18.0` (neuester Eintrag im STAC-Katalog), Themen `addresses`, `base` (u. a. `land_use`, `land_cover`, `infrastructure`), `buildings` (`building`, `building_part`), `divisions`, `places`, `transportation` — [STAC-Katalog](https://stac.overturemaps.org/catalog.json), [Release-Katalog](https://stac.overturemaps.org/2026-11-18.0/catalog.json)
- Overture-Adressen: 41 Länder, darunter DE (19.300.594 Adressen, "only partial coverage"), AT (2.523.030), NL (9.997.689), FR (26.055.980), CH (3.306.298), DK (3.933.282); Zugriff als GeoParquet unter `s3://overturemaps-us-west-2/release/2026-11-18.0/theme=addresses/type=address/*` — [Overture Addresses Guide](https://docs.overturemaps.org/guides/addresses/)
- Overture-Lizenzen: Gebäude ODbL (OSM, Esri Community Maps, Microsoft ML Footprints, Google Open Buildings u. a.), `base` ODbL (OSM, ESA WorldCover), Adressen je Quelle (Deutschland: Länderquellen unter dl-de/by-2-0 oder dl-de/zero-2-0, u. a. Berlin, NRW, Hessen, BW, Brandenburg; Österreich: Adressregister CC BY 4.0; Niederlande: BAG CC0) — [Overture Attribution](https://docs.overturemaps.org/attribution/)
- Die App liest Overture-GeoParquet bereits per HTTP-Range-Requests (STAC → Datei-BBOX → Row-Group-Statistik) mit fester Hostliste `stac.overturemaps.org` und `overturemaps-us-west-2.s3.us-west-2.amazonaws.com` — [overture-dealers.ts](../../desktop-app/src/main/services/dealer-directory/overture-dealers.ts)
- Niederlande: BRK Kadastrale Kaart als WFS (`kadastralekaart:Perceel`, `Bebouwing`, `KadastraleGrens`, `Nummeraanduidingreeks`, `OpenbareRuimteNaam`) und OGC API Features (Collections `perceel`, `bebouwing`, ...; GeoJSON; CRS84, EPSG:28992, 3857, 4258); Lizenzlink der API: CC BY 4.0; Probe: 2 Parzellen mit `perceelnummer`, `sectie`, `kadastrale_grootte_waarde` — [PDOK OGC API](https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1/collections?f=json), [PDOK WFS](https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0?request=GetCapabilities&service=WFS)
- Niederlande Gebäude/Adressen: BAG-WFS mit `bag:pand`, `bag:verblijfsobject`, ...; "Fees: none" — [PDOK BAG WFS](https://service.pdok.nl/lv/bag/wfs/v2_0?request=GetCapabilities&service=WFS)
- Frankreich: API Carto liefert die Parzelle zu einem Punkt als GeoJSON (`idu=75104000AE0003`, `contenance=15168`); die Géoplateforme liefert per WFS `CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle` und `BDTOPO_V3:batiment` (mit `usage_1="Commercial et services"`, `nature`) als GeoJSON — [API Carto Cadastre](https://apicarto.ign.fr/api/cadastre/parcelle?geom=%7B%22type%22%3A%22Point%22%2C%22coordinates%22%3A%5B2.3522%2C48.8566%5D%7D), [Géoplateforme WFS](https://data.geopf.fr/wfs/ows?service=WFS&version=2.0.0&request=GetCapabilities)
- Österreich: Vektorkacheln `https://kataster.bev.gv.at/tiles/kataster/{z}/{x}/{y}.pbf`, Zoom 0–16, Attribution "© BEV"; Style-Layer `gst`, `gnr`, `nfl`, `kg`, `bl`, `blp`, `pg`; der GeoServer-WFS unter `data.bev.gv.at/geoserver/BEVdataKAT/wfs` meldet "WFS is disabled" — [BEV TileJSON](https://kataster.bev.gv.at/styles/kataster/tiles.json), [BEV Style](https://kataster.bev.gv.at/styles/kataster/style_basic.json)
- Österreich Bulk: Kataster-Stichtagsdaten als ein GeoPackage für ganz Österreich; laut INSPIRE-Metadaten gilt CC BY 4.0 (Angabe aus Suchergebnis, Metadatensatz mit Stichtag 01.04.2023) — [BEV Schnittstellenbeschreibung GPKG](https://www.bev.gv.at/dam/jcr:239729f2-83e1-400e-9e5f-9ff65cc02257/BEV_S_KA_Katastralmappe_Grundstuecksdaten_GPKG_V1.0.pdf), [INSPIRE-Metadaten BEV](https://inspire-geoportal.ec.europa.eu/srv/api/records/f932aec9-cbee-4c6d-a05d-9c55c66dfa23)
- Schweiz: geodienste.ch bietet die amtliche Vermessung als WFS (`ms:RESF` Liegenschaften, `ms:LCSF` Bodenbedeckung, `ms:SOSF`, `ms:HADR` u. a.; Probe in EPSG:2056 lieferte 2 Liegenschaften); "Für den Bezug des Geodienstes können Kosten anfallen. Die Gebühren werden durch die Kantone erhoben." — [geodienste.ch AV WFS](https://geodienste.ch/db/av_0/deu?SERVICE=WFS&REQUEST=GetCapabilities)
- Tschechien und Spanien: INSPIRE-WFS mit `cp:CadastralParcel` (CZ zusätzlich `cp:CadastralBoundary`), "Fees: none" bzw. "No conditions apply" — [ČÚZK](https://services.cuzk.cz/wfs/inspire-cp-wfs.asp?service=WFS&version=2.0.0&request=GetCapabilities), [Catastro](https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx?service=WFS&version=2.0.0&request=GetCapabilities)
- EuroGeographics Open Cadastral Map: Prototyp mit Daten von 15 nationalen Behörden (Juli 2025 kamen Belgien, Estland, Irland, Kroatien, Schweiz dazu); er harmonisiert INSPIRE-Open-Data und verweist für den Bezug auf die nationalen Portale; das Projekt OME2 lief bis Ende 2025 — [EuroGeographics, 28.07.2025](https://eurogeographics.org/?p=20063), [GeoConnexion](https://www.geoconnexion.com/news/ome2-adds-five-new-countries-to-final-release-of-open-cadastral-map)
- Der INSPIRE-`cp:CadastralParcel`-Parser ist vorhanden und schemaunabhängig (liest `gml:Polygon`/`PolygonPatch`, lat/lon) — [alkis.service.ts `parseExteriorRings`](../../desktop-app/src/main/services/alkis.service.ts)
- Zwei der 17 Benchmark-Fixtures liegen in Linz (Österreich), wo die App keine Flurstücksquelle hat. Laut einer Projektnotiz vom 13.11.2026 (nicht im Repo) hat der Nutzer Österreich als nicht relevant eingestuft — [boundary-public-fixtures.json](../../desktop-app/resources/benchmarks/boundary-public-fixtures.json)

### Inferences

- Für Deutschland bringt keine bundesweite Quelle bessere Flurstücke als die Länderdienste. Overture-Gebäude sind in Deutschland OSM plus ML-Umrisse und damit schlechter als ALKIS; Overture-`land_use` ist OSM. Sinnvoll sind sie nur als Auslands-Fallback für Dachmaske und Gebäude im Fahrzeugumriss (Stufe 2).
- basemap.de-Vektorkacheln wären der einzige bundesweit einheitliche Fallback für Gebäude, Adressen, Verkehrsflächen und Barrieren (auch Bayern, Hamburg, Saarland) und liegen auf einem schon benutzten Host. Dagegen spricht: neue Abhängigkeit für MVT, kartografisch aufbereitete Daten bis Zoom 15 (Generalisierung und Kachelschnitt), kein Flurstück. Nutzen gering, solange die Länderdienste aus Frage 2 angebunden werden.
- Auslandsparzellen passen am leichtesten über INSPIRE-`cp:CadastralParcel` (CZ, ES: vorhandener Parser, nur Endpunkt und Länderbox) und über GeoJSON (NL, FR: kleiner neuer Parser). Österreich verlangt MVT-Dekodierung oder einen GeoPackage-Import und ist laut Nutzer nicht relevant. Da `statesForPoint` nur deutsche Länder kennt, wäre für jedes Ausland eine Länderbox in derselben Tabelle nötig. Das ist eine Erweiterung der Abdeckung der bestehenden Kaskade; ob sie gebraucht wird, hängt davon ab, ob Portfolios Auslandsstandorte enthalten.
- Overture-Adressen für Deutschland sind eine Zweitverwertung derselben Länderquellen, die der Code direkt abfragt, und decken nur einen Teil ab; kein Gewinn gegenüber Frage 2.

### Gaps

- Dänemark (Matriklen/Datafordeler), Belgien, Polen, Luxemburg, Italien wurden nicht geprüft.
- Lizenz der französischen Dienste (Licence Ouverte 2.0) und der BAG (CC0) nicht in dieser Sitzung aus Primärquellen gelesen; BAG nur über Overtures Attributionsseite belegt.
- Lizenztext der BEV-Vektorkacheln und der basemap.de-Vektorkacheln nicht separat gelesen (nur Attributionszeilen).
- Kein offenes BKG-Produkt für bundesweite Hausumringe, Hauskoordinaten oder LoD2 gefunden; nicht abschließend recherchiert.
- Für die Schweiz ist unklar, welche Kantone den AV-WFS ohne Registrierung freigeben.

## Frage 4: Was führt der Verbesserungsplan noch als offen, was ist im Code erledigt, welche Benchmark-Schwächen bleiben?

### Takeaway

Der Plan beschreibt die entfernte Fusions-Engine; von seinen Paketen sind P4 (Kandidaten/Snapping), P5-Segmentierung, P6 (Review-Ablauf mit Teilflächenentscheidungen), P7 (Kalibrierung, Hold-out) und der Kern von P1 (unabhängiger Referenzsatz) offen. P8 (Quellenabdeckung) ist weitgehend umgesetzt, und P2/P3 sind durch die Kaskade v3–v13 anders, aber inhaltlich großteils gelöst. Der Benchmark misst mit 17 OSM-Referenzen, davon 8 Dachumrisse, ohne Namen und Adressen und ohne Fehl-/Überschussmaße.

### Cited Findings

- Status laut Plan (18.10.2026): Fusion Standard; Standortzugehörigkeit, Suchraumerweiterung (P3), MultiPolygon (P2), Fahrzeug-Evidenz, Geocoding-Bewertung umgesetzt; "Segmentierung (P5), Kandidatenvarianten/Snapping (P4), Review-Ablauf (P6) und Kalibrierung (P7) sind offen" — [docs/boundary-improvement-plan.de.md](../../docs/boundary-improvement-plan.de.md)
- Die Fusions-Engine und die Legacy-Kette sind aus dem Code entfernt ("Both are removed from the code"); der Plan verweist weiter auf `boundary/fusion.ts`, `parcel-assembly.ts`, `evidence-sources.ts`, `surface-boundary.service.ts`, die es im Verzeichnis nicht mehr gibt — [docs/boundary-model.md, Earlier engines](../../docs/boundary-model.md), [boundary/](../../desktop-app/src/main/services/boundary/)
- P8 erledigt: Parzellen in allen 16 Ländern, 12 mit Adresse, 9 mit Nutzung; amtliche Gebäude in 14 Ländern — [docs/boundary-model.md, Cadastre coverage](../../docs/boundary-model.md), [docs/official-buildings.md](../../docs/official-buildings.md)
- P2 teilweise: differenzierter Quellenstatus existiert als Typ (`notQueried`, `success`, `successEmpty`, `partial`, `transientFailure`, `unsupportedHere`) und in `ParcelLookup.status`; ins Ergebnis gelangt davon nur eine Trace-Zeile bei `transientFailure` oder gekappter Antwort — [types.ts `SourceStatusSchema`](../../desktop-app/src/shared/types.ts), [boundary.service.ts](../../desktop-app/src/main/services/boundary.service.ts)
- P2: Der Cache-Treffer berechnet `containsAnchor` für den aktuellen Punkt neu (Planforderung erfüllt) — [alkis.service.ts `fetchParcelsNear`](../../desktop-app/src/main/services/alkis.service.ts)
- P2 offen: Innenringe von Flurstücken und Gebäuden werden beim Parsen verworfen (nur `gml:exterior`); Stufe 1 füllt Löcher der Parzellenvereinigung absichtlich (`withoutHoles`, v8) — [alkis.service.ts `parseExteriorRings`](../../desktop-app/src/main/services/alkis.service.ts), [docs/boundary-model.md, Cascade v8](../../docs/boundary-model.md)
- P0 teilweise: `quality.resultVersion` wird gespeichert; in Renderer und Review-Gründen wird das Feld nirgends ausgewertet, alte Ergebnisse werden nicht als veraltet markiert — [cascade.ts](../../desktop-app/src/main/services/boundary/cascade.ts), [boundary-review.ts](../../desktop-app/src/shared/boundary-review.ts)
- P7 offen: "The confidence values are fixed priors per stage, not calibrated probabilities"; die Review-Schwellen wurden auf denselben 76 Standorten gesetzt, auf denen sie gemessen wurden — [docs/boundary-model.md, Review calibration](../../docs/boundary-model.md)
- P1 teilweise: Replay-Runner und Dump existieren (`benchmark:boundary:replay`, `BOUNDARY_BENCHMARK_DUMP`); die Zielgröße des Plans (40 Pilot-, 200 kuratierte Standorte, 15 räumliche Gruppen, 20 % Doppelannotation) ist nicht erreicht: im Repo liegen 17 Referenzen — [package.json](../../desktop-app/package.json), [boundary-README.md](../../desktop-app/resources/benchmarks/boundary-README.md)
- Die eingefrorenen Eingaben früherer Prüfungen (195 Standorte) sind verloren: "The frozen inputs of the earlier checks (195 sites) were no longer available, so v12 was not replayed on them" — [docs/boundary-model.md, Cascade v12](../../docs/boundary-model.md)
- Kein Regelsatz ist unabhängig geprüft: "These rules were designed on these same 15 sites", "0.358 is not an independent hold-out result", "Not an independent result" (v12, v13) — [docs/boundary-model.md](../../docs/boundary-model.md)
- Der öffentliche Benchmark ruft die Erkennung nur mit Koordinaten auf; Adressregeln (v9, v13) werden dort konstruktionsbedingt nie ausgeführt ("The fixtures carry no address") — [docs/boundary-model.md, What the public set deliberately does not measure](../../docs/boundary-model.md)
- Fixture-Verteilung: AT 2, BB 1, BE 2, BY 2, HE 2, NI 2, NW 2, SN 2, ST 2; ohne Referenz sind BW, HB, HH, MV, RP, SL, SH, TH. `holdoutRegions` nennt `nl-zh`, ein niederländisches Sample gibt es nicht; die Linzer Samples tragen `state: "Wien"`; Hessen und Bayern stehen auf `cadastreAvailable: false`, obwohl beide inzwischen Parzellen haben — [boundary-public-fixtures.json](../../desktop-app/resources/benchmarks/boundary-public-fixtures.json)
- Ursache der Dachreferenzen: Der Fixture-Generator fragt `way["shop"="car"]["name"]` ohne `building` auszuschließen und sortiert Kandidaten nach Stützpunktzahl absteigend — [build-public-boundary-fixtures.mjs](../../desktop-app/scripts/build-public-boundary-fixtures.mjs)
- 8 der 17 Referenzen sind Showroom-Dächer, IoU und Flächenabweichung dort nicht belastbar (Vorgabe aus dem Auftrag; Messung laut Projektnotiz 19.11.2026) — [boundary-public-fixtures.json](../../desktop-app/resources/benchmarks/boundary-public-fixtures.json)
- Der Dump des Benchmarks lädt Parzellen über `fetchParcelsNear`; die Bayern-Parzellarkarte (`bavariaParcelsNear`) kommt darin nicht vor, Bayern-Samples eines Dumps haben also keine Parzellen — [boundary-benchmark.run.test.ts](../../desktop-app/src/main/services/boundary/boundary-benchmark.run.test.ts)
- Metriken heute: IoU, Boundary-F1 @ 2 m, Coverage, Coverage ≥ 90 %, Area Bias, Kalibrierungs-MAE. Die im Plan geforderten Maße "fehlende Betriebsfläche `A(R\P)/A(R)`", "zusätzlich aufgenommene Fläche `A(P\R)/A(R)`", schlechtestes Zehntel und Unsicherheitsintervalle fehlen in der Auswertung — [boundary-benchmark.ts](../../desktop-app/src/main/services/boundary-benchmark.ts), [docs/boundary-improvement-plan.de.md, Abschnitt 4](../../docs/boundary-improvement-plan.de.md)
- Als weiterhin schwach dokumentiert: übergroße Parzellenvereinigungen (Sachsen-Anhalt, Leipzig, Dortmund-Nord, Berlin-West), Zweitflächen über die Straße, sparsam belegte Kundenparkplätze ("cannot tell a sparsely used car park from a meadow without a surface classification"), Wiese/Wald auf einem gewählten Flurstück außerhalb Bayerns — [docs/boundary-model.md](../../docs/boundary-model.md)

### Inferences

- Der Plan sollte nicht fortgeschrieben, sondern auf die Kaskade umgestellt werden: P4-Snapping ist durch die Vorgabe "nur Katasterlinien" (v12) überholt, P5-Segmentierung widerspricht dem Grundsatz "erst deterministisch"; offen und weiter gültig bleiben P1 (Referenzen), P6 (Teilflächen an-/abwählen im bestehenden Review) und P7 (Kalibrierung). Betroffen: `docs/boundary-improvement-plan.de.md` (Statuskopf und Abschnitt 10 verweisen auf gelöschte Dateien).
- Die dokumentierte Hauptschwäche "ganzes Flurstück ist als Einheit zu grob" ist genau das, was `ave:NutzungFlurstueck` (Frage 2, Vorschlag 1) adressiert: Der Schnitt läuft dann auch außerhalb Bayerns entlang einer Katasterlinie.
- Solange der Benchmark Dachreferenzen enthält und keine Fehl-/Überschussmaße ausweist, belohnt er zu kleine Ergebnisse; Schwellen, die seit v2 daran ausgerichtet wurden (80 m Reichweite, `maxExtensionShare`), sind dadurch systematisch in Richtung "abschneiden" verzerrt.

### Gaps

- Ob die Diagnoseansicht (P0: angeforderte gegen verwendete Engine, Fallback-Grund) in der Oberfläche vollständig vorhanden ist, wurde nicht im Renderer nachvollzogen.
- Die Zählung "8 von 17 Dachreferenzen" wurde nicht unabhängig nachgemessen.

## Frage 5: Welche Robustheitsprobleme hat die aktuelle Implementierung (Timeouts, Retries, Caching, Paging, Mehrparzellen-/Ecklagen, Dienstausfall, Provenienz/Konfidenz)?

### Takeaway

Die Fehlerbehandlung ist im Grundsatz sauber (Fehler werden nie als "leer" gecacht, Circuit Breaker, Fallback-Endpunkte), aber es gibt konkrete Lücken: degradierte Antworten werden 30 Tage gecacht, der Katasterabruf hat kein Gesamtzeitbudget und keine Host-Drosselung, Innenringe gehen verloren, gekappte Antworten werden nur in einem Sonderfall markiert, und im Ergebnis fehlen Lizenzvermerk, Flurstückskennzeichen, Datenstand und der Quellenstatus.

### Cited Findings

**Caching**

- Fällt der primäre Dienst (`ave:Flurstueck`) aus und antwortet der INSPIRE-Fallback, wird das Ergebnis ohne Adresse und Nutzung unter demselben Schlüssel `alkis:v5:...` mit `TTL.cadastre` (30 Tage) gespeichert; die Adress- und Nutzungsregeln bleiben für diesen Standort einen Monat still abgeschaltet — [alkis.service.ts `fetchParcelsNear`](../../desktop-app/src/main/services/alkis.service.ts), [cache.service.ts `TTL`](../../desktop-app/src/main/services/cache.service.ts)
- Dasselbe in Baden-Württemberg: Scheitert ein `nora:`-Layer, gibt `withBwAttributes` die Flurstücke ohne das Feld zurück ("A failed layer leaves its field out"), und der Aufrufer cacht sie 30 Tage — [bw-parcel-attributes.ts `withBwAttributes`](../../desktop-app/src/main/services/bw-parcel-attributes.ts)
- Gekappte Antworten (`status: "partial"`) werden ebenfalls 30 Tage gecacht — [alkis.service.ts](../../desktop-app/src/main/services/alkis.service.ts)
- Positiv: Netz- und HTTP-Fehler werden nicht gecacht; der Cache-Schlüssel rundet auf 4 Nachkommastellen (~11 m), damit Nachbarstandorte eine Antwort teilen — [alkis.service.ts](../../desktop-app/src/main/services/alkis.service.ts)
- BW-Layer werden mit `count=2000` ohne Paging und ohne Kappungsprüfung geholt — [bw-parcel-attributes.ts `LAYER_LIMIT`](../../desktop-app/src/main/services/bw-parcel-attributes.ts)

**Timeouts, Retries, Parallelität**

- Standard je Request: 15 s Timeout, 2 Wiederholungen mit 250 ms × 2^n Backoff bei 408/425/429/5xx; der Flurstücksabruf nutzt diese Standardwerte — [http.service.ts](../../desktop-app/src/main/services/http.service.ts), [alkis.service.ts `fetchAlkisXml`](../../desktop-app/src/main/services/alkis.service.ts)
- Ein Abruf kann aus bis zu 4 Seiten, einem Fallback-Endpunkt, einer zweiten 100-m-Abfrage und weiteren Kandidatenländern bestehen; `detectBoundary` wartet auf `fetchParcelsNear` ohne Frist, während OSM und Gebäude Fristen haben (`osmDeadline`, `buildingsDeadline`) — [boundary.service.ts `detectBoundary`](../../desktop-app/src/main/services/boundary.service.ts), [alkis.service.ts `PARCEL_MAX_PAGES`](../../desktop-app/src/main/services/alkis.service.ts)
- Der Plan fordert: "Alle Provider teilen ein Gesamtzeitbudget. Spiegelwechsel und Wiederholungen dürfen es nicht multiplizieren" — [docs/boundary-improvement-plan.de.md, Abschnitt 8](../../docs/boundary-improvement-plan.de.md)
- `HOST_POLICIES` drosselt Nominatim, Overpass, Photon, Esri Wayback und DWD; für die Länder-WFS gibt es keine Begrenzung, obwohl ein Portfolio-Import mehrere Standorte parallel analysiert — [http.service.ts `HOST_POLICIES`](../../desktop-app/src/main/services/http.service.ts)
- Circuit Breaker: 3 Fehler in Folge öffnen für 30 s, je Land (nicht je Endpunkt), nur im Speicher — [circuit-breaker.ts](../../desktop-app/src/main/services/boundary/circuit-breaker.ts)
- Der User-Agent lautet "DealershipRiskMapping-Desktop/0.1 (contact: internal)", im BW-Modul "DealershipRiskMapping/1.0 (desktop; cadastre)": kein erreichbarer Kontakt, zwei Schreibweisen — [alkis.service.ts](../../desktop-app/src/main/services/alkis.service.ts), [bw-parcel-attributes.ts](../../desktop-app/src/main/services/bw-parcel-attributes.ts)

**Länderzuordnung**

- Das Land wird über grobe, absichtlich überlappende Rechtecke bestimmt; Kandidaten werden nacheinander abgefragt, eine leere Antwort wird je Land und 11-m-Zelle gecacht — [alkis.service.ts `STATE_BBOXES`, `statesForPoint`](../../desktop-app/src/main/services/alkis.service.ts)
- Bayern steht nicht in `STATE_BBOXES`; `bavariaParcelsNear` läuft erst, wenn alle Kandidatenländer leer geantwortet haben. Bayerns Box (47,27–50,57° N, 8,97–13,84° O) überlappt die Boxen von BW (bis 10,5° O), Hessen (bis 10,24° O), Thüringen (ab 50,2° N) und Sachsen (ab 11,87° O / 50,17° N) — [boundary.service.ts](../../desktop-app/src/main/services/boundary.service.ts), [bavaria-lod2.service.ts `BAVARIA_BBOX`](../../desktop-app/src/main/services/bavaria-lod2.service.ts)
- Die Bayern-Karte wird mit `beforeDeadline(..., buildingsDeadline)` abgewartet (5 s nach der Erkennung, `OFFICIAL_BUILDINGS_WAIT_MS`), der WMS-Request selbst hat 25 s Timeout und 1 Wiederholung. Kommt die Karte zu spät, läuft die Kaskade ohne Parzellen; eine Trace-Zeile gibt es nur bei `transientFailure` des Länder-Lookups — [boundary.service.ts](../../desktop-app/src/main/services/boundary.service.ts), [bavaria-parcels.service.ts](../../desktop-app/src/main/services/bavaria-parcels.service.ts), [roof-mask.service.ts](../../desktop-app/src/main/services/detection/roof-mask.service.ts)
- Bayern-Parzellen werden 200 m um den Punkt gelesen (`BAVARIA_PARCEL_RADIUS_M`), überall sonst 250 m; die Loterweiterung reicht 160 m, "parcels at the edge of the 400 m map are cut off" — [bavaria-parcels.service.ts](../../desktop-app/src/main/services/bavaria-parcels.service.ts), [cascade-config.ts `extendedReachM`](../../desktop-app/src/main/services/boundary/cascade-config.ts), [docs/boundary-model.md, Limitations of v9](../../docs/boundary-model.md)

**Paging und Vollständigkeit**

- 4 Seiten × 250 Flurstücke; erkennt eine Seite nichts Neues (Niedersachsen), folgt eine 100-m-Abfrage und `completeRadiusM` sinkt auf 100 — [alkis.service.ts `fetchParcelRings`](../../desktop-app/src/main/services/alkis.service.ts)
- Die Kaskade setzt `cadastreIncomplete` nur, wenn die Antwort gekappt ist und das Flurstück am Punkt fehlt; eine gekappte Menge mit vorhandenem Ankerflurstück wird ohne Flag zusammengesetzt, obwohl der Kommentar an `ParcelLookup.truncated` sagt: "A truncated set must not be used to assemble a multi-parcel site" — [cascade.ts](../../desktop-app/src/main/services/boundary/cascade.ts), [alkis.service.ts `ParcelLookup`](../../desktop-app/src/main/services/alkis.service.ts)
- Gebäude: ein Request mit `count=1000`, kein Paging; `truncated` wird berechnet, aber nirgends ausgewertet — [alkis-buildings.service.ts](../../desktop-app/src/main/services/alkis-buildings.service.ts), [roof-mask.service.ts](../../desktop-app/src/main/services/detection/roof-mask.service.ts)
- SH: Die Stored Query hat weder Paging noch `count`; 2,75 MB für 150 m Halbkante in der Probe — [alkis.service.ts `fetchAlkisXml`](../../desktop-app/src/main/services/alkis.service.ts), [SH Dienst](https://service.gdi-sh.de/WFS_SH_ALKIS_vereinf_OpenGBD?service=WFS&version=2.0.0&request=GetCapabilities)

**Geometrie**

- `parseExteriorRings` liest nur `gml:exterior`. Folgen: Ein Gebäude mit Innenhof wird als volle Fläche maskiert (Erkennungen ab 2 m innerhalb des Umrisses werden entfernt), die unbebaute Fläche eines Flurstücks wird zu klein, ein Flurstück mit Enklave überdeckt das eingeschlossene — [alkis.service.ts `parseExteriorRings`](../../desktop-app/src/main/services/alkis.service.ts), [alkis-buildings.service.ts `parseOfficialBuildings`](../../desktop-app/src/main/services/alkis-buildings.service.ts), [docs/official-buildings.md](../../docs/official-buildings.md)
- Ein Feature mit mehreren Polygonen wird zu mehreren "Flurstücken" mit denselben Attributen; `tntxt`-Anteile gelten dann für jedes Teilpolygon gleich — [alkis.service.ts `parseParcelFeatures`](../../desktop-app/src/main/services/alkis.service.ts)
- Ringe werden über die ersten drei Punkte plus Punktzahl dedupliziert (`ringKey`) — [alkis.service.ts](../../desktop-app/src/main/services/alkis.service.ts)

**Mehrparzellen-, Eck- und Pachtlagen**

- Über Straßen: Ein Flurstück jenseits einer Straße kommt nur bei ≥ 10 Lot-Fahrzeugen und ≥ 15 je 1.000 m² oder bei gleicher Adresse plus 3 Fahrzeugen dazu; "a public car park or a neighbour's full yard looks the same. Such results are flagged" — [docs/boundary-model.md, Cascade v10](../../docs/boundary-model.md)
- Ecklagen: Adressschlüssel sind Straße plus Hausnummer; `lagebeztxt` mit mehreren Straßen ("Hansastraße 41, 43, ...; Kampstraße 28;") wird an ";" und "," zerlegt — [parcel-address.ts](../../desktop-app/src/main/services/boundary/parcel-address.ts)
- Teilnutzung: "Parcels follow legal lines. Part of a joined parcel can belong to another use"; außerhalb Bayerns gibt es keinen Schnitt im Flurstück — [docs/boundary-model.md](../../docs/boundary-model.md)
- Gepachtete Nachbarflächen: Eigentum oder Pacht veröffentlicht kein offener Dienst (die offenen ALKIS-Daten kommen "aus Datenschutzgründen ohne Eigentümerangaben"); die Kaskade schließt nur aus Fahrzeugdichte und Adresse — [FOSSGIS 2025](https://pretalx.com/fossgis2025/talk/TRJW9F/), [docs/boundary-model.md, Cascade v10](../../docs/boundary-model.md)
- Vom Händler umschlossenes fremdes Flurstück: tritt ab 75 % Umschließung bei, bei Wohn-/Offenland nur bis 200 m² — [cascade-config.ts](../../desktop-app/src/main/services/boundary/cascade-config.ts)

**Provenienz und Konfidenz**

- `evidence.source` lautet "ALKIS (Land)" bzw. für Bayern der volle Vermerk; für die anderen Länder fehlen Lizenz und geforderter Quellenvermerk, der verwendete Endpunkt (primär oder Fallback), das Abrufdatum des Katasters (gesetzt wird der Zeitpunkt der Berechnung) und der Datenstand — [cascade-vehicle-parcel.ts `parcelResult`](../../desktop-app/src/main/services/boundary/cascade-vehicle-parcel.ts)
- `ParcelFeature` kennt nur `ring`, `areaSqm`, `state`, `address`, `landUse`; `flstkennz`, amtliche Fläche (`flaeche`) und `aktualit` liefert der Dienst mit, sie werden nicht gelesen — [alkis.service.ts `ParcelFeature`](../../desktop-app/src/main/services/alkis.service.ts), [NRW Dienst](https://www.wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht?service=WFS&version=2.0.0&request=GetCapabilities)
- Die Lizenzvermerke der Länder liegen bereits im Overlay-Register und werden dort angezeigt, aber nicht für Analyseergebnisse und Exporte genutzt — [cadastre-sources.ts](../../desktop-app/src/shared/cadastre-sources.ts), [CadastreLayer.tsx](../../desktop-app/src/renderer/src/components/map/CadastreLayer.tsx)
- Konfidenz: feste Werte je Stufe (0,75 / 0,6 / 0,45 / 0,4 / 0,1), keine kalibrierten Wahrscheinlichkeiten — [cascade-config.ts `CASCADE_CONFIDENCE`](../../desktop-app/src/main/services/boundary/cascade-config.ts)
- Gespeicherte Ergebnisse älterer Kaskadenversionen werden nicht neu berechnet und nicht markiert: `resultVersion` wird geschrieben, aber nirgends gelesen; "A result calculated before v13 can therefore differ after a new analysis" — [cascade.ts](../../desktop-app/src/main/services/boundary/cascade.ts), [docs/boundary-model.md, Limitations of v13](../../docs/boundary-model.md)
- Projektregel: "Preserve provenance, confidence, limitations, and fallback information in risk calculations" — [CLAUDE.md](../../CLAUDE.md)

**URL-Regeln**

- Renderer-CSP: `img-src 'self' data: https:; connect-src 'self'`; Katasterabrufe laufen im Hauptprozess gegen fest einprogrammierte Endpunkttabellen, eine zentrale Hostliste gibt es nur beim Overture-Abruf (`ALLOWED_HOSTS`) — [index.html](../../desktop-app/src/renderer/index.html), [overture-dealers.ts](../../desktop-app/src/main/services/dealer-directory/overture-dealers.ts)

### Inferences

- R1 Degradierte Antworten kurz cachen: Ergebnis aus Fallback-Endpunkt, mit fehlenden BW-Attributen oder gekappt nur 24 h halten und im `ParcelLookup` als `partial` mit Grund kennzeichnen. Betroffen: `alkis.service.ts`, `bw-parcel-attributes.ts`, `cache.service.ts` (neuer TTL-Wert). Kleiner Eingriff, direkter Qualitätsgewinn nach Dienststörungen.
- R2 Provenienz vervollständigen: `flstkennz`, `flaeche`, `aktualit` in `ParcelFeature` aufnehmen; in `parcelResult` Lizenzvermerk je Land (aus `cadastre-sources.ts` wiederverwenden), verwendeten Dienst, Kataster-Abrufzeit und `SourceStatus` in `evidence` und `limitations` schreiben. Betroffen: `alkis.service.ts`, `cascade-vehicle-parcel.ts`, `boundary.service.ts`, `shared/types.ts`, Exporte. Erfüllt die Namensnennungspflicht der dl-de/by- und CC-BY-Länder auch im Export.
- R3 Innenringe erhalten: `parseExteriorRings` um Innenringe ergänzen; in der Dachmaske Erkennungen im Innenhof nicht entfernen, bei `unbuiltAreaSqm` die Hoffläche abziehen. Betroffen: `alkis.service.ts`, `alkis-buildings.service.ts`, `detection/roof-mask.ts`, `bavaria-lod2.service.ts` (prüfen, ob LoD2-Grundflächen Löcher tragen).
- R4 Gekappte Mengen kennzeichnen: `cadastreIncomplete` auch setzen, wenn `completeRadiusM` kleiner ist als die Reichweite, die das Ergebnis tatsächlich nutzt (Erweiterung 160 m, Zweitfläche über die Straße). Betroffen: `cascade.ts`, `boundary.service.ts`.
- R5 Zeitbudget und Drosselung: ein Gesamtbudget für `fetchParcelsNear` (z. B. 20 s, danach Ergebnis ohne Kataster mit Trace-Zeile und Hintergrund-Nachladen wie bei den Gebäuden) und `HOST_POLICIES` mit `maxConcurrent` 2–4 für die WFS-Hosts. Betroffen: `http.service.ts`, `alkis.service.ts`, `boundary.service.ts`.
- R6 Länderzuordnung offline per Polygon statt Rechteck (vereinfachte Ländergrenzen als statische Ressource), Bayern als reguläres "Land" in die Schleife; spart 1–3 Leerabfragen je neuem Standort in Überlappungszonen und macht den Bayern-Pfad sichtbar (Trace-Zeile, wenn die Karte zu spät kommt). Betroffen: `alkis.service.ts`, `boundary.service.ts`, `bavaria-parcels.service.ts`.
- R7 Bayern-Radius auf 250 m anheben (2.000 × 2.000 px bei 0,25 m), damit Erweiterung und Zweitfläche nicht am Kartenrand enden; vorher prüfen, ob der WMS die Bildgröße zulässt. Betroffen: `bavaria-parcels.service.ts`.
- R8 Veraltete Ergebnisse markieren: vorhandenen Review-Grund ergänzen, wenn `quality.resultVersion < CASCADE_VERSION` (analog `legacyEngine`); nutzt die bestehende Review-Liste, kein neuer Baustein. Betroffen: `shared/boundary-review.ts`.
- R9 Einheitlicher User-Agent mit Projekt-URL in einer Konstante. Betroffen: alle `*.service.ts` mit `USER_AGENT`.

### Gaps

- Ob die Länderdienste `startIndex` ohne `sortBy` stabil paginieren, ist nicht geprüft (nur Niedersachsens Verhalten ist dokumentiert).
- Rate-Limits der Länderdienste sind in keinem geprüften Capabilities-Dokument beziffert; es gibt nur die Lizenz- und Haftungshinweise.
- Ob LoD2-Grundflächen in Bayern Innenringe enthalten, wurde nicht geprüft.
- Wie oft der Fallback-Endpunkt in der Praxis greift (und damit R1 wirkt), ist nicht gemessen.

## Frage 6: Welche besseren offenen Referenzdaten können den Benchmark selbst verbessern (Genauigkeit messen statt annehmen)?

### Takeaway

Eine offene Quelle, die das Betriebsgelände direkt abbildet, gibt es nicht; verbessern lässt sich der Benchmark durch (a) einen korrigierten OSM-Filter ohne Gebäudeumrisse und mit allen 16 Ländern, (b) amtliche Daten als unabhängige Prüfgrößen (geschnittene Gebäude, Fläche auf Wohn-/Offenland laut Kataster), (c) Fehl- und Überschussmaße statt IoU allein und (d) die vorhandene Export-Schiene für manuelle Korrekturen.

### Cited Findings

- Der Generator nimmt jede benannte `shop=car`-Fläche, auch wenn sie ein Gebäude ist, und bevorzugt Flächen mit vielen Stützpunkten — [build-public-boundary-fixtures.mjs](../../desktop-app/scripts/build-public-boundary-fixtures.mjs)
- Die Referenzen sind "a proxy for the operational lot, not a survey"; "Treat a mean IoU of 1.0 against this set as implausible rather than excellent" — [resources/benchmarks/LICENSES.md](../../desktop-app/resources/benchmarks/LICENSES.md)
- Empfohlene Schichtung laut Repo: Bundesland, Stadt/Land, Lotgröße, Bildalter, Katasterverfügbarkeit — [boundary-README.md](../../desktop-app/resources/benchmarks/boundary-README.md)
- Manuelle Korrekturen lassen sich als zweiter Datensatz exportieren (`scripts/export-boundary-groundtruth.mjs`, nie im Repo); er ist verzerrt, weil nur bemerkte Fehler korrigiert werden — [docs/boundary-model.md, Ground truth from manual corrections](../../docs/boundary-model.md)
- Öffentliche Beispielportfolios mit Namen und Adressen (10–500 OSM-Händler, ODbL) liegen in einem eigenen Repo; die Kaskadenprüfungen v8 und v9 nutzten daraus 83 bzw. 73 Standorte, aber ohne Referenzumriss ("judged by eye") — [dealership_dataset](https://github.com/JanisKre/dealership_dataset), [docs/boundary-model.md, Cascade v8/v9](../../docs/boundary-model.md)
- Amtliche Gebäude mit Funktion sind in 14 Ländern abrufbar und werden für die Dachmaske ohnehin geladen — [docs/official-buildings.md](../../docs/official-buildings.md)
- Amtliche Nutzungsflächen mit `nutzart`/`bez` ("Industrie- und Gewerbefläche" / "Handel und Dienstleistung", "Wohnbaufläche", "Straßenverkehr") sind je Flurstücksabschnitt abrufbar — [Brandenburg FN](https://isk.geobasis-bb.de/ows/alkis_vereinf_wfs?service=WFS&version=2.0.0&request=GetCapabilities)
- Overture-Gebäude und -`land_use` stammen in Deutschland im Kern aus OSM (ODbL), sind also keine unabhängige Referenz zu OSM-Händlerflächen — [Overture Attribution](https://docs.overturemaps.org/attribution/)
- Der Plan verlangt 40 Pilot- und 200 kuratierte Referenzen mit Annotationsleitfaden, 20 % Doppelannotation und unangetastetem Hold-out — [docs/boundary-improvement-plan.de.md, Abschnitt 4](../../docs/boundary-improvement-plan.de.md)

### Inferences

**Benchmark-Verbesserungen (alle innerhalb des bestehenden Benchmarks, keine App-Funktion)**

- B1 Generator korrigieren: `building=*` ausschließen, zusätzlich verwerfen, wenn ≥ 80 % der Referenzfläche auf amtlichen Gebäudegrundflächen liegt; Relationen (`type=multipolygon`) zulassen; nicht nach Stützpunktzahl sortieren, sondern je Land schichten (mindestens 2 je Land, auch BW, HB, HH, MV, RP, SL, SH, TH). Dabei Datenfehler bereinigen (`state: "Wien"` für Linz, `cadastreAvailable` für HE/BY, `holdoutRegions` mit `nl-zh`). Betroffen: [build-public-boundary-fixtures.mjs](../../desktop-app/scripts/build-public-boundary-fixtures.mjs), [boundary-public-fixtures.json](../../desktop-app/resources/benchmarks/boundary-public-fixtures.json). Lizenz bleibt ODbL.
- B2 Maße ergänzen: fehlender Anteil `A(R\P)/A(R)`, Überschussanteil `A(P\R)/A(R)`, Zahl der vom Umriss geschnittenen amtlichen Gebäude, Fahrzeug-Recall (Referenzfahrzeuge im Ergebnis) und Fremdfahrzeuganteil, schlechtestes Zehntel. Die beiden Gebäude- und Fahrzeugmaße brauchen keine Referenzfläche und funktionieren daher auch auf den 500 Beispielhändlern. Betroffen: [boundary-benchmark.ts](../../desktop-app/src/main/services/boundary-benchmark.ts), [boundary-benchmark.run.test.ts](../../desktop-app/src/main/services/boundary/boundary-benchmark.run.test.ts).
- B3 Referenzfreie Plausibilitätsmaße aus dem Kataster: Anteil der Ergebnisfläche auf Wohnbau-, Landwirtschafts-, Wald- oder Verkehrsfläche laut `ave:NutzungFlurstueck`. Das misst "zu viel aufgenommen" unabhängig von OSM in allen Ländern mit FN. Es ist ein Prüfmaß, keine Referenzgrenze: Ein Betriebshof kann als "Weg" oder Ackerland registriert sein (dokumentierte Fälle in v9).
- B4 Dump vervollständigen: Bayern-Parzellen (`bavariaParcelsNear`), Gebäude, Vegetationsraster, Name und Adresse im Suchformat ("Name, Straße Nr, PLZ Ort") in den Dump schreiben und die eingefrorenen Eingaben an einem dauerhaften Ort außerhalb von `/private/tmp` ablegen; die früheren 195 Standorte sind verloren gegangen. Betroffen: `boundary-benchmark.run.test.ts`, `boundary-replay.ts`.
- B5 Kontextlauf mit Adresse auf dem öffentlichen Beispielportfolio (nicht auf den OSM-Fixtures, wo der Name die Referenz verrät): misst erstmals die Adressregeln aus v9/v13 mit Fahrzeugen.
- B6 Kleiner handannotierter Satz (Plan P1) bleibt die einzige echte Referenz; die amtlichen DOP der Länder (in der App als Bildquelle vorhanden) sind die geeignete, offen lizenzierte Zeichengrundlage. Aufwand laut Plan 20–40 Stunden für 200 Standorte.

#### Gesamt-Rangliste aller Empfehlungen (Nutzen gegen Aufwand)

| Rang | Empfehlung | Nutzen | Aufwand | Dateien | Neuer Host |
| --- | --- | --- | --- | --- | --- |
| 1 | B1 + B2: Dachreferenzen entfernen, Fehl-/Überschuss-, Gebäudeschnitt- und Fahrzeugmaße | hoch: ohne das ist keine weitere Regeländerung messbar | klein (1–2 Tage) | `build-public-boundary-fixtures.mjs`, `boundary-benchmark.ts`, `boundary-benchmark.run.test.ts` | nein |
| 2 | Vorschlag 1: `ave:NutzungFlurstueck` (Nutzung für HE/BB, Schnitt im Flurstück in NW, SN, NI, HH, HE, BB, ggf. ST, MV) | hoch: trifft die dokumentierte Hauptschwäche "Flurstück zu grob", bleibt auf Katasterlinien | mittel (3–5 Tage inkl. Replay) | `alkis.service.ts`, `cascade-config.ts`, `cascade-parcels.ts`, Tests, `docs/boundary-model.md` | nein |
| 3 | R1: degradierte Katasterantworten nur kurz cachen | mittel bis hoch nach Dienststörungen | sehr klein (< 1 Tag) | `alkis.service.ts`, `bw-parcel-attributes.ts`, `cache.service.ts` | nein |
| 4 | Vorschlag 2 + 3: Gebäude mit Funktion für SN, ST, BB, MV, BW, SH; Gebäude für HH und SL | mittel bis hoch: Dachmaske und "unbebaute Fläche" in 8 Ländern besser, SH-Abruf von 14–20 s auf 0 s | klein bis mittel (2–3 Tage) | `alkis-buildings.service.ts`, `alkis.service.ts`, `docs/official-buildings.md` | nein |
| 5 | R2: Provenienz (Lizenzvermerk, `flstkennz`, Datenstand, Quellenstatus) | mittel: Lizenzpflicht und Projektregel, Nachvollziehbarkeit im Export | klein bis mittel (2 Tage) | `alkis.service.ts`, `cascade-vehicle-parcel.ts`, `boundary.service.ts`, `shared/types.ts`, `shared/cadastre-sources.ts` | nein |
| 6 | R3: Innenringe erhalten | mittel: Innenhöfe, Enklaven | klein bis mittel (1–2 Tage) | `alkis.service.ts`, `alkis-buildings.service.ts`, `detection/roof-mask.ts` | nein |
| 7 | Vorschlag 5: Hauskoordinaten NRW (geprüft) und Thüringen (nach Probe) | mittel: NRW ist das bevölkerungsreichste Land ohne Ankerverfeinerung | sehr klein für NRW (Tabelleneintrag plus Test) | `house-coordinates.service.ts`, `docs/official-buildings.md` | nein |
| 8 | R4 + R8: `cadastreIncomplete` bei zu kleinem `completeRadiusM`; veraltete `resultVersion` als Review-Grund | mittel: weniger stille Fehler | klein | `cascade.ts`, `boundary.service.ts`, `shared/boundary-review.ts` | nein |
| 9 | Vorschlag 4: Nutzung für BE, SL, TH, RP per Flächenlayer und Sampling | mittel: BE und SL bekommen erstmals Nutzung | mittel (2–4 Tage) | `bw-parcel-attributes.ts`, `alkis.service.ts` | nein |
| 10 | R5 + R6 + R9: Zeitbudget, WFS-Drosselung, Länderpolygone, einheitlicher User-Agent | mittel bei Portfolio-Importen und in Grenzlagen | mittel | `http.service.ts`, `alkis.service.ts`, `boundary.service.ts` | nein |
| 11 | B4 + B5: Dump vollständig, Adresslauf auf Beispielportfolio | mittel: macht v9/v13-Regeln messbar | klein | `boundary-benchmark.run.test.ts`, `boundary-replay.ts` | nein |
| 12 | R7: Bayern-Kartenradius 250 m | klein bis mittel | sehr klein (nach WMS-Probe) | `bavaria-parcels.service.ts` | nein |
| 13 | Auslandsparzellen über INSPIRE CP (CZ, ES) oder GeoJSON (NL, FR) | nur bei Auslandsstandorten im Portfolio | klein je Land (CZ/ES), mittel (NL/FR) | `alkis.service.ts` | ja |
| 14 | OGC API Features als zweiter Fallback (NW, HH) | klein | mittel | `alkis.service.ts` | ja |
| 15 | basemap.de-Vektorkacheln als bundesweiter Gebäude-/Adress-Fallback; Overture-Gebäude fürs Ausland; BEV-Kacheln | klein (DE) bzw. nur Ausland | mittel bis hoch (MVT-Abhängigkeit bzw. Parquet-Geometrie) | `alkis-buildings.service.ts`, `package.json` | teils |

#### Hosts

- Ränge 1–12 brauchen keinen neuen Host. Die neuen Feature-Typen liegen auf bereits genutzten Hosts: `www.wfs.nrw.de`, `geodienste.sachsen.de`, `opendata.lgln.niedersachsen.de`, `service.gdi-sh.de`, `www.geodatenportal.sachsen-anhalt.de`, `isk.geobasis-bb.de`, `www.gds.hessen.de`, `geodienste.hamburg.de`, `www.geodaten-mv.de`, `www.geoproxy.geoportal-th.de`, `geo5.service24.rlp.de`, `owsproxy.lgl-bw.de`, `gdi.berlin.de`, `geoportal.saarland.de`.
- Neue Hosts nur für die nachrangigen Optionen: `ogc-api.nrw.de`, `api.hamburg.de` (Rang 14); `api.pdok.nl` oder `service.pdok.nl`, `apicarto.ign.fr` oder `data.geopf.fr`, `services.cuzk.cz`, `ovc.catastro.meh.es`, `geodienste.ch`, `kataster.bev.gv.at` (Rang 13/15). `sgx.geodatenzentrum.de`, `stac.overturemaps.org` und `overturemaps-us-west-2.s3.us-west-2.amazonaws.com` sind bereits in Verwendung.
- Zusätzliche Quellenvermerke bei Umsetzung: Saarland-Gebäude "© GeoBasis DE/LVGL-SL (Jahr), dl-de/by-2-0, www.lvgl.saarland.de"; Hamburg "Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV)"; Thüringen "© GDI-Th" (CC BY 4.0); alle übrigen wie in der Lizenztabelle unter Frage 2.

### Gaps

- Wie viele `shop=car`-Flächen ohne `building`-Tag es je Bundesland gibt, wurde nicht gezählt (keine Overpass-Abfrage abgesetzt); ob der korrigierte Filter in jedem Land zwei brauchbare Referenzen liefert, ist offen.
- Für keinen Vorschlag liegt eine Messung vor; die Nutzenangaben der Rangliste sind Einschätzungen aus Code, Doku und den Live-Proben, keine Replay-Ergebnisse.
- Ein offener Datensatz mit vermessenen oder amtlich bestätigten Betriebsgrenzen von Autohäusern wurde nicht gefunden.
