# Hagel-Risikomodell und Hagel-Datenquellen: Verbesserungen an bestehenden Funktionen

Stand der Prüfung: 19.11.2026. Code-Stand: Branch `claude/app-improvements-existing-9ce5bc`, Modellversion `screening-0.5.1`. Endpunkte wurden mit lesenden HTTP-Abrufen geprüft (ohne Projekt- oder Nutzerdaten; Testkoordinate 50,11 N / 8,68 E). Alles, was nicht geprüft werden konnte, steht unter "Gaps" oder ist als "nicht verifiziert" markiert. Alle Vorschläge bleiben innerhalb bestehender Funktionen (Hagelzone, Hagelhistorie, EAL, Zonen-Overlay, Wetterabfrage), sind deterministisch (kein LLM), nur Hagel, und ändern nichts an der Einordnung als Screening-Schätzung. Die nach Nutzen/Aufwand sortierte Rangfolge steht am Ende von Frage 5.

Repo-Pfade sind relativ zu `desktop-app/src/` angegeben und verlinkt.

## Frage 1: Welche Hageldaten nutzt die App heute, für welche Länder, in welcher Auflösung, und wo sind die Lücken?

### Takeaway
Die EAL hängt faktisch an einer einzigen statischen Quelle: einer PLZ-Tabelle für Deutschland (8.183 Einträge, Stand 2024) mit widersprüchlicher Herkunftsangabe; außerhalb dieser Tabelle fällt die App auf einen 92-Tage-CAPE-Proxy zurück, der jahreszeitabhängig ist und im Winter praktisch immer Zone 1 liefert. Herkunft, Datenstand und Einschränkungen der Zonenquelle werden weder vollständig gespeichert noch im Detaildialog angezeigt.

### Cited Findings

**Hagelzone / Hagel-Score**
- Reihenfolge der Quellen: lizenzierter Anbieter, dann PLZ-Hagelzone `(zone − 1) / 5 × 100`, dann Open-Meteo-CAPE-Proxy (3 × Anteil Tage mit CAPE ≥ 1.500 J/kg + 0,3 × Anteil ≥ 1.000 J/kg über 92 Tage, geklemmt auf 5–90 %) — [docs/risk-model.md](../../docs/risk-model.md), [main/services/risk/hazard-models.ts `scorePerils`](../../desktop-app/src/main/services/risk/hazard-models.ts), [main/services/weather.service.ts `fetchOpenMeteoWeather`](../../desktop-app/src/main/services/weather.service.ts)
- Die PLZ-Tabelle nennt im Dateikopf als Quelle "internal zoning model", 8.183 Einträge, Stand 2024; Doku, Katalog und Einheit nennen dagegen "GDV/K-Kasko hail zones" bzw. "K-Kasko zone" — [shared/hail-zones.ts (Kopf)](../../desktop-app/src/shared/hail-zones.ts), [docs/risk-model.md](../../docs/risk-model.md), [shared/natcat-catalog.ts](../../desktop-app/src/shared/natcat-catalog.ts), [hazard-models.ts](../../desktop-app/src/main/services/risk/hazard-models.ts)
- Verteilung der Tabelle (eigene Zählung per grep): Zone 1: 3.249, Zone 2: 2.454, Zone 3: 923, Zone 4: 682, Zone 5: 576, Zone 6: 299 PLZ — [shared/hail-zones.ts](../../desktop-app/src/shared/hail-zones.ts)
- Die PLZ wird nur per Regex `\b(\d{5})\b` aus dem Adresstext gelesen (erste fünfstellige Zahl), ohne Länderprüfung und ohne Rückgriff auf die Koordinate — [main/services/analyze.service.ts `extractPostalCode`, Zeilen 48–52 und 210–211](../../desktop-app/src/main/services/analyze.service.ts)
- Der CAPE-Proxy fragt `api.open-meteo.com/v1/forecast?...&hourly=cape&past_days=92&forecast_days=1` ab, Cache 12 h, Schlüssel auf 3 Nachkommastellen — [weather.service.ts](../../desktop-app/src/main/services/weather.service.ts), [main/services/cache.service.ts](../../desktop-app/src/main/services/cache.service.ts)
- `scoreRisk` ruft `fetchWeather` immer auf, auch wenn eine PLZ-Zone oder ein Anbieterwert vorliegt und das Wetter den Score nicht beeinflusst — [main/services/risk.service.ts `scoreRisk`](../../desktop-app/src/main/services/risk.service.ts)
- Für `weather.service.ts` gibt es keine eigene Testdatei; `dailyMaxCape`, `fracAtLeast` und die Proxy-Formel sind nur indirekt über einen Mock in `risk.service.test.ts` berührt — [main/services/risk.service.test.ts](../../desktop-app/src/main/services/risk.service.test.ts)

**Provenienz / Konfidenz**
- Konfidenzwerte sind Konstanten: Open-Meteo 0,55, PLZ-Zone 0,7, geschätzte Zone 0,3, Wetter-Fallback 0,15, Anbieter 0,9, DWD-Stationshistorie 0,5 — [main/services/risk/evidence.ts](../../desktop-app/src/main/services/risk/evidence.ts), [main/services/hazard-api.service.ts](../../desktop-app/src/main/services/hazard-api.service.ts), [hail-history.service.ts `hailHistoryEvidence`](../../desktop-app/src/main/services/hail-history/hail-history.service.ts)
- Die Gesamtkonfidenz ist das ungewichtete Mittel aller Evidenz-Einträge (Hazard, Zone, Grenze, Detektion) — [risk.service.ts, `confidence = evidence.reduce(...) / evidence.length`](../../desktop-app/src/main/services/risk.service.ts)
- Der Evidenz-Eintrag "Postcode hail zones" hat kein `dataVersion`, eine leere `limitations`-Liste und `retrievedAt: now`, obwohl die Tabelle statisch und auf 2024 datiert ist — [evidence.ts `riskEvidence`](../../desktop-app/src/main/services/risk/evidence.ts)
- Der Detaildialog zeigt je Evidenz nur Quelle, Methode, Fallback-Suffix und Konfidenz; `dataVersion`, `spatialResolution`, `retrievedAt` und die Einschränkungen je Quelle werden nicht angezeigt (nur bei NatCat-Anbietern `dataVersion`) — [renderer/src/components/dashboard/detail/SourcesSections.tsx, Zeilen 40–70 und 228](../../desktop-app/src/renderer/src/components/dashboard/detail/SourcesSections.tsx), Schema: [shared/types.ts `RiskEvidenceSchema`](../../desktop-app/src/shared/types.ts)

