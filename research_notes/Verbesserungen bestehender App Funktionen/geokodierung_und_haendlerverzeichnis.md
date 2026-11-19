# Geokodierung, Ortssuche, Händlerverzeichnis, Ortsdetails und Portfolio-Import: Schwächen und bessere offene Datenquellen (Stand 19. November 2026)

Hinweise zur Lesart: Code-Befunde verweisen auf Dateien im Repository (relative Links ab dieser Notiz). Externe Aussagen sind mit der abgerufenen Quelle belegt; was nur aus Vorwissen stammt oder nicht live geprüft werden konnte, ist als **ungeprüft** markiert. Es wurden nur lesende Web-Abrufe gemacht, keine Projekt- oder Nutzerdaten gesendet, keine Dateien im Repository außer dieser Notiz geändert.

---

## 1. Welche Geocoder, Orts- und Händlerquellen nutzt die App heute (Fallbacks, Rate-Limits, Cache, Länderabdeckung) und wo landen Adressen falsch?

### Takeaway
Die Import-/Analyse-Geokodierung hängt an genau einem Dienst (öffentliches Nominatim, zwei Anfragen pro Zeile, kein zweiter Geocoder als Fallback); nur in 8 Bundesländern korrigiert ein ALKIS-Hauskoordinaten-WFS den Punkt. Die Suche (Photon + lokales Overture-Verzeichnis) ist deutlich robuster gebaut als die Massen-Geokodierung, und das lokale Verzeichnis wird für den Import gar nicht genutzt.

### Cited Findings

**Ist-Zustand Geokodierung (Import/Analyse)**
- Einziger Geocoder ist `https://nominatim.openstreetmap.org/search` mit Freitext-`q`, `format=jsonv2&addressdetails=1&limit=5`; kein `countrycodes`, kein `accept-language`, keine strukturierte Abfrage, kein `viewbox`. Übernommen werden nur `display_name`, `lat/lon`, `name`, `category`, `type`, `postcode`, `house_number`; `place_rank`, `addresstype`, `osm_type`, `importance` werden verworfen. — [geocoding.service.ts](../../desktop-app/src/main/services/geocoding.service.ts)
- Pro Zeile ohne Koordinaten gehen **zwei** Nominatim-Anfragen raus: erst `address`, dann `"${name}, ${address}"`; beide Trefferlisten werden mit `pickGeocodeHit` bewertet (PLZ +2/−3, Hausnummer +1, Name +2, Kfz-POI-Typ +1). Liefert die Adress-Anfrage keine Treffer, wirft `geocodeDealership` „Address could not be resolved" — es gibt keine Abschwächung (ohne Hausnummer, nur PLZ+Ort), keinen zweiten Dienst, keinen Blick ins lokale Verzeichnis. — [analyze.service.ts](../../desktop-app/src/main/services/analyze.service.ts)
- Rate-Limit: `HOST_POLICIES` setzt für `nominatim.openstreetmap.org` 1 100 ms Mindestabstand und 1 gleichzeitige Anfrage; Standard-Retry (2 Wiederholungen, 250 ms × 2ⁿ) gilt auch für 429. Einen Cooldown nach 403/429 wie bei Photon gibt es für Nominatim nicht. — [http.service.ts](../../desktop-app/src/main/services/http.service.ts)
- Cache: Schlüssel `geocode:v2:<query lower/trim>`, TTL 30 Tage, in SQLite `api_cache`; abgelaufene Einträge bleiben als Offline-Fallback liegen (`cached()` liefert bei Fehler den alten Wert), `pruneExpired` wird nur für Kacheln (`tile:`) aufgerufen. Leere Trefferlisten (`[]`) werden genauso 30 Tage gecacht wie Treffer. — [cache.service.ts](../../desktop-app/src/main/services/cache.service.ts), [geocoding.service.ts](../../desktop-app/src/main/services/geocoding.service.ts)
- User-Agent ist fest `DealershipRiskMapping-Desktop/0.1 (contact: internal)` (9 Fundstellen in `src/main`), die App-Version ist aber 0.5.0 und „internal" ist kein erreichbarer Kontakt. — [geocoding.service.ts](../../desktop-app/src/main/services/geocoding.service.ts), [package.json](../../desktop-app/package.json)
- Offizielle Hauskoordinaten als Nachkorrektur: INSPIRE-Adress-WFS von NI, SN, SH, BB, MV, BW, SL plus Berlin-WFS; Suche 400 m um den Nominatim-Punkt mit FES-Filter auf Hausnummer, Abgleich über normalisierten Straßennamen + PLZ; bei Treffern > 30 m auseinander keine Wahl. Nicht abgedeckt: Hamburg, NRW, Hessen, Thüringen, Rheinland-Pfalz, Sachsen-Anhalt, Bremen, Bayern. — [house-coordinates.service.ts](../../desktop-app/src/main/services/house-coordinates.service.ts), [docs/official-buildings.md](../../docs/official-buildings.md)
- Die Vorschau „Adressen prüfen" im Importdialog ruft `window.api.geocode(address)` und nimmt den **ersten** Nominatim-Treffer (`const [hit] = …`), nicht die Auswahl-Logik `pickGeocodeHit` der Analyse. Der Haken „gefunden" kann also einen anderen Punkt zeigen als später analysiert wird; die Genauigkeitsstufe (Haus/Straße/Ort) wird nicht angezeigt. — [PortfolioImportDialog.tsx](../../desktop-app/src/renderer/src/components/upload/PortfolioImportDialog.tsx)

**Ist-Zustand Suche (Type-ahead)**
- Photon (`https://photon.komoot.io/api`): pro Tipp-Pause (Debounce 300 ms) zwei Anfragen — eine mit `osm_tag=shop:car` (Limit 5), eine allgemein (Limit 8) — mit `lang=de`, `lat/lon/zoom`-Bias (Ort aus der Anfrage, sonst Kartenausschnitt, sonst Deutschland). In-Memory-Cache 10 min/200 Einträge, kein Retry, Timeout 6 s, Cooldown 2–15 min nach Fehler/403/429/5xx; `HOST_POLICIES` begrenzt auf 2 parallele Anfragen. Kein `countrycode`, kein `bbox`, kein `layer`. — [places.service.ts](../../desktop-app/src/main/services/places.service.ts), [Omnibox.tsx](../../desktop-app/src/renderer/src/components/upload/Omnibox.tsx), [http.service.ts](../../desktop-app/src/main/services/http.service.ts)
- Lokales Overture-Verzeichnis: SQLite-FTS5-Präfixsuche (bm25-Gewichte Name 10, Marke 3, Straße 1, PLZ 2, Ort 2), Tippfehler-Auffüllung per Trigramm-Dice ≥ 0,6, Ortserkennung aus den eigenen Adressen (Median der Händler je Ort/PLZ, Radius 30 km bzw. 8 km). — [dealer-directory.service.ts](../../desktop-app/src/main/services/dealer-directory.service.ts), [directory-index.ts](../../desktop-app/src/main/services/dealer-directory/directory-index.ts)
- Zusammenführen/Ranking: gleiche OSM-ID, gleiches Label < 75 m, oder quellenübergreifend ähnlicher Name < 150 m; Score aus 8 Signalen (Text 4, Art 1,5, bestätigt 0,75, Ort ±1, Portfolio 1, Nähe 0,5, Quellrang −0,15, ungefähr −1). — [place-ranking.ts](../../desktop-app/src/main/services/place-ranking.ts), [docs/location-search.md](../../docs/location-search.md)
- Ortsdetails: Overpass `nwr(around:500)["shop"|"amenity"]`, Auswahl des Händler-POI per Namens-/Kategorie-Score; gelesen werden nur name, shop/amenity, website, phone, email, opening_hours, brand, addr:*. Cache 7 Tage. — [osmDetails.service.ts](../../desktop-app/src/main/services/osmDetails.service.ts)

**Länderabdeckung**
- Faktisch nur Deutschland: `GERMANY_BBOX` und `country = DE` im Verzeichnis, PLZ-Regex `\b\d{5}\b` in `pickGeocodeHit`, `parseStreetAddress`, `parsePlaceQuery` und `matchesSite`, Default-Bias Photon = Mitte Deutschlands, Hauskoordinaten nur deutsche Länder. — [overture-dealers.ts](../../desktop-app/src/main/services/dealer-directory/overture-dealers.ts), [place-query.ts](../../desktop-app/src/main/services/place-query.ts), [site-membership.ts](../../desktop-app/src/main/services/boundary/site-membership.ts)