**Hagelhistorie (nur Kontext, geht nicht in die EAL)**
- DWD CDC, tägliche Wettererscheinungen, Spalte `HAGEL`; drei nächste Stationen im 30-km-Radius mit ≥ 10 Jahren; ein Jahr zählt ab 180 gültigen Tageswerten — [hail-history.service.ts](../../desktop-app/src/main/services/hail-history/hail-history.service.ts)
- Radarzellen KONRAD3D (`opendata.dwd.de/weather/radar/konrad3d/`, 5-min-XML der letzten 48 h), lokales Archiv ab erster Nutzung; Hageltag, wenn Zellumriss ≤ 1 km — [radar-hail.service.ts](../../desktop-app/src/main/services/hail-history/radar-hail.service.ts), [shared/radar-hail.ts](../../desktop-app/src/shared/radar-hail.ts)
- Historische Sturmtage aus RADKLIM YW 2017.002 (5 min, 1 km, ab 2001) mit Kernschwellen 6 / 9 / 14 mm pro 5 min für "Gemisch / Hagel / großer Hagel"; laut Doku "an app convention, not a validated hail detection" — [radklim.service.ts `CORE_THRESHOLDS_MM`](../../desktop-app/src/main/services/hail-history/radklim.service.ts), [docs/risk-model.md](../../docs/risk-model.md)
- Geprüft am 19.11.2026: KONRAD3D-Verzeichnis erreichbar (HTTP 200, 576 XML-Dateien vom 16.11. 22:10 bis 18.11. 22:05 UTC, also rund 48 h); RADKLIM `.../reproc/2017_002/bin/` erreichbar mit Jahresordnern 2001–2026 plus `supplement/`; CDC `weather_phenomena/` mit `historical/` und `recent/` erreichbar — [opendata.dwd.de/weather/radar/konrad3d/](https://opendata.dwd.de/weather/radar/konrad3d/), [RADKLIM bin](https://opendata.dwd.de/climate_environment/CDC/grids_germany/5_minutes/radolan/reproc/2017_002/bin/), [CDC weather_phenomena](https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/weather_phenomena/)

**Zonen-Overlay**
- Umrisse aus `yetzt/postleitzahlen` (ODbL), Download über `releases/latest/download/postleitzahlen.topojson.br` (nicht auf eine Version festgelegt, keine Prüfsumme), Cache `overlay-v1.json`; nur deutsche PLZ, PLZ ohne Tabelleneintrag werden nicht gezeichnet — [hail-zone-overlay/overlay.service.ts](../../desktop-app/src/main/services/hail-zone-overlay/overlay.service.ts), [docs/risk-model.md](../../docs/risk-model.md)

**Lizenzierte Anbieter**
- Anbieter liefern `score` 0–100 (Pflicht) sowie optional `returnPeriodYears` und `annualExceedanceProbability`; in die EAL geht nur der Score ein, der über `estimateHailZoneFromScore` auf eine Zone 1–6 abgebildet wird, λ kommt weiter aus der Platzhaltertabelle — [hazard-api.service.ts](../../desktop-app/src/main/services/hazard-api.service.ts), [risk/financial-loss.ts `resolveHailZone`](../../desktop-app/src/main/services/risk/financial-loss.ts), [shared/risk-math.ts `estimateHailZoneFromScore`](../../desktop-app/src/shared/risk-math.ts)

**Lizenz der eingebauten Wetterquelle**
- Open-Meteo: die kostenlose API ist nur für nicht-kommerzielle Zwecke erlaubt ("You may only use the free API services for non-commercial purposes"), mit Limits von 10.000 Aufrufen pro Tag; die Daten selbst stehen unter CC BY 4.0 — [Open-Meteo Terms](https://open-meteo.com/en/terms)
- Der Katalog führt die eingebaute Quelle als `license: "free"` — [shared/natcat-catalog.ts](../../desktop-app/src/shared/natcat-catalog.ts)

### Inferences
- **Jahreszeit-Fehler im Fallback:** Ein 92-Tage-Fenster, das im Winter abgefragt wird (z. B. Dezember bis Februar), enthält kaum Tage mit CAPE ≥ 1.000 J/kg; der Proxy landet dann am unteren Klemmwert 5 %, `estimateHailZoneFromScore(5)` ergibt `1 + round(0,25) = 1`. Derselbe Standort kann im August bis zu Zone 6 bekommen (90 % → `1 + round(4,5) = 6`). Über die Platzhalter-λ (0,01 gegen 0,15) wäre das ein Faktor 15 in der EAL, nur wegen des Analysedatums. Betroffen sind alle Standorte ohne Tabellentreffer.
- **Abdeckungslücke:** Betroffen vom Fallback sind (a) alle Standorte außerhalb Deutschlands, (b) deutsche Standorte, die nur mit Koordinaten oder mit Adresse ohne PLZ importiert wurden, (c) PLZ, die nach 2024 neu entstanden oder nicht in der Tabelle sind. Für (b) wäre die Zone ohne neue Daten bestimmbar, weil die Overlay-Polygone (PLZ-Flächen mit Zone) schon lokal vorliegen.
- **Fehlzuordnung möglich:** Fünfstellige ausländische Postleitzahlen (FR, IT, ES, US) oder andere fünfstellige Zahlen im Adresstext werden ungeprüft in der deutschen Tabelle nachgeschlagen. Bei 8.183 belegten von 100.000 möglichen Nummern liegt die Zufallstrefferquote bei rund 8 %; 20 Stichproben (u. a. 75001, 20121, 28001, 90210) ergaben keinen Treffer, das schließt Kollisionen aber nicht aus. Ein Treffer würde als `zoneSource: "postcode"` mit Konfidenz 0,7 ausgewiesen.
- **Unnötiger Abruf und falsche Evidenz:** Weil `fetchWeather` immer läuft, gehen Koordinaten jedes Standorts an Open-Meteo, auch wenn die PLZ-Zone den Score bestimmt. Der Eintrag "Open-Meteo, 92-day weather window" steht dann als Quelle in der Evidenz, obwohl er nichts beigetragen hat; scheitert der Abruf, sinkt die Konfidenz (0,15) und es erscheint "Live weather lookup failed", obwohl das Ergebnis unverändert ist.
- **Konfidenz misst nicht die Hagel-Unsicherheit:** Das Mittel mischt Geometrie- und Detektionsqualität mit der Hazard-Qualität; eine manuell bestätigte Grenze hebt die "Modellkonfidenz" auch dann, wenn die Zone nur geschätzt ist. Der größte Unsicherheitsfaktor (λ/p/S sind Platzhalter) senkt die Zahl gar nicht.
- **Herkunftskonflikt mit Lizenzfrage:** "internal zoning model" und "GDV/K-Kasko" können nicht beide stimmen. Solange unklar ist, ob die Tabelle aus GDV-Mitgliederdaten oder einer eigenen Ableitung stammt, ist auch unklar, ob sie in einem offenen Repository liegen darf.
- **Lizenzrisiko Open-Meteo:** Wird die App im Underwriting eines Versicherers genutzt, ist das mit hoher Wahrscheinlichkeit kommerzielle Nutzung; der eingebaute Fallback wäre dann nicht von den Bedingungen der Gratis-API gedeckt. Das sollte im Katalog (`natcat-catalog.ts`, Notiztext `screening`) stehen.
- **Veraltete Kommentare:** `HailEalDetailSchema` beschreibt `exposedVehicles` noch als "vehicles × exposure ratio" und `vehicles` als "before the roof-cover reduction"; beides gibt es in `computeHailEal` nicht mehr ([shared/types.ts, Zeilen 655–677](../../desktop-app/src/shared/types.ts)).

### Gaps
- Woher die PLZ-Zonentabelle tatsächlich stammt (GDV, Erstversicherer, eigene Ableitung) und unter welchen Bedingungen sie weitergegeben werden darf, ließ sich aus dem Repository nicht klären (Git-Historie zeigt nur den Initial-Commit und einen späteren Sammel-Commit).
- Nicht geprüft: ob die Renderer-Seite an anderer Stelle (Export, Standortbericht) `dataVersion`/`retrievedAt` der Risiko-Evidenz ausgibt; geprüft wurde nur `SourcesSections.tsx`.
- Räumliche Auflösung des Open-Meteo-CAPE-Werts ("model grid") ist im Code nicht konkretisiert und wurde nicht ermittelt.

## Frage 2: Welche offenen Hageldatensätze könnten die bestehenden Funktionen verbessern?

### Takeaway
Für Deutschland gibt es weiterhin keine fertige offene Hagelklimatologie als Raster; offen und lizenzfreundlich (CC BY 4.0) sind die DWD-Radarrohdaten und RADKLIM, aus denen sich ein Hagel-Proxy-Raster einmalig vorberechnen ließe. Der einzige geprüfte, offene Datensatz mit Hageltagen nach Korngröße und Wiederkehrperioden ist die MeteoSwiss-Hagelklimatologie (Schweiz plus schmaler Grenzstreifen). ESWD, AR-CHaMo und die KIT-Zugbahnen sind nicht offen nutzbar.

### Cited Findings

**DWD (Deutschland)**
- Lizenz: alle offenen Geodaten und Geodatendienste des DWD dürfen unter CC BY 4.0 mit Quellenangabe weiterverwendet werden; Zugriff ohne Registrierung — [DWD Legal notice](https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html), [opendata.dwd.de/README.txt](https://opendata.dwd.de/README.txt)
- In `CDC/grids_germany/` gibt es kein Hagelprodukt: `multi_annual/` enthält u. a. Temperatur, Niederschlag, Frost-/Sommertage, Erosivität, Wind, aber nichts zu Hagel; `return_periods/` enthält nur `precipitation/` (Verzeichnislisten abgerufen am 19.11.2026) — [grids_germany/multi_annual/](https://opendata.dwd.de/climate_environment/CDC/grids_germany/multi_annual/), [grids_germany/return_periods/](https://opendata.dwd.de/climate_environment/CDC/grids_germany/return_periods/)
- RADKLIM YW 2017.002: 5-Minuten-Niederschlag, 1-km-Raster, Jahresordner 2001–2026, Formate `bin/`, `asc/`, `netCDF/`; zusätzlich `5_minutes/radolan/recent/` mit Tagesarchiven (`YW-…tar.gz`, auch HDF5-Variante) bis 17.11.2026 — [reproc/2017_002/](https://opendata.dwd.de/climate_environment/CDC/grids_germany/5_minutes/radolan/reproc/2017_002/), [radolan/recent/](https://opendata.dwd.de/climate_environment/CDC/grids_germany/5_minutes/radolan/recent/)
- Radar-Komposits mit Hagelbezug, jeweils 5-minütig als HDF5 und nur als rollierendes Fenster von rund 48 h (577 Dateien je Verzeichnis am 19.11.2026): `composite/hymecng/` (Hydrometeorklassifikation), `composite/vii/` (vertikal integriertes Eis), `composite/hx/`; dazu `radar/mesocyclones/` (XML) — [weather/radar/composite/](https://opendata.dwd.de/weather/radar/composite/), [hymecng/](https://opendata.dwd.de/weather/radar/composite/hymecng/), [vii/](https://opendata.dwd.de/weather/radar/composite/vii/), [mesocyclones/](https://opendata.dwd.de/weather/radar/mesocyclones/)
- Die 3D-Radardaten (PZ-Produkt), aus denen KIT die Hagelzugbahnen ableitet, liegen laut Datenverfügbarkeitsangabe unter `opendata.dwd.de/weather/radar/sites/pz/` — [Mohr et al. 2026, Front. Environ. Sci.](https://www.frontiersin.org/articles/10.3389/fenvs.2026.1736782/full)

**KIT (Deutschland, Zugbahnen)**
- 15.577 potenzielle Hagelzugbahnen (PHT) für April–September 2005–2024 (rund 780 pro Jahr) aus 3D-Radar mit TRACE3D; öffentlich sind nur die DWD-Rohdaten und die Wetterregime, nicht der Zugbahnkatalog — [Mohr et al. 2026](https://www.frontiersin.org/articles/10.3389/fenvs.2026.1736782/full)
- Ältere Zugbahnen (2005–2014, Deutschland, Frankreich, Belgien, Luxemburg) sind "available upon request to Michael Kunz" — [Fluck et al. 2021, NHESS 21, 683](https://nhess.copernicus.org/articles/21/683/2021/)
- Schmidberger (2018) beschreibt ein stochastisches Zugbahnmodell aus 3D-Radar 2005–2015 und eine Vulnerabilitätsanalyse für Gebäude; die Dissertation ist Open Access — [KIT Scientific Publishing, doi:10.5445/KSP/1000086012](https://doi.org/10.5445/KSP/1000086012)

**ESSL / ESWD (Europa, Meldungen)**
- Nutzung der ESWD-Daten nur nach User's Agreement; "commercial use is not allowed"; die nicht-kommerzielle Vereinbarung (Fassung 17.04.2026) untersagt kommerzielle Nutzung und die Veröffentlichung von Rohdaten; ein Vertragsentwurf für kommerzielle Mitglieder ist auf Anfrage erhältlich, ein öffentlicher Preis wurde nicht gefunden — [ESSL ESWD](https://www.essl.org/cms/european-severe-weather-database/), [ESWD User Agreement 2026-04-17 (PDF)](https://www.essl.org/cms/wp-content/uploads/20260417_ESWD-User-Agreement-for-Non-Commercial-Use.pdf), [ESSL Membership](https://www.essl.org/cms/essl-membership/)

**Copernicus / ECMWF**
- Der CDS-Katalog listet 144 Datensätze; keiner trägt Hagel im Titel (Titelliste per Katalog-API abgerufen am 19.11.2026). Es gibt also keinen fertigen C3S-Hagelindikator im CDS — [CDS Catalogue API](https://cds.climate.copernicus.eu/api/catalogue/v1/collections)
- ERA5 "hourly data on single levels" (enthält CAPE) steht unter CC-BY-4.0 — [CDS: reanalysis-era5-single-levels](https://cds.climate.copernicus.eu/api/catalogue/v1/collections/reanalysis-era5-single-levels)
- AR-CHaMo (ESSL): statistisches Modell für Hagel ≥ 2 cm bzw. ≥ 5 cm aus ERA5-Prädiktoren (0,25°, stündlich), trainiert mit ESWD-Meldungen und ATDnet-Blitzdaten; Ausgaben "available from the corresponding author upon request" — [Battaglioli et al. 2023, NHESS 23, 3651](https://nhess.copernicus.org/articles/23/3651/2023/), [ESSL-Meldung](https://www.essl.org/cms/?p=14115)

**Open-Meteo (derzeitige Quelle)**
- Archive-API (`archive-api.open-meteo.com/v1/archive`, ERA5) liefert für `hourly=cape` nur `null` (Einheit "undefined"); getestet für 05.07.2015 — [Open-Meteo Archive API (Testabruf)](https://archive-api.open-meteo.com/v1/archive?latitude=50.11&longitude=8.68&start_date=2015-07-05&end_date=2015-07-05&hourly=cape)
- Historical-Forecast-API (`historical-forecast-api.open-meteo.com/v1/forecast`) liefert CAPE-Werte für Juli 2021 und 2022, aber `null` für 2017 und 2019 (ein Testpunkt) — [Open-Meteo Historical Forecast API (Testabruf)](https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=50.11&longitude=8.68&start_date=2021-07-05&end_date=2021-07-05&hourly=cape)

**MeteoSwiss (Schweiz und Grenzstreifen)**
- STAC-Sammlung `ch.meteoschweiz.ogd-radar-derived-grid` ("Spatial climate analyses - Hail"), Lizenz CC-BY, Ausdehnung 5,96–10,49° E / 45,82–47,81° N, NetCDF im Schweizer Raster LV95, 1 km (`ch01r`). Inhalt des Archiv-Items: jährliche und monatliche Hageltage gesamt, ≥ 2 cm und ≥ 4 cm für 2004–2025, Klimatologien, größte Korngröße je Monat, sowie Wiederkehrwert-Karten für 2, 5, 10, 20, 30, 50, 70 und 100 Jahre (MESHS und LEHA). DOI 10.18751/Climate/Griddata/CHHC/1.0 — [STAC collection](https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-radar-derived-grid), [Archiv-Item](https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-radar-derived-grid/items/archive-ch)
- Definition Hageltag: POH ≥ 80 % an einem Ort für mindestens 5 Minuten; Wiederkehrkarten mit dem Resampling-Verfahren HailStoRe — [MeteoSwiss Hail climatology](https://www.meteoswiss.admin.ch/climate/the-climate-of-switzerland/hail-climatology.html)
- Laufende Radarprodukte POH und MESHS: `ch.meteoschweiz.ogd-radar-hail`, CC-BY, 5-minütig, ODIM-HDF5 in EPSG:2056, nur die letzten 14 Tage, nur 1. April bis 30. September berechnet; Archiv auf Anfrage — [MeteoSwiss Open Data Doku](https://opendatadocs.meteoswiss.ch/d-radar-data/d3-hail-radar-products), [STAC collection](https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-radar-hail)

**Österreich, USA**
- GeoSphere Austria Data Hub: die Dataset-API listet 69 Datensätze, keiner enthält "hail" oder "hagel" in den Metadaten (Abruf 19.11.2026) — [dataset.api.hub.geosphere.at/v1/datasets](https://dataset.api.hub.geosphere.at/v1/datasets)
- NOAA MRMS auf AWS Open Data: Präfixe `CONUS/MESH_00.50/` und `MESH_Max_{30,60,120,240,360,1440}min_00.50/` vorhanden; SPC stellt Hagelmeldungen ab 1955 als CSV bereit (Download-Endpunkt antwortete mit HTTP 206) — [noaa-mrms-pds (S3-Listing)](https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&prefix=CONUS/MESH&delimiter=/), [SPC WCM](https://www.spc.noaa.gov/wcm/)

**Satellit (Overshooting Tops)**
- Punge et al. (2017) schätzen die Hagelhäufigkeit in Europa aus Overshooting-Top-Detektionen kombiniert mit ERA-Interim; Punge et al. (2014) bauen daraus einen stochastischen Ereigniskatalog — [doi:10.1016/j.atmosres.2017.07.025](https://doi.org/10.1016/j.atmosres.2017.07.025), [doi:10.1007/s11069-014-1161-0](https://doi.org/10.1007/s11069-014-1161-0)

### Inferences

Bewertung je Quelle für die App (Zugang / Eignung / Einbauort):

| Quelle | Wirklich offen? | Schlüssel | Format | Passt zu | Einschätzung |
| --- | --- | --- | --- | --- | --- |
| RADKLIM YW (DWD) | ja, CC BY 4.0 | keiner | RADOLAN-bin, ASCII, NetCDF in Tages-tar | Zonen-Fallback, Hagelhistorie | Für Live-Abfragen zu groß (10–35 MB je Tag laut Doku). Sinnvoll als einmalig vorberechnetes 1-km-Raster "Tage pro Jahr mit Kern ≥ Schwelle, April–September 2001–2025", das die App wie die PLZ-Umrisse einmal lädt. Bleibt ein Niederschlags-Proxy. |
| Historical-Forecast-API (Open-Meteo) | Daten CC BY 4.0, Gratis-API nur nicht-kommerziell | keiner | JSON | `weather.service.ts` | Kleinste Änderung gegen den Jahreszeit-Fehler: feste Sommerhalbjahre (z. B. April–September der letzten 4–5 Jahre) statt 92 Tage. CAPE erst ab etwa 2021 verfügbar. |
| ERA5 via CDS | ja, CC-BY-4.0 | kostenloses Konto mit Token | GRIB/NetCDF, Warteschlange | Zonen-Fallback | Nicht für Abfragen je Standort aus der Desktop-App geeignet; geeignet, um offline ein Klimatologie-Raster (z. B. Tage mit CAPE über Schwelle, 0,25°, 30 Jahre) zu erzeugen und mitzuliefern. Grob (rund 28 km). |
| MeteoSwiss Hagelklimatologie | ja, CC-BY | keiner | NetCDF (LV95) | Zone für Schweizer Standorte, Kalibrierung von p | Einzige geprüfte offene Quelle mit Häufigkeit nach Korngröße (≥ 2 cm, ≥ 4 cm) und Wiederkehrwerten. Für die App am besten offline in ein kleines WGS84-Raster umrechnen (NetCDF4/HDF5 und LV95 müssten sonst im Main-Prozess gelesen werden). |
| MeteoSwiss POH/MESHS live | ja, CC-BY | keiner | ODIM-HDF5 | Radararchiv (wie KONRAD3D) | Nur 14 Tage rollierend, nur Sommerhalbjahr; würde das lokale Archiv auf die Schweiz ausdehnen. HDF5-Parser nötig. |
| DWD HymecNG / VII | ja, CC BY 4.0 | keiner | HDF5, rund 48 h | Radararchiv | Könnte die Aussage "Zellumriss über dem Standort" auf Pixelklasse am Standort schärfen. HDF5-Parser nötig; Rasterweite nicht geprüft. |
| KIT-Zugbahnkatalog | nein (auf Anfrage) | – | – | λ je Zone, Ereigniswiedergabe | Fachlich die beste Grundlage für Deutschland (20 Jahre, 1 km, gegen GDV-Gebäudeschäden validiert). Nur über Anfrage und Lizenzabsprache. |
| ESWD | nein (kommerziell verboten) | Vereinbarung | – | – | Nicht einbaubar; allenfalls nutzerseitiger Import über die bestehende GeoJSON-Importfunktion, Lizenz liegt dann beim Nutzer. |
| AR-CHaMo | nein (auf Anfrage) | – | – | – | Nicht einbaubar. |
| NOAA SPC / MRMS | ja | keiner | CSV, GRIB2 | – | Nur relevant, falls US-Standorte bewertet werden; die App ist mit der deutschen PLZ-Tabelle faktisch auf Deutschland ausgerichtet. Niedrige Priorität. |
| GeoSphere Austria | kein Hageldatensatz im Data Hub | – | – | – | Für Österreich bleibt nur der Fallback. |

- Die Doku-Aussage, es gebe keinen offenen Hagelkatalog für Deutschland, bleibt am 19.11.2026 richtig; neu gegenüber dem dort notierten Stand ist, dass MeteoSwiss neben POH/MESHS auch die komplette Klimatologie samt Wiederkehrkarten offen per STAC anbietet.
- Der Grenzstreifen der MeteoSwiss-Daten reicht nur bis 47,81° N; für deutsche Standorte hilft das nur am Hochrhein und Bodensee.

### Gaps
- **DWD-Hagelklimatologie als Datensatz:** Eine radarbasierte Hagelkarte des DWD (Junghänel et al. 2016 wird in Mohr et al. 2026 zitiert) wurde auf dem Open-Data-Server nicht gefunden; ob sie über das DWD-Geoportal oder auf Anfrage erhältlich ist, wurde nicht geprüft.
- **GDV / Rückversicherer:** Öffentlich zugängliche Hagelzonen auf PLZ-Ebene von GDV, Swiss Re oder Munich Re wurden nicht gefunden; die Swiss-Re-Seite war nicht abrufbar (HTTP 403). Nicht verifiziert.
- **KNMI, Météo-France, HORA (Österreich):** Nicht verifiziert. KNMI-Katalog lieferte keine auswertbare Antwort (HTTP 202, leer), die HORA-Seite ist eine JavaScript-Anwendung ohne lesbaren Layerkatalog, Météo-France wurde nicht abgerufen.
- **Overshooting-Top-Klimatologie:** Titel und Erscheinungsort sind über Crossref bestätigt, eine offene Datenablage wurde nicht gefunden.
- **PZ-Verzeichnis und HymecNG-Auflösung:** `weather/radar/sites/` ist erreichbar (21 Unterordner), `pz/` wurde nicht einzeln geöffnet; die Rasterweite von HymecNG wurde nicht ermittelt.
- **DWD-Nutzermeldungen (Crowdsourcing):** Mohr et al. erwähnen sie als mögliche Korngrößenquelle; ob sie als Open Data vorliegen, wurde nicht geprüft.

## Frage 3: Welche veröffentlichte Evidenz gibt es zur Kalibrierung von λ, p und S für abgestellte Fahrzeuge?

### Takeaway
Für λ liefert Mohr et al. (2026) erstmals belastbare deutsche Punkt-Häufigkeiten (Median 0,3 potenzielle Hagelzugbahn-Tage pro km² und Jahr, Spitze 1,45 bei Reutlingen); für S gibt es Schadendurchschnitte aus der Kfz-Versicherung (rund 3.800–4.000 EUR je Schaden 2023/2024) und die einzige offene Schadenfunktion für Autos (Schmid et al. 2024, Schweiz). Für den Anteil beschädigter Fahrzeuge auf einem offenen Händlerhof und für die Größenverteilung p in Deutschland wurde keine öffentliche Quelle gefunden.

### Cited Findings

**Häufigkeit (λ)**
- Mittlere jährliche Zahl potenzieller Hagelzugbahnen je 1 × 1 km² in Deutschland (Sommerhalbjahre 2005–2024): Median 0,3 pro Jahr (25./75. Perzentil 0,2 / 0,4); Norddeutschland 0,1–0,3, Süddeutschland meist 0,3–0,6, Maximum 1,45 nahe Reutlingen — [Mohr et al. 2026](https://www.frontiersin.org/articles/10.3389/fenvs.2026.1736782/full)
- Zugbahnen: Median Länge 24,0 km (25./75. Perzentil 15,5 / 39,4 km), Breite 3,2 km (2,2 / 4,7 km), Zuggeschwindigkeit 33 km/h; meist von Südwest nach Nordost; Monatsanteile April 1,2 %, Mai 12,8 %, Juni 26,4 %, Juli 31,6 %, August 22,2 %, September 5,8 % — [Mohr et al. 2026](https://www.frontiersin.org/articles/10.3389/fenvs.2026.1736782/full)
- Validierung gegen Gebäudeversicherungsdaten: mittlerer Heidke Skill Score 0,5, regional 0,6–0,7 ("acceptable, though not exceptional") — [Mohr et al. 2026](https://www.frontiersin.org/articles/10.3389/fenvs.2026.1736782/full)
- Kein signifikanter bundesweiter Trend 2005–2024; regional Abnahme in Nord- und Mitteldeutschland, signifikante Zunahme an der Grenze Baden-Württemberg/Bayern — [KIT IMKTRO, HailClim](https://www.imktro.kit.edu/english/12970.php)
- Mit dem einfacheren 2D-Kriterium (Tagesmaximum ≥ 55 dBZ, 1 km, 2005–2014) ergeben sich deutlich höhere Werte: Maximum in Deutschland 3,1 Hageltage pro Jahr über der Schwäbischen Alb, bis 4,6 im Zentralmassiv — [Fluck et al. 2021](https://nhess.copernicus.org/articles/21/683/2021/)
- Schweiz: Hagelklimatologie aus POH/MESHS 2002–2014, gegen Schadenmeldungen eines Kfz-Versicherers verifiziert — [Nisi et al. 2016, QJRMS](https://doi.org/10.1002/qj.2771)

**Korngröße und Schadenart (Grundlage für die Klassen klein/mittel/groß)**
- TORRO-Skala: H3 (typisch 20–30 mm) Schäden an Glas und Kunststoff, Lack zerkratzt; H4 (25–40 mm) "vehicle bodywork damage"; H5 (30–50 mm) flächige Glaszerstörung — [TORRO Hailstorm Intensity Scale](https://www.torro.org.uk/research/hail/hscale)
- ESWD-Auswertung: Schäden an Dächern, Fahrzeugen und Fenstern werden meist bei Hagel über 4 cm gemeldet; zerstörte Fahrzeugscheiben nie unter 5 cm — [ESSL zu Púčik et al. 2019](https://www.essl.org/cms/?p=4175)
- MESHS ist erst ab 2 cm definiert; MeteoSwiss führt Hageltage getrennt für ≥ 2 cm und ≥ 4 cm — [MeteoSwiss Open Data Doku](https://opendatadocs.meteoswiss.ch/d-radar-data/d3-hail-radar-products), [STAC Archiv-Item](https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-radar-derived-grid/items/archive-ch)

**Schadenfunktion für Autos**
- Schmid et al. (2024): Sigmoid `f = S · v³/(1+v³)`, `v = max(MESHS − V_thresh, 0) / (V_half − V_thresh)`. Parameter für Autos: Anteil betroffener Fahrzeuge (PAA) V_thresh 8,1 mm, V_half 55,0 mm, Skala 0,046; Schadengrad bezogen auf den Gesamtwert (MDR) V_thresh 13,7 mm, V_half 53,3 mm, Skala 3,96 × 10⁻³ (Tabelle 2) — [Schmid et al. 2024, NHESS 24, 847](https://nhess.copernicus.org/articles/24/847/2024/)
- Datenbasis: über 50.000 Kfz-Schäden 2017–2021 eines privaten Versicherers, über 500.000 versicherte Autos pro Jahr mit Gesamtwert über 10 Mrd. CHF; Fahrzeugstandort nur als Zufallspunkt in der Wohngemeinde; 42 % der Kfz-Schäden lagen bei MESHS = 0 — [Schmid et al. 2024](https://nhess.copernicus.org/articles/24/847/2024/)
- Empirisch steigt die PAA für Autos von 0,2 % auf 2,75 % bei 60 mm MESHS, die MDR von 0,02 % auf 0,25 %; die niedrige PAA wird damit erklärt, dass Autos oft geschützt stehen (Garage) — [Schmid et al. 2024](https://nhess.copernicus.org/articles/24/847/2024/)
- Code unter GPL-3.0 (CLIMADA, doi:10.5281/zenodo.8308160); Schadendaten nicht öffentlich; Radardaten von MeteoSwiss für kommerzielle Nutzung lizenzpflichtig (Stand der Veröffentlichung) — [Schmid et al. 2024](https://nhess.copernicus.org/articles/24/847/2024/)

**Schadenhöhe je Fahrzeug (S)**
- ADAC Autoversicherung: durchschnittlich rund 3.860 EUR je Hagelschaden 2023, gegenüber rund 2.800 EUR 2019 (plus fast 40 % in vier Jahren) — [IWW Verkehrsrecht aktuell, 28.08.2024](https://www.iww.de/va/zivilrecht/kfz-kaskoversicherung-hagelschaeden-an-fahrzeugen-werden-immer-teurer-n162009)
- GDV-Bilanz 2024: rund 340.000 kaskoversicherte Fahrzeuge durch Unwetter beschädigt, 1,3 Mrd. EUR; in Bayern, Baden-Württemberg und Thüringen Durchschnitt über 4.000 EUR; 2023: rund 1,9 Mrd. EUR an 480.000 Fahrzeugen — [Autohaus/GDV, Schadenbilanz 2024](https://www.autohaus.de/nachrichten/schadenbusiness/schadenbilanz-2024-unwetter-richteten-1-3-mio-euro-kfz-schaeden-an-3683812)
- Hagelsturm vom 28.07.2013 bei Reutlingen: Hagel bis 10 cm, Schaden über eine Milliarde Euro — [KIT IMKTRO](https://www.imktro.kit.edu/english/12970.php)

**Heutige Platzhalter**
- λ je Zone 1–6: 0,01 / 0,02 / 0,04 / 0,07 / 0,10 / 0,15; p klein/mittel/groß 0,6 / 0,3 / 0,1; S 800 / 3.000 / 7.000 EUR; Σ p·S = 2.080 EUR; Fahrzeugwert 25.000 EUR — [shared/constants.ts](../../desktop-app/src/shared/constants.ts), [docs/risk-model.md](../../docs/risk-model.md)

### Inferences
- **λ gegen Radar einordnen:** Die Platzhalter-λ (0,01–0,15) liegen etwa bei einem Zehntel der PHT-Häufigkeit (0,1–1,45 pro km² und Jahr). Die Spreizung passt zufällig gut (Faktor 15 zwischen Zone 1 und 6 gegen etwa 0,1 bis 1,45). Daraus ergibt sich eine nachvollziehbare Kalibrierformel: `λ_z = f_PHT(z) × q`, mit `f_PHT` als Zonenmittel der Zugbahnhäufigkeit und `q` als Anteil der Durchgänge, die am Hof tatsächlich schadenwirksamen Hagel bringen. Die heutigen Werte entsprechen `q ≈ 0,1`. Dieser Anteil ist die eigentliche offene Größe und sollte so benannt werden.
- **Plausibilitätsrechnung Durchschnitt:** Gewichtet mit der PLZ-Verteilung ergibt sich ein mittleres λ von rund 0,033 und damit rund 68 EUR EAL je Fahrzeug und Jahr (0,27 % von 25.000 EUR). Das ist eine ungewichtete PLZ-Rechnung, keine Aussage über ein Portfolio.
- **S gegen Schadendurchschnitte:** GDV 2024 ergibt rechnerisch rund 3.820 EUR je beschädigtem Fahrzeug (1,3 Mrd. / 340.000), 2023 rund 3.960 EUR; beides über alle Naturgefahren, Privatfahrzeuge, nach Selbstbehalt. Σ p·S = 2.080 EUR liegt rund 45 % darunter. Das ist nicht zwingend falsch, weil S in der App für jedes Fahrzeug auf dem Hof gilt (auch gering getroffene), die Versicherungszahl aber nur gemeldete Schäden mittelt. Die App sollte diese Bezugsgröße beim Parameter nennen.
- **Schadengrad aus Schmid et al. (eigene Rechnung aus Tabelle 2):** MDR/PAA ergibt einen mittleren Schadengrad je betroffenem Auto von rund 6 % des Fahrzeugwerts bei 30 mm, 8 % bei 40 mm und 9 % bei 60 mm MESHS (PAA 0,43 % / 1,10 % / 2,65 %, MDR 0,026 % / 0,090 % / 0,244 %). Bezogen auf 25.000 EUR wären das 1.500–2.300 EUR. Die App-Klassen entsprechen 3,2 % / 12 % / 28 % des Fahrzeugwerts; die Klasse "groß" liegt damit beim Dreifachen des Schweizer Mittelwerts bei 60 mm. Einschränkung: Schweizer Privatfahrzeuge, Schadendaten nach Selbstbehalt, MESHS überschätzt die Fläche.
- **PAA nicht übertragbar:** Die PAA von höchstens 4,6 % gilt für Privatwagen mit unbekanntem Standort und Garagen. Für einen offenen Händlerhof ist der Anteil getroffener Fahrzeuge bei Hagel über dem Hof nahe 100 %; die App nimmt genau das an (jedes gezählte Fahrzeug wird in jedem Ereignis beschädigt). Diese Annahme ist für Höfe plausibel, sollte aber als Annahme in den Einschränkungen stehen.
- **Klassen an Korngrößen binden:** "klein / mittel / groß" hat in `constants.ts` keine Korngrößendefinition. Aus TORRO und ESWD ließe sich ohne neue Daten eine Definition ableiten: klein ungefähr 2–3 cm (Dellen möglich), mittel 3–5 cm (Karosserieschäden regelmäßig), groß ab 5 cm (Glasbruch). Damit würden auch der GeoJSON-Import (`≥ 3 cm large, ≥ 1 cm hail` laut Doku) und die EAL-Klassen dieselbe Skala nutzen; heute sind das zwei verschiedene Konventionen.
- **p kalibrieren:** Das Verhältnis der MeteoSwiss-Raster "Hageltage ≥ 4 cm" zu "≥ 2 cm" liefert einen offenen, gemessenen Anhaltspunkt für den Anteil großer Ereignisse, auch räumlich differenziert. Auf Deutschland übertragbar ist das nur als Größenordnung.

### Gaps
- **Fahrzeugschäden nach kinetischer Energie (Hohl et al. 2002):** Die Arbeit zu Autos wurde nur über Sekundärzitate gefunden (Dellen ab etwa 2 cm); Funktionsparameter und mittlere Schäden je Auto konnten nicht eingesehen werden. Nicht verifiziert.
- **Anteil beschädigter Fahrzeuge auf Händlerhöfen** und Schadendurchschnitte für Händlerbestand (Neuwagen, Hagelnetze, Großschäden einzelner Höfe): keine öffentliche Quelle gefunden.
- **Größenverteilung für Deutschland:** Mohr et al. verzichten ausdrücklich auf eine Intensitätsauswertung (ESWD-Größen zu Beginn des Zeitraums zu lückenhaft). Eine offene deutsche Häufigkeit nach Korngröße gibt es damit nicht.
- **GDV-Langzeitstatistik** (Schadenhäufigkeit und Schadendurchschnitt Kfz Sturm/Hagel je Jahr, Naturgefahrenreport-Datenservice) und die Zahl kaskoversicherter Fahrzeuge wurden nicht abgerufen; die GDV-Zahlen oben stammen aus Presseberichten über GDV-Mitteilungen. Die Bilanz 2025 (650 Mio. EUR Kfz-Naturgefahren) erschien nur als Suchtreffer und wurde nicht geöffnet.
- **Swiss Re sigma, Munich Re** (Anteil Hagel an Schäden aus schweren Gewittern, Münchner Hagel 1984): Seiten nicht abrufbar bzw. nicht geprüft. Nicht verifiziert.
- **Puskeiler et al. 2016 und Schmidberger 2018:** Kennzahlen (Hageltage je Rasterzelle, Wiederkehrperioden, eventuelle Kfz-Schadenfunktion) wurden nicht im Volltext geprüft.

## Frage 4: Wie behandeln veröffentlichte Hagelmodelle Unsicherheit, und was würde die Anzeige von Provenienz, Konfidenz und Einschränkungen konkret verbessern?

### Takeaway
Veröffentlichte Modelle geben Unsicherheit als Bandbreite und Trefferquote an (Bootstrap-Intervalle, Kreuzvalidierung, POD/FAR, "Faktor x"), nicht als einzelne Prozentzahl. Die App hat die nötigen Felder bereits im Schema, zeigt sie aber nicht an und verdichtet alles zu einem Mittelwert, der die Hagel-Unsicherheit nicht abbildet.

### Cited Findings
- Schmid et al.: 90-%-Bootstrap-Konfidenzintervall um die Schadenfunktionen, 5-fache Kreuzvalidierung; für Autos FAR 7 %, POD 74 % bei der Schadenanzahl und FAR 8 %, POD 60 % bei der Schadensumme; modellierte zu beobachteten Werten im Median innerhalb Faktor 3,8 (Anzahl) bzw. 5,4 (Summe), 75-%-Quantil über einer Größenordnung; "uncertainties of over 1 order of magnitude are common"; Hauptquelle der Unsicherheit ist die Radar-Hagelerkennung — [Schmid et al. 2024](https://nhess.copernicus.org/articles/24/847/2024/)
- MeteoSwiss liefert zu den Klimatologien die Standardabweichung mit, erzeugt Wiederkehrwerte per Resampling (HailStoRe), weist auf erhöhte Unsicherheit 2002–2012 (ältere Radargeneration) hin und rät wegen der kurzen Reihe von Trendaussagen ab — [STAC collection (Beschreibung)](https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-radar-derived-grid), [MeteoSwiss Hail climatology](https://www.meteoswiss.admin.ch/climate/the-climate-of-switzerland/hail-climatology.html)
- Mohr et al. geben für die Zugbahnen Verteilungen (Median und Quartile) und eine Validierung (HSS 0,5) an und benennen Abdeckungslücken des Radars an Landesgrenzen sowie Unsicherheiten der Versicherungsdaten — [Mohr et al. 2026](https://www.frontiersin.org/articles/10.3389/fenvs.2026.1736782/full)
- CLIMADA führt Unsicherheits- und Sensitivitätsanalysen als eigenes Modul (`unsequa`): Eingangsgrößen werden als Verteilungen variiert und der Beitrag je Größe ausgewiesen — [CLIMADA unsequa](https://climada-python.readthedocs.io/en/stable/user-guide/climada_engine_unsequa.html)
- Die App speichert je Evidenz `dataVersion`, `spatialResolution`, `retrievedAt`, `confidence`, `fallbackUsed`, `limitations`; angezeigt werden Quelle, Methode, Fallback und Konfidenz — [shared/types.ts `RiskEvidenceSchema`](../../desktop-app/src/shared/types.ts), [SourcesSections.tsx](../../desktop-app/src/renderer/src/components/dashboard/detail/SourcesSections.tsx)
- Die App zeigt bereits eine EAL-Spanne für den Fahrzeugbestand (`stockRange` mit `ealLow`, `ealMedian`, `ealHigh`) — [risk/financial-loss.ts `computeEalBreakdown`](../../desktop-app/src/main/services/risk/financial-loss.ts), [docs/risk-model.md](../../docs/risk-model.md)
- Die Exporte nennen λ/p/S ausdrücklich als Platzhalter — [main/services/export-content.ts, Zeilen 118 und 202](../../desktop-app/src/main/services/export-content.ts)

### Inferences
Konkrete Verbesserungen, alle mit vorhandenen Bausteinen:
1. **Vorhandene Felder anzeigen** (`SourcesSections.tsx`, bestehende `<details>`-Liste): je Quelle Datenstand, räumliche Auflösung, Abrufdatum und die Einschränkungen dieser Quelle. Für die PLZ-Zone: "PLZ-Fläche, Tabellenstand 2024, regional, nicht standortscharf".
2. **Evidenz korrekt befüllen** (`evidence.ts`): `dataVersion: "2024"` und Einschränkungen für die PLZ-Zone; kein `retrievedAt: now` für statische Tabellen (stattdessen Tabellenstand); Open-Meteo nur dann als Quelle, wenn der Proxy den Score bestimmt hat.
3. **Konfidenz als schwächstes Glied der Hagelkette** statt Mittelwert (`risk.service.ts`): Hazard-Konfidenz (Zone/Anbieter/Proxy) getrennt von der Expositions-Konfidenz (Grenze, Zählung) führen; die angezeigte Zahl darf nicht über der Hazard-Konfidenz liegen. Solange λ/p/S Platzhalter sind, sollte ein fester Deckel gelten und im Text stehen, dass die Zahl Datenqualität beschreibt, keine Eintrittswahrscheinlichkeit.
4. **Parameterspanne neben der Bestandsspanne:** Dieselbe Darstellung wie `stockRange` kann eine untere und obere EAL aus einer λ-Bandbreite tragen (z. B. Nachbarzonen z−1 / z+1 oder die Quartile 0,2 / 0,4 gegenüber dem Median 0,3 aus Mohr et al., also etwa ±35 %). Das macht sichtbar, dass die Zonenzuordnung selbst unscharf ist.
5. **Hagelhistorie als Gegenprobe anzeigen:** Im bestehenden Verlaufsbereich die beobachteten Hageltage pro Jahr der Station neben λ_z stellen, mit dem Hinweis, dass Stationshagel jede Korngröße zählt. Reine Anzeige, keine Verrechnung.
6. **Validierungsangaben der Quelle in die Einschränkungen:** Wo eine Quelle eine Trefferquote nennt (z. B. HSS 0,5 für radarbasierte Zugbahnen), gehört sie in `limitations`, damit die Qualifikation mit dem Ergebnis in die Exporte wandert.

### Gaps
- **FEMA National Risk Index (Hagel-EAL):** Die Methodikseite war nicht abrufbar (HTTP 403). Aus der Erinnerung, nicht verifiziert: EAL = Exposition × annualisierte Häufigkeit × historische Schadenquote mit Bayes-Glättung. Als Referenz für die Darstellung einer EAL mit Qualitätsstufen wäre das nachzuprüfen.
- Wie kommerzielle Hagelmodelle (Swiss Re, Munich Re, Verisk, Moody's) Unsicherheit je Standort ausweisen, ist nicht öffentlich dokumentiert bzw. wurde nicht gefunden.

## Frage 5: Gibt es methodische Fehler oder fragwürdige Annahmen in den Formeln?

### Takeaway
Die EAL-Formel ist in den Einheiten korrekt, aber drei Dinge sind fachlich angreifbar: der jahreszeitabhängige CAPE-Fallback, die vom Fahrzeugwert entkoppelten absoluten Schadenbeträge neben zwei weiteren, unabhängigen Schadensätzen, und die Abbildung von Anbieterwerten auf Zonen, bei der gelieferte Wiederkehrperioden verworfen werden.

### Cited Findings
- EAL = N × λ_z × Σ p_k·S_k; p wird auf Summe 1 normiert; jedes gezählte Fahrzeug zählt als exponiert (`exposedVehicles = max(0, vehicles)`) — [shared/risk-math.ts `computeHailEal`, `meanHailSeverityEur`](../../desktop-app/src/shared/risk-math.ts)
- S_k sind absolute Eurobeträge; die Exposition nutzt `vehicleValueCarEur` (25.000 EUR); die Szenarien nutzen Schadenanteile 5 / 15 / 30 / 55 % der Exposition; daneben existieren PML-Anteile 15 / 35 / 55 % — [shared/constants.ts](../../desktop-app/src/shared/constants.ts), [risk/exposure.ts](../../desktop-app/src/main/services/risk/exposure.ts), [risk-math.ts `computeScenarioImpact`, `computePML`](../../desktop-app/src/shared/risk-math.ts)
- `computePML` wird noch in `renderer/src/lib/sessionContext.ts` aufgerufen, obwohl die Doku die PML-Kachel als ersetzt beschreibt — [renderer/src/lib/sessionContext.ts](../../desktop-app/src/renderer/src/lib/sessionContext.ts), [docs/risk-model.md](../../docs/risk-model.md)
- `estimateHailZoneFromScore`: `1 + round(score / 20)`, geklemmt auf 1–6; `hailZoneToScore`: Zone 1 → 0, Zone 6 → 100 — [shared/risk-math.ts](../../desktop-app/src/shared/risk-math.ts)
- Bei Anbieterdaten ist `zoneSource: "provider"`, die Zone stammt aber aus dem Score und λ aus der Platzhaltertabelle; `returnPeriodYears` und `annualExceedanceProbability` werden nur gespeichert und für einen Hinweistext geprüft — [risk/financial-loss.ts `resolveHailZone`](../../desktop-app/src/main/services/risk/financial-loss.ts), [risk/evidence.ts `riskLimitations`](../../desktop-app/src/main/services/risk/evidence.ts)
- Akkumulation: Radius 10 km, Single-Linkage; Ko-Exposition mit fester Zugrichtung 70° und Korridoren 80 × 15, 160 × 30, 300 × 60 km — [shared/constants.ts `ACCUMULATION_RADIUS_KM`](../../desktop-app/src/shared/constants.ts), [risk-math.ts `isHailCoExposed`, `CORRIDOR_THRESHOLDS`](../../desktop-app/src/shared/risk-math.ts)
- Hagelsimulation: Zellbreiten 6 / 10 / 16 km (moderat / schwer / extrem), Geschwindigkeit 35–65 km/h, Lebensdauer 60–180 min — [shared/hail-sim.ts, Zeilen 24–26 und 278](../../desktop-app/src/shared/hail-sim.ts), [docs/risk-model.md](../../docs/risk-model.md)
- Beobachtete Zugbahnen: Median Breite 3,2 km, Länge 24 km, Geschwindigkeit 33 km/h; die längsten Bahnen (09.06.2014, 28.07.2013) erreichten bis 500 km — [Mohr et al. 2026](https://www.frontiersin.org/articles/10.3389/fenvs.2026.1736782/full), [Fluck et al. 2021](https://nhess.copernicus.org/articles/21/683/2021/)
- Radarbasierte Hagelstudien nutzen 55 dBZ (Mason-Kriterium) als Schwelle für 2D-Daten — [Mohr et al. 2026](https://www.frontiersin.org/articles/10.3389/fenvs.2026.1736782/full)
- Stationshistorie: Jahr zählt ab 180 gültigen Tagen unabhängig von der Jahreszeit; Mittel über Stationen ohne Distanzgewicht — [hail-history.service.ts `summarizeHail`, `MIN_VALID_DAYS_PER_YEAR`](../../desktop-app/src/main/services/hail-history/hail-history.service.ts)

### Inferences

**Befunde**
- **Einheiten:** Ereignisse/Jahr × EUR/(Fahrzeug·Ereignis) × Fahrzeuge = EUR/Jahr. Kein Einheitenfehler, keine Doppelzählung innerhalb der Formel.
- **S hängt nicht am Fahrzeugwert:** Wer den Fahrzeugwert auf 60.000 EUR setzt, erhöht Exposition, Akkumulation und Szenarioschäden, die EAL bleibt gleich. Umgekehrt kann ein editiertes S über dem Fahrzeugwert liegen; es gibt keine Kappung. Empfehlung: S als Anteil des Fahrzeugwerts führen oder mindestens auf den Fahrzeugwert kappen und in der Parametermaske den Anteil daneben anzeigen.
- **Drei unverbundene Schadensätze:** EAL-Klassen (3,2 / 12 / 28 % von 25.000 EUR), Szenario-Anteile (5 / 15 / 30 / 55 %, also 1.250 / 3.750 / 7.500 / 13.750 EUR je Fahrzeug) und PML-Anteile (15 / 35 / 55 %). Ein Radar-Ereignis der Klasse "Hagel" kostet im Stresstest 15 % je Fahrzeug, in der EAL 12 %; "großer Hagel" 30 % gegen 28 %; "Gemisch" 5 % gegen 3,2 %. Die Sätze sollten aus einer Tabelle abgeleitet oder ihr Unterschied begründet werden.
- **p und S sind zonenunabhängig, die Zone steuert nur λ:** Versicherungs-Hagelzonen bilden üblicherweise Schadenerfahrung ab, also Häufigkeit und Schwere zusammen. Wird die Zone nur als Häufigkeitsstufe gelesen, wird die Schwere in Hotspots tendenziell unterschätzt. Ob das hier zutrifft, hängt an der ungeklärten Herkunft der Tabelle.
- **Zonengrenzen sind harte Sprünge:** An PLZ-Grenzen springt die EAL um bis zu Faktor 2 (Zone 1 → 2) ohne Übergang, obwohl Zugbahnen nur wenige Kilometer breit sind und PLZ-Flächen Verwaltungsgrenzen sind. Eine Interpolation wäre Scheingenauigkeit; angemessen ist die Bandbreite über Nachbarzonen (siehe Frage 4).
- **Score-Skala:** Zone 1 ergibt Score 0 von 100; das liest sich wie "kein Risiko", obwohl λ₁ > 0 ist. Die Rückabbildung hat ungleiche Klassenbreiten: Zone 1 für Score unter 10, Zone 6 erst ab 90, die übrigen je 20 Punkte breit. Für Anbieterscores verschiebt das die Zonenverteilung zur Mitte.
- **Anbieterwerte:** Liefert ein Anbieter eine jährliche Überschreitungswahrscheinlichkeit oder Wiederkehrperiode, ist das direkt eine Häufigkeit und fachlich besser als der Umweg Score → Zone → Platzhalter-λ. Innerhalb des bestehenden Vertrags ließe sich λ dann aus dem Anbieterwert setzen und in `hailDetail` als solches kennzeichnen. Voraussetzung: Der Vertrag müsste festhalten, auf welche Korngröße sich die Angabe bezieht.
- **Ereignisgeometrie:** Die Simulationsvorgaben (6–16 km breit, 35–195 km lang, 35–65 km/h) liegen am oberen Rand der beobachteten Verteilung (Median 3,2 km breit, 24 km lang, 33 km/h). Für einen Stresstest ist das vertretbar, sollte aber so benannt oder an Median und Quartile angelehnt werden. Der Akkumulationsradius von 10 km ist quer zur Zugrichtung großzügig und längs eher knapp; die feste Richtung 70° passt zur Aussage "meist Südwest nach Nordost".
- **RADKLIM-Schwellen (eigene Umrechnung):** 9 mm in 5 min entsprechen nach Marshall–Palmer rund 55,5 dBZ und treffen damit das Mason-Kriterium; 6 mm (rund 53 dBZ) liegen darunter, 14 mm bei rund 58 dBZ. Die Klasse "Hagel" lässt sich also mit der Literatur begründen, die Klasse "Gemisch" nicht. Mit der DWD-üblichen Z-R-Beziehung (a = 256, b = 1,42) lägen 55 dBZ erst bei rund 12,5 mm in 5 min; welche Beziehung RADKLIM intern nutzt, bestimmt, welche Zahl gilt.
- **Stationshistorie:** Ein Jahr mit 180 gültigen Wintertagen zählt als beobachtet mit null Hageltagen. Da praktisch alle Hagelzugbahnen in April bis September fallen, sollte die Gültigkeitsregel die Abdeckung dieses Halbjahrs verlangen; sonst wird die Häufigkeit unterschätzt.
- **Bestandsschnappschuss und Selbstbehalt** sind in der Doku bereits als Einschränkungen benannt; hier kein neuer Befund.

**Rangfolge der Empfehlungen (Nutzen gegen Aufwand)**

| Rang | Maßnahme | Betroffene Stellen | Nutzen | Aufwand |
| --- | --- | --- | --- | --- |
| 1 | CAPE-Fallback von 92 Tagen auf feste Sommerhalbjahre umstellen (Historical-Forecast-API, mehrere Jahre), Wetter nur abrufen, wenn weder PLZ-Zone noch Anbieterwert vorliegt, Evidenz entsprechend; Tests für `dailyMaxCape` und die Proxy-Formel | `weather.service.ts`, `risk.service.ts`, `evidence.ts`, neue `weather.service.test.ts` | hoch (beseitigt Faktor-15-Artefakt, spart Abrufe, weniger Koordinaten nach außen) | gering |
| 2 | Herkunft der Zonentabelle klären und einheitlich benennen; `dataVersion`, Auflösung und Einschränkungen in die Evidenz; vorhandene Felder im Detaildialog anzeigen | `hail-zones.ts` (Kopf), `natcat-catalog.ts`, `hazard-models.ts`, `evidence.ts`, `SourcesSections.tsx`, `docs/risk-model.md` | hoch (Provenienz ist Projektregel) | gering |
| 3 | PLZ-Zuordnung absichern: Länderprüfung vor dem Tabellenzugriff; für Standorte ohne PLZ die Zone per Punkt-in-Polygon aus den bereits gecachten Overlay-Flächen bestimmen und als eigene Zonenquelle kennzeichnen | `analyze.service.ts` (`extractPostalCode`), `hail-zone-overlay/overlay.service.ts`, `financial-loss.ts` | hoch | gering bis mittel |
| 4 | Schadensätze zusammenführen: S an den Fahrzeugwert binden oder kappen, Szenario-Anteile und EAL-Klassen aus einer Quelle; Klassen mit Korngrößen definieren (TORRO/ESWD) und dieselbe Skala im GeoJSON-Import verwenden | `constants.ts`, `parameters.ts`, `risk-math.ts`, `hail-events.ts`, Parameterseite, Doku | mittel bis hoch | gering bis mittel |
| 5 | Konfidenz als schwächstes Glied der Hagelkette, Deckel bei Platzhalter-Parametern | `risk.service.ts`, `evidence.ts` | mittel | gering |
| 6 | Anbieter-AEP bzw. Wiederkehrperiode für λ nutzen, wenn geliefert; Score-Zonen-Abbildung mit gleich breiten Klassen | `financial-loss.ts` (`resolveHailZone`), `risk-math.ts`, Vertragstext in `docs/risk-model.md` | mittel | gering |
| 7 | Kalibrieranker in Parameterseite, Methodikblock der Exporte und Doku: λ = Zugbahnhäufigkeit × Schadenanteil mit den Zahlen aus Mohr et al.; S gegen ADAC/GDV-Durchschnitte; λ-Bandbreite in der bestehenden Spannendarstellung | `export-content.ts`, `docs/risk-model.md`, `financial-loss.ts`, EAL-Detail | mittel | mittel |
| 8 | Hagelhistorie: Gültigkeitsregel auf April–September, Stationswert neben λ anzeigen | `hail-history.service.ts`, Detaildialog | mittel | gering |
| 9 | Vorberechnetes Hagel-Proxy-Raster für Deutschland aus RADKLIM (Tage pro Jahr mit Kern ≥ 55-dBZ-Äquivalent, 2001–2025) als Ersatz für den CAPE-Fallback und als Gegenprobe zur PLZ-Zone; Verteilung wie die PLZ-Umrisse (einmaliger Download, CC BY 4.0 mit DWD-Nennung) | neues Datenartefakt, `weather.service.ts` bzw. Zonenauflösung, `evidence.ts` | hoch | hoch (einmalige Aufbereitung von rund 25 Jahren 5-Minuten-Daten, Validierung nötig) |
| 10 | MeteoSwiss-Klimatologie für Schweizer Standorte (Zone aus Hageltagen ≥ 2 cm) und als Anhaltspunkt für p | vorberechnetes Raster, Zonenauflösung | mittel | mittel |
| 11 | Simulationsvorgaben an beobachtete Zugbahnverteilung anlehnen oder als oberes Ende kennzeichnen; RADKLIM-Klasse "Gemisch" begründen oder umbenennen | `hail-sim.ts`, `radklim.service.ts`, Doku | gering bis mittel | gering |
| 12 | Overlay-Download auf eine feste Release-Version mit Prüfsumme legen; Tabellenstand im Overlay-Objekt mitführen | `overlay.service.ts` | gering | gering |
| 13 | HymecNG-Pixelklasse im Radararchiv; MeteoSwiss POH/MESHS im Archiv | `radar-hail.service.ts` | mittel | hoch (HDF5-Parser, Speicher) |
| 14 | Extern anfragen: KIT-Zugbahnraster (1 km, 2005–2024) und kommerzielle ESWD-Vereinbarung | – | potenziell hoch | abhängig von Dritten |

Alle Punkte, die λ, p, S oder die Zonenauflösung ändern, brauchen nach der Projektregel eine kurze Methodiknotiz, deterministische Fixtures und eine neue Modellversion; die Qualifikation als Screening-Schätzung bleibt in jedem Fall stehen.

### Gaps
- Ob K-Kasko-artige Zonen in der vorliegenden Tabelle Häufigkeit, Schwere oder Schadenbedarf abbilden, ist ohne Kenntnis der Herkunft nicht zu entscheiden; davon hängt ab, ob die Zone nur λ oder auch S steuern sollte.
- Welche Z-R-Beziehung RADKLIM YW verwendet und ob Werte bei Hagel gekappt werden, wurde nicht geprüft; davon hängt die dBZ-Entsprechung der Kernschwellen ab.
- Die Kernschwellen und ein RADKLIM-Proxy-Raster wurden nicht gegen Schadendaten oder die KIT-Zugbahnen validiert; die eine dokumentierte Stichprobe (28.07.2013) ersetzt das nicht.
- Nicht geprüft: Verhalten von `computeClusterRisk` (0,5°-Raster in `shared/analytics.ts`) und `isHailCoExposed` in der Oberfläche; die Aussagen dazu beruhen nur auf dem Code in `risk-math.ts`.