**Konkrete Fehlstellen (wo Adressen scheitern oder falsch landen)**
- Straßenmitte statt Gebäude: Nominatim interpoliert Hausnummern oder trifft die Straße; die App erkennt das nicht, weil `place_rank`/`addresstype` nicht ausgewertet werden. Korrektur nur dort, wo ein Hauskoordinaten-WFS existiert (8 Länder); die Dokumentation nennt 25–344 m Verschiebung bei den 8 Testadressen. — [docs/official-buildings.md](../../docs/official-buildings.md)
- Hausnummern-Erkennung in `pickGeocodeHit` nimmt die **erste** Zahl nach Entfernen der PLZ (`/\b\d+\s*[a-z]?\b/i`): bei „Straße des 17. Juni 135", „An der B 96 Nr. 4", „Halle 3, Musterstr. 12" wird die falsche Zahl als Hausnummer gewertet; `matchesSite` nimmt sogar die erste Zahl inklusive PLZ-Kandidaten. — [geocoding.service.ts](../../desktop-app/src/main/services/geocoding.service.ts), [site-membership.ts](../../desktop-app/src/main/services/boundary/site-membership.ts)
- `parseStreetAddress` verlangt „Straße + 1–4 Ziffern + optional ein Buchstabe" am Ende eines Komma-Teils; Postfach-Adressen, „c/o", Gewerbepark-Bezeichnungen ohne Nummer oder „12 a-c" liefern `null` → keine Hauskoordinate, ohne dass der Nutzer das erfährt. Postfächer werden nirgends als solche erkannt und vor der Geokodierung markiert. — [house-coordinates.service.ts](../../desktop-app/src/main/services/house-coordinates.service.ts)
- Mehrstandort-Händler: gleiche Namen an verschiedenen Orten werden über PLZ-Widerspruch (−3) getrennt; ohne PLZ in der Importzeile fehlt dieses Signal ganz, und die Mehrdeutigkeitswarnung greift nur, wenn zwei Treffer < 1 Punkt auseinander und > 100 m entfernt sind. — [geocoding.service.ts](../../desktop-app/src/main/services/geocoding.service.ts)
- Overture-Einträge ohne Straße liegen teils weit daneben (dokumentierter Fall: 1 km im Wald); sie werden nur zur Suchzeit ausgefiltert, wenn ein gleichnamiger Eintrag mit Straße in 30 km unter den Kandidaten ist. Im gespeicherten Verzeichnis bleiben Dubletten je Datenlieferant erhalten. — [docs/location-search.md](../../docs/location-search.md), [place-ranking.ts](../../desktop-app/src/main/services/place-ranking.ts)
- Ortserkennung kennt nur Orte mit mindestens einem Overture-Händler und liest „Autohaus Hof" als Stadt Hof (dokumentierte Einschränkung). — [docs/location-search.md](../../docs/location-search.md)
- Markenaliase sind vier handgepflegte Gruppen (VW, Mercedes, Land Rover, Chevrolet); alles andere (z. B. „Škoda/Skoda" nur über Faltung, „Citroën/DS", „Seat/Cupra", „BMW/Mini", „Stellantis-Marken") fehlt. — [place-query.ts](../../desktop-app/src/main/services/place-query.ts)

### Inferences
- Das größte strukturelle Risiko ist die Ein-Dienst-Abhängigkeit im Import: ein 403/429 von Nominatim lässt jede adress-basierte Zeile mit Fehler enden, während die Suche bei Photon-Ausfall lokal weiterläuft. Die gleiche Degradationslogik (Cooldown + lokaler Fallback) fehlt im Importpfad.
- Weil `place_rank`/`addresstype` verworfen werden, kann die App nicht deterministisch entscheiden, ob die zweite (Namens-)Anfrage überhaupt nötig ist; sie sendet sie immer. Eine Genauigkeitsstufe am Anker („Gebäude / Straße / Ort") würde gleichzeitig Review-Hinweise, Provenienz und die Halbierung der Anfragen ermöglichen.
- Die 30-Tage-Negativ-Cachung führt dazu, dass eine wegen Tippfehler/temporärem Problem nicht gefundene Adresse nach Korrektur in OSM oder nach einer Dienststörung einen Monat „nicht gefunden" bleibt, sofern der Abfragetext identisch ist.

### Gaps
- Wie oft Nominatim in den Testportfolios (10–500 Zeilen) tatsächlich auf Straßenniveau statt Hausniveau landet, wurde nicht gemessen (kein Lauf gegen externe Dienste; Portfoliodaten sollten nicht versendet werden). Empfehlung: Messung über den vorhandenen Replay-/Cache-Bestand.
- Ob der Commit „addresses with a leading name are read (cascade v13)" auch `parseStreetAddress`/`pickGeocodeHit` betrifft oder nur die Boundary-Kaskade, wurde nicht im Detail nachvollzogen.

---

## 2. Entspricht die heutige Nutzung den Nutzungsbedingungen der Dienste (Nominatim, Photon, Overpass, Overture)? Was muss sich konkret ändern?

### Takeaway
Rate-Limit, Single-Thread und Caching für Nominatim sind eingehalten, aber drei Punkte der Nominatim-Richtlinie sind nicht erfüllt: aussagekräftige Identifikation, Abschaltbarkeit/Umschaltbarkeit ohne Software-Update und der Grundsatz, Massen-Geokodierung und vertrauliche Daten nicht auf den öffentlichen Dienst zu legen. Photon, Overpass und Overture werden regelkonform genutzt; bei Photon ist ein verwendeter Parameter inzwischen als veraltet dokumentiert.

### Cited Findings

**Nominatim (öffentliche Instanz)**
- Die Richtlinie verlangt höchstens „an absolute maximum of 1 request per second", einen gültigen Referer oder User-Agent, der die Anwendung identifiziert (Standard-Bibliotheks-UAs reichen nicht), sichtbare Attribution und nennt ODbL. — [OSMF Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- Für Apps gilt: die Limits zählen pro Anwendung über alle Nutzer zusammen; Apps sollen den Dienst auf Anforderung des Betreibers jederzeit wechseln/abschalten können, ohne dass ein Software-Update nötig ist; ein Proxy mit Cache wird empfohlen; periodische Anfragen aus Apps gelten als Bulk-Geokodierung und sind stark unerwünscht. — [OSMF Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- Bulk-Geokodierung größerer Mengen ist unerwünscht; kleinere einmalige Aufgaben sind unter Zusatzregeln möglich: ein Thread, eine Maschine, Ergebnisse lokal cachen, wiederholt gleiche Anfragen können zur Sperre führen; Skripte, die länger als einen Tag oder regelmäßig laufen, sind auf 4 Anfragen pro Minute begrenzt. — [OSMF Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- Verboten sind u. a. clientseitiges Autocomplete über die API und systematische Abfragen; die Richtlinie bittet außerdem, keine personenbezogenen oder vertraulichen Daten an die Dienste zu senden. Neu ist ein Abschnitt zu LLM-generiertem Code und No-/Low-Code-Plattformen: solcher Code muss die Richtlinie einhalten und die Einschränkungen dem Nutzer erklären. — [OSMF Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- App heute: 1,1 s Abstand und 1 paralleler Request (erfüllt), 30-Tage-Cache (erfüllt), Autocomplete läuft über Photon, nicht Nominatim (erfüllt). Nicht erfüllt: UA mit falscher Version und ohne echten Kontakt; Nominatim-URL ist eine Konstante ohne Einstellung; 429 wird nach 250/500 ms (plus Gate) erneut versucht statt pausiert; pro Zeile zwei Anfragen (500 Zeilen = bis zu 1 000 Anfragen ≈ mindestens 18 Minuten Dauerlast auf einem Gemeinschaftsdienst). — [geocoding.service.ts](../../desktop-app/src/main/services/geocoding.service.ts), [http.service.ts](../../desktop-app/src/main/services/http.service.ts), [analyze.service.ts](../../desktop-app/src/main/services/analyze.service.ts)
- Nominatim bietet `countrycodes` (harter Filter), strukturierte Parameter (`street`, `city`, `postalcode`, `country`; nicht mit `q` kombinierbar), `layer` (address, poi, …), `email` für größere Anfragevolumen, `limit` bis 40 und in jsonv2 die Felder `place_rank`, `addresstype`, `osm_type`, `importance`. — [Nominatim Search API](https://nominatim.org/release-docs/latest/api/Search/)

**Photon (photon.komoot.io)**
- Nutzungsbedingung der öffentlichen Instanz: Nutzung für eigene Projekte erlaubt, bitte fair bleiben, intensive Nutzung wird gedrosselt; keine Verfügbarkeitsgarantie, Änderungen vorbehalten. Zahlenmäßige Limits werden nicht genannt. — [photon.komoot.io](https://photon.komoot.io/)
- Aktuelle API-Dokumentation: `osm_tag` ist als **deprecated** markiert, bevorzugt werden die Kategorie-Filter `include`/`exclude`; verfügbar sind außerdem `layer` (house, street, locality, district, city, county, state, country, other), `bbox`, `countrycode` (mehrfach möglich), `location_bias_scale`, `dedupe`; es gibt einen `/structured`-Endpunkt (countrycode, state, county, city, postcode, district, housenumber, street). — [Photon API v1 (GitHub)](https://raw.githubusercontent.com/komoot/photon/master/docs/api-v1.md)
- App heute: nutzt `osm_tag=shop:car`, kein `countrycode`, kein `layer`; Cooldown, Cache und „kein Retry" sind bereits fair-use-freundlich umgesetzt. — [places.service.ts](../../desktop-app/src/main/services/places.service.ts)

**Overpass (öffentliche Instanzen)**
- Richtwert der Hauptinstanz: etwa 10 000 Anfragen und rund 1 GB pro Tag; mehrere Slots pro Nutzer, Ablehnung per HTTP 429; wer mehr braucht, soll eine eigene Instanz betreiben. — [Overpass API Manual – Commons](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)
- App heute: 2 parallele Anfragen je öffentlicher Instanz, OSM in der Analyse nur aus dem Cache (0 ms Wartezeit ohne eigenen Server), Ortsdetails mit 15 s Budget, eigene Overpass-URL einstellbar. Das liegt klar innerhalb der Richtwerte. — [http.service.ts](../../desktop-app/src/main/services/http.service.ts), [docs/local-overpass.md](../../docs/local-overpass.md)

**Overture**
- Places-Lizenzen je Quelle: Meta, Microsoft, PinMeTo, Krick, RenderSEO, DAC, BrightQuery, Birdeye, Uberall, OpenTravel Alliance = CDLA Permissive 2.0; Foursquare = Apache 2.0 mit Pflichtvermerk; AllThePlaces = CC0 1.0. — [Overture Attribution](https://docs.overturemaps.org/attribution/)
- Overture veröffentlicht monatlich; seit dem Release vom 24. September 2025 gilt eine Aufbewahrungsrichtlinie: Releases sind höchstens 60 Tage öffentlich verfügbar, begründet mit Datenschutz-/Löschpflichten. — [Overture Release Notes 2025-09-24](https://docs.overturemaps.org/blog/2025/09/24/release-notes/), [Overture Release Calendar](https://docs.overturemaps.org/release-calendar/)
- App heute: lädt ca. 500 MB per Range-Requests aus dem öffentlichen S3-Bucket, Host-Allowlist auf `stac.overturemaps.org` und den S3-Bucket, zeigt Foursquare-Vermerk in den Einstellungen; die lokale Kopie „altert, bis der Nutzer Aktualisieren klickt". Das Feld `sources` (Lieferant/Lizenz je Datensatz) wird nicht gelesen. — [overture-dealers.ts](../../desktop-app/src/main/services/dealer-directory/overture-dealers.ts), [docs/dealer-directory.md](../../docs/dealer-directory.md)

### Inferences
- Konkreter Änderungsbedarf Nominatim (alles in bestehenden Dateien, kein neues UI-Bauteil):
  1. User-Agent aus `app.getVersion()` + Kontakt-URL des Projekts (Issue-Tracker) an einer Stelle erzeugen statt neunmal als Konstante; optional `email`-Parameter weglassen (keine Nutzerdaten).
  2. Geocoder-Basis-URL als Einstellung in der vorhandenen Karte „OpenStreetMap-Daten" (gleiche Validierung wie `shared/overpass-url.ts`: HTTPS oder localhost, ohne Credentials/Query). Damit ist die App „umschaltbar ohne Update" und Vielnutzer können ein eigenes Nominatim/Photon eintragen. Die öffentliche Instanz bleibt Default.
  3. Nach 403/429 denselben Cooldown-Mechanismus wie `pausePhoton` (inkl. `Retry-After`) verwenden und 429 aus den Retry-Status für diesen Host herausnehmen.
  4. Anfragen pro Zeile von 2 auf im Regelfall 1 senken (Namensanfrage nur, wenn der Adresstreffer nicht auf Hausniveau liegt) und `countrycodes=de` setzen.
  5. Im Importdialog bei großen Dateien deutlich sagen, dass die Adressprüfung den öffentlichen OSM-Dienst mit 1 Anfrage/s nutzt (der Hinweis steht bisher nur im Code-Kommentar).
- Die 60-Tage-Regel von Overture bedeutet: eine lokale Kopie, die älter als ~60 Tage ist, kann Einträge enthalten, die Overture auf Löschantrag entfernt hat. Die vorhandene „Update verfügbar"-Anzeige sollte ab diesem Alter deutlicher werden (gleiche Stelle, anderer Text), statt die Kopie unbegrenzt altern zu lassen.
- Photon: `osm_tag` → `include`-Filter umstellen, sobald geprüft ist, welche Kategorien die öffentliche Instanz anbietet; `countrycode=de` und bei Adressabsicht `layer=house&layer=street` reduzieren Fehltreffer und Last.

### Gaps
- Die Nominatim-Richtlinie konnte nur als Zusammenfassung mit Kurz-Zitaten abgerufen werden, nicht als vollständiger Wortlaut; die exakten Formulierungen zu „Apps müssen umschaltbar sein" sollten vor einer Code-/Doku-Änderung noch einmal im Original gelesen werden.
- Ob die öffentliche Photon-Instanz die `include`-Kategorien (z. B. `osm.shop.car`) und `/structured` tatsächlich aktiviert hat, ist **ungeprüft** (die Doku sagt, Kategorien hängen von der Installation ab).
- Ob die ODbL-Attribution an allen Stellen sichtbar ist, an denen Nominatim-/Photon-Ergebnisse gezeigt werden, wurde nur per Vorhandensein des Texts in `locales/de.json`/`en.json` geprüft, nicht in der laufenden App.

---

## 3. Welche offenen Adress-/Geokodierquellen verbessern die Gebäude-Genauigkeit innerhalb der bestehenden Geokodier-Kaskade?

### Takeaway
Der größte Hebel ohne neuen Host ist das Overture-Addresses-Theme: es enthält amtliche Adresspunkte aus 15 Bundesländern (alle außer Bayern) und lässt sich mit der vorhandenen STAC-/hyparquet-Technik lesen — genau die Länder, in denen der heutige WFS-Weg keine Abdeckung hat (NRW, HE, TH, RP, ST, HB, HH). BKG-Geokodierdienst und bundesweite HK-DE sind nicht offen; libpostal und ein gebündelter eigener Geocoder passen nicht in eine Desktop-App, ein vom Nutzer betriebener Nominatim/Photon dagegen schon (über eine einstellbare URL).

### Cited Findings

| Quelle | Zugriff / Endpunkt | Abdeckung | Aktualität | Lizenz | Einschätzung für die App |
| --- | --- | --- | --- | --- | --- |
| **Overture Addresses** (Theme `addresses`, Typ `address`) | GeoParquet unter `s3://overturemaps-us-west-2/release/<release>/theme=addresses/type=address/*` bzw. Azure-Spiegel; Release über `stac.overturemaps.org` | 41 Länder, > 475 Mio. Punkte; Deutschland 19,3 Mio. („partial coverage"), AT 2,5 Mio., CH 3,3 Mio., NL 10,0 Mio., FR 26,1 Mio., DK 3,9 Mio., BE 7,0 Mio. | monatlich | je Quelle; DE: BW, BB, HH, RP, SL, SN, ST, TH = DL-DE→BY-2.0; BE, HE, NW = DL-DE→Zero-2.0; HB, MV, NI, SH = CC BY 4.0 | **Empfohlen.** Hosts bereits erlaubt. Bayern fehlt. Theme ist Alpha, IDs instabil, Punktlage uneinheitlich (Gebäudeschwerpunkt, Eingang, Straßenpunkt oder Flurstücksmitte). |
| **NRW Gebäudereferenzen** (`gebref`) | `https://www.opengeodata.nrw.de/produkte/geobasis/lk/akt/gebref_txt/` → `gebref_EPSG25832_ASCII.zip` (86,1 MB, ganz NRW) | NRW | auf der Seite nicht angegeben | DL-DE→Zero-2.0 | Möglich (neuer Host `www.opengeodata.nrw.de`), aber über Overture Addresses bereits enthalten; nur als Rückfalloption. |
| **Länder-INSPIRE-Adress-WFS** (heute genutzt) | siehe `ADDRESS_ENDPOINTS` | NI, SN, SH, BB, MV, BW, SL, BE | laufend | je Land | Bleibt als Live-Weg; Overture Addresses füllt die übrigen Länder. |
| **BKG Geokodierungsdienst** (`gdz_geokodierung`, `gdz_geokodierung_bund`) | WFS/REST mit Authentifizierung | DE | — | Lizenzvertrag nötig; `_bund` nur für Bundesbehörden (enthält Georeferenzierte Adressen GA) | **Nicht offen**, nicht nutzbar ohne Vertrag. |
| **HK-DE bundesweit** (ZSHH beim LDBV Bayern) | CSV, Bund-Datensatz ca. 3,8 GB (ZIP ca. 450 MB), Stand 2025-10 | DE, ca. 22 Mio. adressierte Gebäude | — | ZSHH-Nutzungsbedingungen (kostenpflichtig/lizenziert) | **Nicht offen.** |
| **Bayern Hauskoordinaten** | — | BY | — | Open-Data-Status nicht bestätigt; im OpenData-Portal sind Hausumringe (vierteljährlich) belegt | **Ungeprüft**; Bayern bleibt Lücke, dort weiter Nominatim. |
| **OpenAddresses** | Sammlung nationaler/regionaler Quellen; Hauptlieferant des Overture-Addresses-Themes | weltweit | je Quelle | je Quelle | Nicht direkt anbinden; über Overture konsumieren (einheitliches Schema, erlaubte Hosts). |
| **Österreich: BEV Adressregister** | BEV-Produktseite; in Overture enthalten | AT | laut INSPIRE-Eintrag laufend gepflegt („tagesaktuell"-Produkt) | CC BY 4.0 (laut Overture-Attribution) | Nur relevant, falls die App je über DE hinausgeht. |
| **Schweiz: Amtliches Verzeichnis der Gebäudeadressen** | STAC `data.geo.admin.ch` (Collection `ch.swisstopo.amtliches-gebaeudeadressverzeichnis`), CSV/FGDB/INTERLIS, LV95 | CH, Gebäudeeingänge | täglich | kostenlos, „Nutzungsbedingungen für kostenlose Geodaten" | wie oben. |
| **Niederlande: BAG via PDOK** | in Overture enthalten; PDOK Locatieserver (**Endpunkt ungeprüft**) | NL | — | CC0 1.0 | wie oben. |
| **Frankreich: BAN** | `https://data.geopf.fr/geocodage/search/` (Géoplateforme/IGN); alte URL `api-adresse.data.gouv.fr` Ende Januar 2026 abgeschaltet | FR | BAN laufend, Geocoder zweimal wöchentlich aktualisiert | Licence Ouverte / Etalab 2.0 | wie oben; Limit des Geokodierdienstes nicht bestätigt. |
| **Dänemark: DAWA** | DAWA wird abgeschaltet; Datum widersprüchlich (1. Juli 2026 vs. 17. August 2026), Nachfolger „Adressevælger"/modernisierter Datafordeler | DK | — | „Vilkår for brug af frie geografiske data" | **Nicht einplanen**; Lage unklar. |
| **Belgien: BeSt/Regionalregister** | in Overture enthalten (ICAR Wallonie, Adressenregister Flandern, UrbIS Brüssel) | BE | — | CC BY 4.0 | wie oben. |
| **Selbst gehostetes Nominatim/Photon** | vom Nutzer eingetragene URL (HTTPS oder localhost) | nach Extrakt | nach Betreiber | ODbL-Daten | **Empfohlen als Option**, analog „Eigener Overpass-Server". |

Belege zur Tabelle:
- Overture Addresses: Alpha-Status, > 475 Mio. Punkte, 41 Länder, Länderzahlen, Teilabdeckung in Deutschland, uneinheitliche Punktlage, instabile IDs, monatliche Releases, S3-/Azure-Pfade. — [Overture Addresses Guide](https://docs.overturemaps.org/guides/addresses/)
- Lizenzen je deutschem Bundesland und für AT/CH/NL/FR/DK/BE im Addresses-Theme. — [Overture Attribution](https://docs.overturemaps.org/attribution/)
- NRW `gebref`: Datei, Größe, EPSG:25832, DL-DE→Zero-2.0. — [opengeodata.nrw.de gebref_txt](https://www.opengeodata.nrw.de/produkte/geobasis/lk/akt/gebref_txt/)
- BKG-Geokodierdienst setzt eine Lizenz und Authentifizierung voraus. — [QGIS-Plugin BKG Geocoder](https://plugins.qgis.org/plugins/bkggeocoder/); Nutzungsbedingungen AdV-Dienst mit Quellenvermerk-Pflicht. — [BKG Nutzungsbedingungen Geokodierungsdienst AdV](https://sg.geodatenzentrum.de/public/gdz/lizenz/deu/nutzungsbedingungen_geokodierungsdienst_adv.pdf); Bund-Variante für Bundesbehörden mit GA. — [BKG Nutzungsbedingungen Geokodierungsdienst Bund](https://sg.geodatenzentrum.de/public/gdz/lizenz/deu/nutzungsbedingungen_geokodierungsdienst_bund.pdf)
- HK-DE Bund: CSV, ca. 3,8 GB / 450 MB ZIP, Stand 2025-10. — [BKG Dokumentation HK-DE](https://sg.geodatenzentrum.de/public/gdz/dokumentation/deu/hk-de.pdf); ZSHH bündelt die Hauskoordinaten der Länder, ca. 22 Mio. adressierte Gebäude. — [LAiV M-V Pressemitteilung](https://laiv-mv.de/static/LAIV/Geoinformation/Dateien/Blickpunkte/PM-Daten_der_Zentralen_Stellen_OD.pdf)
- Bayern: Hausumringe im OpenData vierteljährlich aktualisiert; kein Beleg für offene Hauskoordinaten. — [LDBV Datenformatbeschreibung Hausumringe](https://ldbv.bayern.de/file/pdf/18098/DFB_Hausumringe.pdf)
- Schweiz: täglich aktualisiert, kostenlos, CSV/FGDB/INTERLIS, LV95, Lage des Gebäudeeingangs, STAC-Collection. — [swisstopo Amtliches Verzeichnis der Gebäudeadressen](https://www.swisstopo.admin.ch/de/amtliches-verzeichnis-der-gebaeudeadressen)
- Frankreich: alte API-Adresse-URL Ende Januar 2026 außer Betrieb, Migration auf `data.geopf.fr/geocodage/search/`. — [data.gouv.fr: API Adresse wird an IGN übertragen](https://www.data.gouv.fr/posts/lapi-adresse-de-la-base-adresse-nationale-est-transferee-a-lign-10); Geocoder zweimal wöchentlich aktualisiert. — [CNIG CDBAN 28.08.2026](https://cnig.gouv.fr/IMG/pdf/cdban_28082026.pdf)
- Dänemark: Abschaltung DAWA zum 1. Juli 2026 laut kommerziellem Anbieter. — [danskadresseapi.dk](https://danskadresseapi.dk/dawa-erstatning); Parallelbetrieb des alten Datafordeler endet am 15. Januar 2027. — [Lovguiden / Klimadatastyrelsen](https://lovguiden.dk/det-offentlige/klimadatastyrelsen/2026-06-25-datafordelerens-modernisering-paralleldrift-ophoerer-15-januar-2027)
- Österreich: Adressregister wird von Gemeinden laufend gepflegt und vom BEV bereitgestellt. — [INSPIRE Geoportal: Adressregister tagesaktuell](https://inspire-geoportal.ec.europa.eu/srv/api/records/37d564f9-5d63-4760-aae6-29d3f98ee1b4)
- libpostal: MIT-Lizenz, Daten ca. 1,8 GB auf Platte, native Kompilierung (Autotools; Windows über MSys2/MinGW), Node-Binding `node-postal`. — [libpostal README](https://github.com/openvenues/libpostal)

### Inferences
- Einbau von Overture Addresses in die bestehende Kaskade (kein neues Feature, nur weitere Quelle für `officialHouseCoordinate`): gleiche Abgleichlogik wie heute (`matchAddress`: Hausnummer + normalisierte Straße + PLZ, 30-m-Regel), Reihenfolge „Länder-WFS → Overture Addresses → Nominatim-Punkt bleibt". Betroffen: [house-coordinates.service.ts](../../desktop-app/src/main/services/house-coordinates.service.ts), [overture-dealers.ts](../../desktop-app/src/main/services/dealer-directory/overture-dealers.ts) (STAC-/Range-Leser wiederverwenden), [overture-dealers.worker.ts](../../desktop-app/src/main/workers/overture-dealers.worker.ts), [docs/official-buildings.md](../../docs/official-buildings.md), [PRIVACY.md](../../PRIVACY.md).
- Zwei Zugriffsvarianten, beide ohne dass Adressen das Gerät verlassen (es werden nur Byte-Bereiche öffentlicher Dateien geladen): (a) bedarfsweise die Row-Groups lesen, deren bbox den Nominatim-Punkt enthält, und nur die Spalten Straße/Nummer/PLZ/Geometrie; (b) einmaliger Download je Bundesland in eine lokale Tabelle, zusammen mit dem Händlerverzeichnis-Refresh. Variante (a) ist datensparsamer und braucht keinen großen lokalen Bestand; ob die Row-Groups klein genug für eine Analyse-Latenz von wenigen Sekunden sind, muss gemessen werden.
- Provenienz bleibt erhaltbar: `sources[].dataset`/`license` je Adresse ermöglicht den Vermerk „Anker: amtlicher Adresspunkt (Overture Addresses, Quelle <Land>, Lizenz <…>)" analog zum heutigen „official house coordinate (ALKIS <Land>)".
- libpostal ist für diese App ungeeignet: 1,8 GB Modelldaten und ein weiterer nativer Build neben `better-sqlite3`, `onnxruntime-node` und `sharp` stehen in keinem Verhältnis zum Nutzen bei rein deutschen Adressen; eine kleine deterministische deutsche Normalisierung (siehe Frage 5) reicht.
- Die Auslandsregister (AT/CH/NL/FR/DK/BE) sind inhaltlich gut und überwiegend offen, bringen der App aber derzeit nichts, weil Suche, Verzeichnis, PLZ-Logik und Hagelmodell auf Deutschland festgelegt sind. Falls später nötig, wäre Overture Addresses wieder der einheitliche Zugang.

### Gaps
- Welche Spalten das Addresses-Schema exakt hat (`street`, `number`, `postcode`, `address_levels`, `sources`) wurde nur aus der Guide-Seite, nicht aus der Schema-Referenz bestätigt; ebenso unbestätigt ist die Größe der Dateien/Row-Groups für Deutschland.
- Ob die deutschen Punkte im Addresses-Theme auf dem Gebäude liegen (ALKIS-Hauskoordinate) oder teils auf Flurstücksmitte, ist je Land unbekannt; vor Übernahme mit den 8 Referenzadressen aus `docs/official-buildings.md` gegen den WFS vergleichen.
- BEV-Stichtagsdaten (Lizenz, Turnus, Download-URL) konnten nicht direkt abgerufen werden (Produktseite 404); CC BY 4.0 ist nur über die Overture-Attribution belegt.
- PDOK-Locatieserver- und BeSt-Endpunkte sowie das Anfrage-Limit des französischen Geokodierdienstes sind **ungeprüft**.
- Offener Status der Hauskoordinaten in Hessen/Thüringen/Rheinland-Pfalz/Sachsen-Anhalt als Direktdownload wurde nicht einzeln geprüft; belegt ist nur, dass diese Länder mit offener Lizenz im Overture-Addresses-Theme enthalten sind.

---

## 4. Welche offenen Quellen verbessern Vollständigkeit und Attributqualität des bestehenden Händlerverzeichnisses, und welche sind rechtlich nutzbar?

### Takeaway
Der schnellste Qualitätsgewinn liegt in Feldern, die Overture bereits liefert und die die App wegwirft (`brand.wikidata`, `websites`, `phones`, `sources`, `names.common`, `taxonomy.alternates`), sowie in OSM-Tags, die bei den Ortsdetails schon geladen, aber nicht ausgewertet werden (`second_hand`, `service:vehicle:*`, `operator`). AllThePlaces und Foursquare sollte die App nur indirekt über Overture nutzen; Hersteller-Händlersuchen und kostenpflichtige Register sind nicht einzuplanen.

### Cited Findings

**Overture Places (heute genutzt, aber nur teilweise gelesen)**
- Schema: `names.primary/common/rules`, `basic_category`, `taxonomy.primary/hierarchy/alternates`, `confidence`, `websites`, `socials`, `emails`, `phones`, `brand.names` und `brand.wikidata`, `addresses[].freeform/locality/postcode/region/country`, `sources[].property/dataset/record_id/update_time/confidence/license`, `operating_status`. — [Overture Schema-Referenz Place](https://docs.overturemaps.org/schema/reference/places/place/)
- `confidence` ist eine Existenzwahrscheinlichkeit 0–1, nicht zwischen Lieferanten kalibriert und daher als relativer Filter gedacht; `categories` wurde im September-2026-Release entfernt, `basic_category` und `taxonomy` sind die Nachfolger; rund 88 Mio. Orte, davon Meta ca. 61 Mio. und BrightQuery ca. 17 Mio.; keine OSM-Inhalte; monatliche Releases, Taxonomie-Updates quartalsweise. — [Overture Places Guide](https://docs.overturemaps.org/guides/places/)
- App heute liest nur `id`, `names.primary`, `basic_category`, `taxonomy.primary`, `brand.names.primary`, `addresses[0]` (freeform, locality, postcode, country), `bbox`, `confidence`, `operating_status`; gespeichert werden 10 Spalten. Nicht gelesen: `brand.wikidata`, `websites`, `phones`, `sources`, `names.common`, `taxonomy.alternates`, weitere Adressen. — [overture-dealers.ts](../../desktop-app/src/main/services/dealer-directory/overture-dealers.ts), [dealer-directory.service.ts](../../desktop-app/src/main/services/dealer-directory.service.ts)
- Filter heute: `auto_dealer` bzw. `vehicle_dealer` mit 6 Taxonomie-Werten, `confidence ≥ 0,5`, Status offen/fehlend, Deutschland-bbox; Release 2026-09-23.1 ergab 51 242 Händlerorte, 45 374 nach Filter. — [docs/dealer-directory.md](../../docs/dealer-directory.md)

**OSM-Tags (über Overpass bereits im Zugriff)**
- Für `shop=car` dokumentiert das OSM-Wiki u. a. `brand`, `operator`, `second_hand=yes/no/only`, `service:vehicle:*` (car_repair, inspection, car_parts, tyres) sowie die Erfassung als Punkt, als Gebäude oder als gesamtes Gelände inklusive Ausstellungs- und Kundenparkfläche (`landuse=retail`). — [OSM-Wiki Tag:shop=car](https://wiki.openstreetmap.org/wiki/Tag:shop%3Dcar)
- App heute gibt aus den POI-Tags nur name, Kategorie, website, phone, email, opening_hours, brand und Adresse zurück. — [osmDetails.service.ts](../../desktop-app/src/main/services/osmDetails.service.ts)

**name-suggestion-index (NSI)**
- Kuratierte Liste kanonischer Marken-/Betreibernamen für OSM, Lizenz BSD-3-Clause, als npm-Paket `name-suggestion-index` (ES-Modul) verfügbar. — [name-suggestion-index (GitHub)](https://github.com/osmlab/name-suggestion-index)

**AllThePlaces**
- Code MIT; die veröffentlichten Daten stellt das Projekt unter CC0; wöchentlicher Lauf; die Daten entstehen durch Spider gegen Betreiber-Websites. — [AllThePlaces (GitHub)](https://github.com/alltheplaces/alltheplaces)
- AllThePlaces ist als CC0-Quelle bereits im Overture-Places-Theme enthalten. — [Overture Attribution](https://docs.overturemaps.org/attribution/)

**Foursquare OS Places**
- Apache 2.0, monatliche Aktualisierung angekündigt, > 100 Mio. Orte; der Datensatz auf Hugging Face ist inzwischen zugangsbeschränkt („gated": Nutzer müssen der Weitergabe ihrer Kontaktdaten zustimmen). — [Hugging Face foursquare/fsq-os-places](https://huggingface.co/datasets/foursquare/fsq-os-places), [Foursquare Blog: Open Source Places](https://foursquare.com/resources/blog/products/foursquare-open-source-places-a-new-foundational-dataset-for-the-geospatial-community/)
- Foursquare-Daten sind (Apache 2.0, mit Pflichtvermerk) bereits Teil von Overture Places. — [Overture Attribution](https://docs.overturemaps.org/attribution/)

**Rechtliche Einordnung (Übersicht)**

| Quelle | Nutzbar in offenem Desktop-Tool? | Begründung |
| --- | --- | --- |
| Overture Places (alle Lieferanten) | Ja | CDLA Permissive 2.0 / Apache 2.0 (Vermerk) / CC0 |
| OSM via Overpass/Photon/Nominatim | Ja | ODbL, Attribution; Dienste nach deren Fair-Use-Regeln |
| name-suggestion-index | Ja | BSD-3-Clause (Lizenztext mitliefern) |
| Wikidata (Marke → Hersteller/Konzern) | Ja (**Lizenz CC0 aus Vorwissen, nicht abgerufen**) | nur als statische, mitgelieferte Tabelle sinnvoll |
| AllThePlaces direkt | **Zweifelhaft** | Projekt deklariert CC0, die Inhalte stammen aber aus Scraping von Markenseiten; nur indirekt über Overture verwenden |
| Foursquare OS Places direkt | Nein (praktisch) | Zugang nur nach Kontaktdaten-Freigabe; widerspricht „ohne Schlüssel/Konto"; Inhalt ohnehin in Overture |
| Hersteller-Händlersuchen | **Nein / rechtlich zweifelhaft** | Scraping; Nutzungsbedingungen je Hersteller nicht geprüft |
| BKG/ZSHH, amtliche Register mit Vertrag | Nein | Lizenzvertrag/Authentifizierung |

### Inferences
- **Mehr aus Overture herausholen** (Dateien: [overture-dealers.ts](../../desktop-app/src/main/services/dealer-directory/overture-dealers.ts), DB-Migration für `dealer_directory`, [dealer-directory.service.ts](../../desktop-app/src/main/services/dealer-directory.service.ts), [docs/dealer-directory.md](../../docs/dealer-directory.md)):
  - `brand.wikidata` speichern → Marken eindeutig statt über Schreibweisen; daraus lassen sich Aliase deterministisch ableiten und die vier handgepflegten Gruppen in `place-query.ts` ersetzen/ergänzen.
  - `websites[0]`/`phones[0]` speichern → der bestehende Website-Fund (heute nur OSM) bekommt eine zweite, offline verfügbare Quelle; Website-Domain ist außerdem ein starkes Abgleichsmerkmal für Dubletten.
  - `sources[].dataset` und `license` speichern → Provenienz je Treffer („Overture: Meta" / „Overture: AllThePlaces") und korrekter Lizenzvermerk je Datensatz; Einträge aus Marken-Spidern (AllThePlaces) sind erfahrungsgemäß adressgenauer als reine Social-Media-Einträge (Annahme, zu messen).
  - `names.common` und `taxonomy.alternates` in den FTS-Index → mehr Treffer für alternative Schreibweisen; „gebraucht/neu" und „nur Service" lassen sich aus `taxonomy.primary/alternates` (z. B. `used_auto_dealer`, Werkstatt-Kategorien) ableiten statt nur aus dem Primärwert.
  - Dubletten schon beim Speichern zusammenführen (gleicher normalisierter Name, < 150 m, oder gleiche Website-Domain), statt nur zur Suchzeit `dropApproximateTwins` anzuwenden; den Eintrag mit Straße und höherer Konfidenz behalten.
- **OSM-Attribute in den Ortsdetails mitnehmen** ([osmDetails.service.ts](../../desktop-app/src/main/services/osmDetails.service.ts), `OsmDetails` in `shared/types.ts`): `second_hand` (neu/gebraucht), `service:vehicle:*` (nur Werkstatt vs. Verkauf), `operator` (Händlergruppe), `brand:wikidata`. Die Tags liegen in der Overpass-Antwort bereits vor; es ist nur Mapping. Anzeige im vorhandenen Detail-Dialog als weitere Zeilen.
- **Geländefläche**: OSM-Flächen `shop=car` bzw. `landuse=retail` liegen der Boundary-Evidenz bereits vor; für das Verzeichnis selbst liefert Overture nur Punkte. Kein zusätzlicher Datensatz nötig.
- **Händlergruppe**: Das vorhandene Importfeld `group` lässt sich deterministisch vorbelegen, wenn OSM `operator` oder ein gemeinsamer Namensstamm + gleiche Website-Domain mehrerer Verzeichniseinträge vorliegt. Ein offenes Unternehmensregister mit Konzernbezug wurde nicht verifiziert (siehe Gaps).
- NSI ist als mitgelieferte, statische Alias-Tabelle (Build-Zeit, kein Netz zur Laufzeit) der sauberste Weg zu vollständigen Markenaliasen; alternativ genügt `brand.wikidata` aus Overture als Schlüssel.

### Gaps
- Kein Beleg abgerufen für: Wikidata-Lizenz und geeignete Abfragen (Marke → Hersteller/Konzern), offene Unternehmensregister (Handelsregister/Unternehmensregister, GLEIF) und deren Nutzungsbedingungen, sowie konkrete Nutzungsbedingungen einzelner Hersteller-Händlersuchen. Diese Punkte sind **ungeprüft**; Hersteller-Locator sollten ohne Einzelfallprüfung als nicht nutzbar gelten.
- Ob NSI unter `shop/car` die für Deutschland relevanten Marken vollständig enthält und ob `brand:wikidata` dort gepflegt ist, wurde nicht geprüft (README nennt die Tags nicht explizit).
- Wie viele der 45 374 Einträge `brand.wikidata`, `websites` bzw. eine AllThePlaces-Quelle haben, ist unbekannt; vor Umsetzung einmal aus einem Release zählen.
- Erlaubte Werte von `operating_status` sind in der Schema-Referenz nicht vollständig aufgeführt (belegt: `open`, `permanently_closed`); der Filter „fehlend oder open" verwirft damit auch vorübergehend geschlossene Betriebe — ob das gewollt ist, ist offen.

---

## 5. Wie gut ist die Deduplizierung bzw. der Abgleich zwischen Importzeilen und Verzeichniseinträgen, und welche belegten Verbesserungen gibt es?

### Takeaway
Es gibt fünf voneinander unabhängige Normalisierungen und drei verschiedene Stoppwortlisten; die Import-Dublettenprüfung arbeitet mit exakter Zeichenkettengleichheit und erkennt „Autohaus Müller GmbH" / „Autohaus Mueller" oder „Hauptstr." / „Hauptstraße" nicht. Ein Abgleich Importzeile ↔ Verzeichnis findet gar nicht statt. Eine gemeinsame, deterministische Normalisierung plus Token-Set-Ähnlichkeit mit PLZ-/Distanz-Blocking löst das ohne neue Abhängigkeit.

### Cited Findings
- Parser-Dublette: Schlüssel `normalise(name)|normalise(address)` mit `trim → lower → Mehrfach-Leerzeichen`; keine Umlautfaltung, keine Rechtsform-Entfernung, keine Straßenabkürzungen. — [csv.service.ts](../../desktop-app/src/main/services/csv.service.ts)
- Vorschau-Dublette (auch gegen das offene Portfolio): gleicher normalisierter Name (lower, Leerzeichen, Punkt/Komma entfernt) **und** gleiche normalisierte Adresse oder < 150 m; gleiche Namen ohne Adresse und Koordinaten gelten als Dublette. Suche per `unique.find` (quadratisch). — [dedupe.ts](../../desktop-app/src/shared/dedupe.ts), [importPreview.ts](../../desktop-app/src/renderer/src/components/upload/importPreview.ts)
- Suche/Portfolio-Badge: `similarBusinessNames` = Überlappung der „Identitäts-Tokens" (≥ 3 Zeichen, ohne 20 generische Wörter) ≥ Hälfte der kleineren Menge, exakte Token-Gleichheit nach Faltung; Schwellen 40 m (gleicher Ort) bzw. 150 m (gleiches Geschäft). — [place-query.ts](../../desktop-app/src/main/services/place-query.ts), [portfolio-index.service.ts](../../desktop-app/src/main/services/portfolio-index.service.ts)
- Weitere, abweichende Normalisierungen: `matchesSite` (NFKD, Stoppwörter auto/autohaus/gmbh/co/kg/ag/strasse/deutschland/filiale, Tokens ≥ 4), `pickDealershipPoi` (eigene Liste mit 30 generischen Wörtern, „strasse" → „str"), `normalizeStreet` („str." → „strasse", Umlaute → ae/oe/ue). Faltung der Umlaute ist uneinheitlich: `foldText` macht ä → ae, `site-membership`/`osmDetails` machen ä → a. — [site-membership.ts](../../desktop-app/src/main/services/boundary/site-membership.ts), [osmDetails.service.ts](../../desktop-app/src/main/services/osmDetails.service.ts), [house-coordinates.service.ts](../../desktop-app/src/main/services/house-coordinates.service.ts)
- Das Verzeichnis wird nur von der Suche (`placesAutocomplete`) befragt; `geocodeDealership` und der Importdialog nutzen es nicht. — [places.service.ts](../../desktop-app/src/main/services/places.service.ts), [analyze.service.ts](../../desktop-app/src/main/services/analyze.service.ts)
- libpostal normalisiert Adressen sprachabhängig (Beispiel „Marktstraße 14" → „markt strasse 14", zusammengesetzte Straßennamen werden optional getrennt) und zerlegt sie per CRF-Modell in Bestandteile; die Parser-Genauigkeit wird mit 99,45 % vollständig korrekter Zerlegungen auf Testdaten angegeben. — [libpostal README](https://github.com/openvenues/libpostal)
- Overture führt Adressen nur bei exakter Übereinstimmung von Geometrie und Eigenschaften zusammen und merged keine Attribute; Dubletten zwischen Lieferanten sind im Places-Theme daher zu erwarten (die App-Doku beschreibt genau das). — [Overture Addresses Guide](https://docs.overturemaps.org/guides/addresses/), [docs/dealer-directory.md](../../docs/dealer-directory.md)

### Inferences
- **Eine Normalisierung statt fünf** (neues Modul unter `shared/`, genutzt von `dedupe.ts`, `csv.service.ts`, `place-query.ts`, `site-membership.ts`, `osmDetails.service.ts`, `house-coordinates.service.ts`): Unicode-Faltung wie `foldText`, Rechtsformen entfernen (Liste aus `LEGAL_FORM` erweitern um „e.K.", „SE", „GmbH & Co. KGaA", „Inh. …"), eine gemeinsame Liste generischer Wörter, Straßenregeln im libpostal-Stil („str."/„strasse"/„straße" gleich, „-" und Leerzeichen in Straßennamen ignorieren, Hausnummernzusätze „12 a" = „12a"). Das ist rein deterministisch und ersetzt libpostal für deutsche Adressen.
- **Dublettenregel im Import** auf diese Normalisierung umstellen und abstufen: (1) sicher = gleicher normalisierter Name + (gleiche normalisierte Adresse oder < 150 m); (2) wahrscheinlich = Token-Set-Ähnlichkeit der Namen ≥ Schwelle + gleiche PLZ + gleiche Hausnummer oder < 75 m → in der vorhandenen Vorschau als Hinweis markieren (Spalte/Badge existiert bereits), nicht automatisch überspringen.
- **Ein-Token-Falle** in `similarBusinessNames`: hat eine Seite nur ein Identitäts-Token (z. B. Familienname „Müller"), genügt dieses eine gemeinsame Token; „Autohaus Müller" und „Reifen Müller" im selben Gewerbegebiet (< 150 m) werden zusammengelegt. Abhilfe: bei nur einem gemeinsamen Token zusätzlich gleiche Hausnummer/Straße oder < 40 m verlangen.
- **Verzeichnis als lokale erste Stufe der Import-Geokodierung** (bestehende Kaskade, keine neue Funktion): Zeile mit Name + PLZ/Ort gegen `dealer_directory` abgleichen (FTS-Kandidaten begrenzt auf PLZ-/Ortsumkreis = Blocking; Bewertung mit `textMatchScore` + Straße/Hausnummer). Eindeutiger Treffer mit Straße → als zusätzlicher Kandidat in `pickGeocodeHit` oder direkt als Anker mit Provenienz „Overture-Verzeichnis, Release X"; erspart Nominatim-Anfragen und funktioniert offline. Kein Treffer oder mehrdeutig → wie bisher.
- Blocking per Geohash/Gitter ist bei ≤ 500 Zeilen gegen ~45 000 Einträge nicht nötig; PLZ-Präfix bzw. die vorhandene Lat/Lon-Box in `ftsRows` reichen. Die quadratische Suche in `dedupeDealerships` ist bei 500 Zeilen unkritisch, sollte bei größeren Dateien aber über einen Schlüssel-Index (normalisierter Name) laufen.
- Schwellenwerte (150 m, 75 m, 40 m, 0,6) sind plausibel, aber nicht aus Daten abgeleitet; die Benchmark-Portfolios (10–500 Standorte) eignen sich für eine Präzisions-/Trefferquoten-Messung der Dublettenregel, bevor Schwellen geändert werden.

### Gaps
- Fachliteratur zu Record Linkage (Fellegi-Sunter, Jaro-Winkler, Token-Set-Ratio, Blocking) wurde nicht abgerufen; die Methodenempfehlungen oben stammen aus Vorwissen und sind **nicht per Quelle belegt**. Belegt ist nur das libpostal-Vorgehen.
- Keine Messung der tatsächlichen Dublettenquote im Overture-Bestand oder der Fehlerrate der heutigen Regeln.

---

## 6. Import-Robustheit: Kodierung, Trennzeichen, deutsche Zahlenformate, Kopfzeilen-Synonyme, Excel-Eigenheiten, große Dateien, Fehlermeldungen, Wiederaufnahme

### Takeaway
Der Parser ist bei Kodierung, Trennzeichen, Kopfzeilensuche und Geldbeträgen bereits solide; die relevanten Lücken sind klein und konkret: führende Null bei Postleitzahlen aus Excel, fehlende Plausibilitätsprüfung der Koordinaten (vertauscht/außerhalb Deutschlands), keine Größenbegrenzung an der IPC-Grenze und keine Kennzeichnung nicht geokodierbarer Adressen (Postfach) vor dem Lauf.

### Cited Findings
- Kodierung: UTF-8-BOM, UTF-16-LE/BE-BOM, sonst strenges UTF-8 mit Rückfall auf Windows-1252; Dateien mit > 2 % Steuerbytes werden als binär abgelehnt (UTF-16 ohne BOM fällt darunter). Bei Windows-1252 zeigt der Dialog einen Hinweis. — [decodeText.ts](../../desktop-app/src/renderer/src/components/upload/decodeText.ts), [PortfolioImportDialog.tsx](../../desktop-app/src/renderer/src/components/upload/PortfolioImportDialog.tsx)
- Trennzeichen: Tab, Semikolon, Komma — gewählt wird das Zeichen, mit dem eine der ersten 20 Zeilen die meisten bekannten Spaltennamen ergibt; RFC-4180-Quoting inkl. mehrzeiliger Zellen; bei unbalanciertem Anführungszeichen zeilenweises Lesen. Pipe (`|`) wird nicht unterstützt. — [csv.service.ts](../../desktop-app/src/main/services/csv.service.ts)
- Kopfzeile: beste der ersten 20 Zeilen; bei XLSX gewinnt das Arbeitsblatt mit der klarsten Kopfzeile; Spalten lassen sich im Dialog von Hand zuordnen. Synonymlisten für 16 Felder (deutsch/englisch). — [csv.service.ts](../../desktop-app/src/main/services/csv.service.ts), [import-fields.ts](../../desktop-app/src/shared/import-fields.ts)
- Zahlen: Koordinaten mit Dezimalkomma werden gelesen (`replace(",", ".")`); Beträge mit Tausenderpunkten, „€/EUR", Apostroph und Leerzeichen; negative Beträge abgelehnt. Geprüft wird nur −90…90 bzw. −180…180. — [csv.service.ts](../../desktop-app/src/main/services/csv.service.ts)
- XLSX: `cellToString` gibt Zahlen per `String(v)` zurück; eine als Zahl gespeicherte PLZ „01067" wird zu „1067" — es gibt kein Auffüllen auf fünf Stellen (kein `padStart` im Parser). `columnHint` erkennt „postcode" nur bei `^\d{5}$`. Folge: in Sachsen, Thüringen, Sachsen-Anhalt und Teilen Brandenburgs (PLZ 0xxxx) fehlt die PLZ für `pickGeocodeHit` (+2/−3) und für den Hauskoordinaten-Abgleich. — [csv.service.ts](../../desktop-app/src/main/services/csv.service.ts), [import-fields.ts](../../desktop-app/src/shared/import-fields.ts), [geocoding.service.ts](../../desktop-app/src/main/services/geocoding.service.ts)
- XLSX: Datumszellen (JS-`Date`-Objekte) und Fehlerwerte ergeben einen leeren String; präfixierte SpreadsheetML-Namensräume und absolute Relationship-Ziele werden vor dem Laden repariert. — [csv.service.ts](../../desktop-app/src/main/services/csv.service.ts), [xlsx-normalize.ts](../../desktop-app/src/main/services/xlsx-normalize.ts)
- Große Dateien: Die IPC-Schemata `csv:parse` (`content: z.string()`) und `xlsx:parse` (`base64: z.string()`) haben keine Längenbegrenzung; die ganze Datei wird als String/Base64 übertragen und von exceljs vollständig geladen. Die Vorschau-Tabelle rendert alle Zeilen in einem scrollenden Container. — [ipc-schema.ts](../../desktop-app/src/shared/ipc-schema.ts), [csv.service.ts](../../desktop-app/src/main/services/csv.service.ts)
- Fehlermeldungen: zeilengenaue Hinweise (fehlender Name, ungültige Zahl/Betrag, Bereichsfehler, Dublette, unbekannte Geschäftsart) werden im Dialog lokalisiert; Zeilennummern entsprechen der Datei. Geokodier-Fehler erscheinen erst in der Analyse als `analysisErrors` je Standort. — [importMessages.ts](../../desktop-app/src/renderer/src/components/upload/importMessages.ts), [runtime.ts](../../desktop-app/src/renderer/src/store/app/runtime.ts)
- Wiederaufnahme: 3 Analysen parallel; nach jedem Standort wird das Portfolio gespeichert (Checkpoint), `pendingAnalysis` hält offene und fehlgeschlagene Eingaben über einen Neustart; ein vom Nutzer abgebrochener Lauf wird nicht zur Fortsetzung angeboten. Der 30-Tage-Geocode-Cache verhindert doppelte Anfragen. — [runtime.ts](../../desktop-app/src/renderer/src/store/app/runtime.ts)
- Tests: Property-Tests (fast-check, fester Seed, 200 Läufe) decken ZIP-Roundtrip, XML-Normalisierung und „CSV liefert Bericht oder Error" ab; es gibt keine Property-/Fixture-Tests für PLZ-Nullen, Koordinatenplausibilität oder Trennzeichen-Varianten. — [import-parsers.property.test.ts](../../desktop-app/src/main/services/import-parsers.property.test.ts)

### Inferences
- **PLZ mit führender Null** (kleiner Eingriff, großer Effekt in Ostdeutschland): in `composeAddress` eine rein numerische, vierstellige PLZ-Zelle auf fünf Stellen auffüllen, wenn die Spalte dem Feld `postalCode` zugeordnet ist; `columnHint` „postcode" auch bei 4–5 Ziffern (Anteil ≥ 80 %) vergeben; Berichtshinweis „PLZ ergänzt" pro Zeile. Zusätzlich in freien Adresszellen „…, 1067 Dresden" nicht raten, sondern als Hinweis markieren.
- **Koordinaten-Plausibilität**: Wenn `lat` in 5–16 und `lon` in 47–56 liegt, sind die Spalten sehr wahrscheinlich vertauscht → Warnung je Zeile (oder dateiweit) statt stiller Übernahme; Punkte außerhalb der Deutschland-Box als Warnung „außerhalb des Modellgebiets". `columnHint` kennt diese Wertebereiche schon (latitude 47–56, longitude 5–16) und kann wiederverwendet werden.
- **Vorab-Kennzeichnung nicht geokodierbarer Adressen** im vorhandenen „markiert"-Filter der Vorschau: „Postfach"/„PF"/„P.O. Box", Adresse ohne Hausnummer, Adresse ohne PLZ und Ort. Das sind genau die Fälle, in denen `parseStreetAddress` `null` liefert und Nominatim auf Straßen- oder Ortsniveau landet.
- **Größenbegrenzung**: Obergrenzen in den Zod-Schemata (z. B. Zeichen-/Base64-Länge) und eine klare Meldung „Datei zu groß, bitte teilen" vermeiden, dass eine versehentlich gewählte Großdatei den Main-Prozess blockiert; die Portfolios liegen laut Aufgabenstellung bei 10–500 Standorten, die Grenze kann also großzügig sein.
- **Trennzeichen**: `|` ergänzen ist trivial (dritte Schleife in `chooseDelimiter`); Excel-Zeile `sep=;` wird heute als Titelzeile übersprungen und stört nicht.
- **Vorschau-Prüfung konsistent machen**: „Adressen prüfen" sollte dieselbe Auswahl (`pickGeocodeHit` inkl. Name) und dieselbe Genauigkeitsstufe zeigen wie die Analyse; dafür genügt ein IPC-Aufruf, der `geocodeDealership` ohne Hauskoordinaten-Schritt nutzt, und ein dritter Zustand „nur Straße/Ort gefunden" neben „gefunden/nicht gefunden".
- **Negativ-Cache verkürzen**: leere Trefferlisten nur kurz (z. B. 24 h) cachen, damit eine in der Vorschau korrigierte oder später in OSM ergänzte Adresse nicht 30 Tage „nicht gefunden" bleibt.
- **Abbruch und Fortsetzen**: Da Checkpoints und `pendingAnalysis` existieren, wäre „abgebrochenen Lauf fortsetzen" nur das Nicht-Verwerfen der offenen Eingaben beim Abbruch; das ist eine Verhaltensänderung im bestehenden Lauf, kein neues Bauteil.
- Ergänzende Fixture-Tests: je ein Fall für PLZ 01067 aus XLSX-Zahlzelle, vertauschte Koordinaten, `|`-Trennzeichen, Windows-1252 mit „Straße", Adresse „Straße des 17. Juni 135".

### Gaps
- Kein Test mit realen Großdateien (Speicher/Zeit von exceljs bei > 10 000 Zeilen) durchgeführt.
- Ob exceljs bei als Text formatierten PLZ-Zellen die führende Null erhält (dann wäre nur der Zahl-Fall betroffen), wurde aus dem Code geschlossen, nicht mit einer Datei geprüft.
- UTF-16 ohne BOM und Mac-Roman werden nicht erkannt; wie häufig solche Exporte in der Praxis sind, ist unbekannt.

---

## 7. Datenschutz: Welche Nutzerdaten verlassen bei Suche/Geokodierung das Gerät, und stimmt PRIVACY.md?

### Takeaway
PRIVACY.md ist im Grundsatz richtig, an vier Stellen aber unvollständig: der Händlername geht zusammen mit der Adresse an Nominatim, Photon erhält jede Tipp-Zwischenstufe samt Kartenposition, die tägliche Overture-Katalogabfrage ist nicht als Hintergrundanfrage beschrieben, und der lokale Geocode-Cache behält Namen/Adressen über das Löschen eines Portfolios hinaus. Die Nominatim-Richtlinie bittet ausdrücklich, keine vertraulichen Daten zu senden — ein weiterer Grund für „lokal zuerst" und eine einstellbare eigene Instanz.

### Cited Findings
- PRIVACY.md, Zeile „Geocoding": Dienste Nominatim, Photon, Adressdienste der Länder; gesendet werden „Address or search text; street, house number and area of an address". Der allgemeine Absatz davor nennt Koordinaten, Adressen oder Händlernamen. — [PRIVACY.md](../../PRIVACY.md)
- Tatsächlich an Nominatim: (1) die Adresse, (2) zusätzlich `"<Händlername>, <Adresse>"` für jede Zeile mit Namen; dazu der User-Agent mit App-Namen und die IP-Adresse. — [analyze.service.ts](../../desktop-app/src/main/services/analyze.service.ts), [geocoding.service.ts](../../desktop-app/src/main/services/geocoding.service.ts)
- Tatsächlich an Photon: der getippte Text (ohne Rechtsformen) nach jeder 300-ms-Pause, zweimal pro Suche, plus `lat/lon/zoom` — das ist der in der Anfrage genannte Ort oder der aktuelle Kartenausschnitt (auf Stadt-Zoom begrenzt). Notizen aus Portfolios werden nicht gesendet (lokal gelesen). — [places.service.ts](../../desktop-app/src/main/services/places.service.ts), [docs/location-search.md](../../docs/location-search.md)
- Tatsächlich an die Länder-WFS: ein 400-m-Rechteck um den Nominatim-Punkt plus Hausnummer (FES-Filter) und danach IDs der Straßenobjekte — nicht der Straßenname selbst. — [house-coordinates.service.ts](../../desktop-app/src/main/services/house-coordinates.service.ts)
- Overture: 15 s nach Start und höchstens alle 24 h wird `stac.overturemaps.org/catalog.json` abgefragt, sobald einmal ein Verzeichnis geladen wurde; der Download selbst nur per Klick. PRIVACY.md beschreibt für das Verzeichnis „Range requests for the places files; no search text or portfolio data", erwähnt die automatische tägliche Katalogabfrage aber nicht (anders als beim Update-Check und bei den DWD-Radardaten, die als Hintergrundanfragen benannt sind). — [dealer-directory.service.ts](../../desktop-app/src/main/services/dealer-directory.service.ts), [docs/location-search.md](../../docs/location-search.md), [PRIVACY.md](../../PRIVACY.md)
- Overpass (Ortsdetails): Koordinate mit 500-m-Umkreis; der Händlername wird nicht gesendet, nur lokal zum Abgleich verwendet und (klein geschrieben) im Cache-Schlüssel abgelegt. — [osmDetails.service.ts](../../desktop-app/src/main/services/osmDetails.service.ts)
- Lokale Aufbewahrung: Geocode-Schlüssel enthalten den vollen Abfragetext (Name + Adresse); abgelaufene Einträge werden nicht gelöscht (nur `tile:` wird bereinigt), weil `cached()` sie als Offline-Fallback behält. „Alle Daten löschen" entfernt die Datenbank samt API-Cache. — [cache.service.ts](../../desktop-app/src/main/services/cache.service.ts), [PRIVACY.md](../../PRIVACY.md)
- Der Renderer darf selbst keine Netzverbindungen aufbauen (`connect-src 'self'`); alle Anfragen laufen über den Main-Prozess, ohne Cookies (`credentials: "omit"`). — [index.html](../../desktop-app/src/renderer/index.html), [http.service.ts](../../desktop-app/src/main/services/http.service.ts)
- Die Nominatim-Richtlinie bittet, keine personenbezogenen oder sonst vertraulichen Daten an die Dienste zu übermitteln. — [OSMF Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)

### Inferences
- Korrekturen an PRIVACY.md (reine Dokumentation):
  - Zeile „Geocoding" ergänzen: an Nominatim gehen Adresse **und Händlername**; an Photon jede Tipp-Zwischenstufe **und die ungefähre Kartenposition**; an die Länderdienste ein Suchrechteck und die Hausnummer.
  - Zeile „Dealer directory" ergänzen: tägliche automatische Abfrage des Overture-Katalogs nach dem ersten Download (ohne Nutzerdaten).
  - Abschnitt „Data stored on your machine": der API-Cache enthält geokodierte Namen/Adressen und bleibt bis „Alle Daten löschen" bestehen, auch wenn das Portfolio gelöscht wurde.
- Datensparsamkeit im Code (deckt sich mit den Empfehlungen aus Frage 1/2/5): Namensanfrage an Nominatim nur, wenn der Adresstreffer nicht auf Hausniveau liegt; lokales Verzeichnis und (künftig) lokale Adresspunkte zuerst; Geocode-Cache-Einträge beim Löschen eines Portfolios bzw. nach Ablauf + Karenz bereinigen (`pruneExpired("geocode:")` mit Karenzzeit, damit der Offline-Fallback erhalten bleibt).
- Mit Overture Addresses als Quelle verlassen bei der Hauskoordinaten-Suche gar keine adressbezogenen Parameter das Gerät (nur Byte-Bereiche öffentlicher Dateien, aus denen sich allenfalls grob die Region ablesen lässt) — das ist datenschutzfreundlicher als der heutige WFS-Filter mit Hausnummer und 400-m-Box.
- Neue Hosts für die Allowlist bei Umsetzung der Empfehlungen: **keine** für Overture Addresses (gleiche Hosts wie das Händlerverzeichnis); `www.opengeodata.nrw.de` nur, falls der NRW-Direktdownload gewählt wird; ein vom Nutzer eingetragener Geocoder-Host (Validierung wie `shared/overpass-url.ts`).

### Gaps
- Wie lange OSMF, Komoot und die Länderportale Anfragen protokollieren, wurde nicht recherchiert.
- Ob das Diagnose-Log (`main.log`) Geokodier-Abfragetexte enthält, wurde nicht geprüft (PRIVACY.md sagt, das Log nenne die Standorte gelaufener Analysen).

---

## 8. Priorisierte Empfehlungen (erwarteter Nutzen gegenüber Aufwand)

### Takeaway
Zuerst die kleinen, risikoarmen Korrekturen im Geokodier- und Importpfad (Richtlinien-Konformität, PLZ-Null, Genauigkeitsstufe, konsistente Vorschau), dann „lokal zuerst" über das vorhandene Verzeichnis und die volle Nutzung der Overture-Felder, zuletzt Overture Addresses als zusätzliche Hauskoordinaten-Quelle. Alle Punkte sind deterministisch, brauchen kein LLM und kein neues UI-Bauteil.

### Cited Findings
- Grundlage der Priorisierung sind die Befunde aus den Abschnitten 1–7; zentrale externe Belege: Nominatim-Richtlinie — [OSMF Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/); Photon-Parameter — [Photon API v1](https://raw.githubusercontent.com/komoot/photon/master/docs/api-v1.md); Overture-Schema, Lizenzen und Addresses-Abdeckung — [Schema-Referenz Place](https://docs.overturemaps.org/schema/reference/places/place/), [Attribution](https://docs.overturemaps.org/attribution/), [Addresses Guide](https://docs.overturemaps.org/guides/addresses/).

### Inferences

| Rang | Maßnahme | Nutzen | Aufwand | Dateien | Neue Hosts |
| --- | --- | --- | --- | --- | --- |
| 1 | **Nominatim-Konformität**: User-Agent mit echter Version + Kontakt-URL, `countrycodes=de`, Cooldown statt Retry bei 403/429, leere Treffer nur kurz cachen | hoch (Sperr-Risiko, falsche Auslandstreffer) | klein | `geocoding.service.ts`, `http.service.ts`, `places.service.ts`, `house-coordinates.service.ts` (UA zentral) | keine |
| 2 | **PLZ mit führender Null** aus Excel auffüllen; Hinweis „postcode" bei 4–5 Ziffern | hoch in SN/TH/ST/BB | klein | `csv.service.ts`, `shared/import-fields.ts`, Tests | keine |
| 3 | **Genauigkeitsstufe des Ankers** (`place_rank`/`addresstype` behalten, in Provenienz und Review-Grund schreiben); Namensanfrage nur bei „nicht Hausniveau" | hoch (halbiert Anfragen, weniger Namen nach außen, erklärt Fehllagen) | klein–mittel | `geocoding.service.ts`, `analyze.service.ts`, `docs/official-buildings.md`, `PRIVACY.md` | keine |
| 4 | **Vorschau = Analyse**: „Adressen prüfen" nutzt dieselbe Auswahl und zeigt „nur Straße/Ort gefunden"; Postfach/ohne Hausnummer vorab markieren; Koordinaten vertauscht/außerhalb DE warnen | hoch (Fehler vor dem langen Lauf sichtbar) | klein–mittel | `PortfolioImportDialog.tsx`, `importPreview.ts`, `ipc/index.ts`, `csv.service.ts` | keine |
| 5 | **PRIVACY.md berichtigen** (Name an Nominatim, Tipp-Zwischenstufen + Kartenposition an Photon, tägliche Overture-Katalogabfrage, Cache-Aufbewahrung) | mittel (Richtigkeit, Vertrauen) | sehr klein | `PRIVACY.md` | keine |
| 6 | **Geocoder-URL einstellbar** in der vorhandenen Karte „OpenStreetMap-Daten" (eigene Nominatim-/Photon-Instanz; „ohne Update umschaltbar") | mittel–hoch (Richtlinie, Vielnutzer, Vertraulichkeit) | mittel | `shared/overpass-url.ts` (Validierung wiederverwenden), `settings.service.ts`, `geocoding.service.ts`, `places.service.ts`, `docs/local-overpass.md` | nutzerdefiniert |
| 7 | **Eine gemeinsame Normalisierung** (Rechtsformen, Umlaute, Straßenabkürzungen, generische Wörter) und darauf aufbauende Dublettenregel; Ein-Token-Falle schließen | mittel–hoch (weniger übersehene/falsche Dubletten) | mittel | neues Modul in `shared/`, `dedupe.ts`, `csv.service.ts`, `place-query.ts`, `site-membership.ts`, `osmDetails.service.ts`, `house-coordinates.service.ts` | keine |
| 8 | **Verzeichnis als lokale erste Geokodier-Stufe** im Import (Name + PLZ/Ort → Verzeichniseintrag mit Straße als Kandidat/Anker) | hoch (offline, weniger Nominatim, trifft das Betriebsgelände statt der Adresse) | mittel | `analyze.service.ts`, `dealer-directory.service.ts`, `geocoding.service.ts` | keine |
| 9 | **Overture-Felder nutzen**: `brand.wikidata`, `websites`, `phones`, `sources`, `names.common`, `taxonomy.alternates`; Dubletten beim Speichern zusammenführen; Hinweis ab 60 Tagen Alter verschärfen | mittel–hoch (Marke, Website offline, Provenienz je Eintrag) | mittel (DB-Migration, Neu-Download nötig) | `overture-dealers.ts`, `dealer-directory.service.ts`, `directory-index.ts`, Migration, `docs/dealer-directory.md` | keine |
| 10 | **OSM-Attribute in den Ortsdetails**: `second_hand`, `service:vehicle:*`, `operator`, `brand:wikidata` | mittel (neu/gebraucht, nur Service, Gruppe) | klein | `osmDetails.service.ts`, `shared/types.ts`, Detail-Dialog (weitere Zeilen) | keine |
| 11 | **Photon-Parameter modernisieren**: `countrycode=de`, `layer` bei Adressabsicht, `osm_tag` → `include` (nach Prüfung) | mittel | klein | `places.service.ts`, `docs/location-search.md` | keine |
| 12 | **Overture Addresses als Hauskoordinaten-Quelle** für HH, NW, HE, TH, RP, ST, HB (Bayern bleibt Lücke) | hoch in 7 Ländern (Gebäude statt Straßenmitte) | groß (Messung Row-Group-Größe, Abgleich, Tests, Lizenzvermerke je Land) | `house-coordinates.service.ts`, `overture-dealers.ts`/Worker, `docs/official-buildings.md`, `PRIVACY.md` | keine |
| 13 | **Markenaliase aus NSI/Wikidata** als mitgelieferte Tabelle statt vier Handgruppen | mittel | klein–mittel | `place-query.ts`, Build-Skript, Lizenzhinweis | keine (Build-Zeit) |
| 14 | **Import-Härtung**: Größenlimit in den IPC-Schemata, `|`-Trennzeichen, Fixture-/Property-Tests für die neuen Fälle, abgebrochenen Lauf fortsetzbar lassen, Geocode-Cache bereinigen | mittel | klein–mittel | `ipc-schema.ts`, `csv.service.ts`, `import-parsers.property.test.ts`, `runtime.ts`, `cache.service.ts` | keine |

Nicht empfohlen:
- libpostal (1,8 GB Daten, nativer Build) — Aufwand und Paketgröße ohne Mehrwert gegenüber einer kleinen deutschen Normalisierung.
- BKG-Geokodierdienst, GA, HK-DE Bund — nicht offen (Lizenzvertrag/Authentifizierung).
- Foursquare OS Places und AllThePlaces als Direktquelle — Zugangshürde bzw. Scraping-Herkunft; Inhalte kommen über Overture ohnehin an.
- Hersteller-Händlersuchen — Scraping, Nutzungsbedingungen ungeprüft, rechtlich zweifelhaft.
- Auslandsregister (AT/CH/NL/FR/DK/BE) — erst sinnvoll, wenn die App über Deutschland hinausgeht.

### Gaps
- Die Rangfolge beruht auf Code-Lektüre und Dokumentation, nicht auf gemessenen Fehlerraten; vor den größeren Punkten (8, 9, 12) sollte mit den Beispiel-Portfolios per Replay gemessen werden, wie oft der Anker heute nicht auf dem Gebäude liegt und wie viele Zeilen das Verzeichnis eindeutig auflösen würde.
- Aufwandsschätzungen sind grob (klein = Stunden bis ein Tag, mittel = einige Tage, groß = eine Woche oder mehr) und nicht mit dem Team abgestimmt.
