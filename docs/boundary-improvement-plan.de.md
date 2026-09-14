# Grundstückserkennung: Verbesserungsplan zur manuellen Prüfung

**Status:** Entwurf zur Freigabe; keine Implementierung begonnen.  
**Stand:** 14. September 2026; Codebasis `169a48f`.  
**Ziel:** Betriebsflächen vollständiger erkennen, Nachbarflächen seltener aufnehmen und den manuellen Korrekturaufwand deutlich reduzieren.

## 1. Empfehlung und Umfang

Die nächste Version soll pro Teilfläche beantworten können: **Gehört diese Fläche zu diesem Standort, wodurch ist das belegt und wo ist ihre Grenze?** Dafür werden Betriebszuordnung, Geometrie und Unsicherheit gemeinsam verbessert.

Empfohlen sind drei aufeinander aufbauende Lieferstufen:

| Lieferstufe | Inhalt | Erwarteter Nutzen; noch zu messen |
| --- | --- | --- |
| A — belastbare Grundlage | Aktive Engine sichtbar machen, reproduzierbaren Benchmark aufbauen, Geometrieverluste und Quellenstatus korrigieren | Verbesserungen kommen in der App an und werden unter identischen Bedingungen messbar |
| B — bessere Betriebsflächen | Standortzuordnung, Teilflächenmodell, mehrere Kandidaten, abschnittsweises Kataster-Snapping, schnelle manuelle Korrektur | Weniger fremde Parkplätze, weniger abgeschnittene Betriebsflächen, weniger Nachzeichnen |
| C — gezielte Bilderweiterung | Fahrzeuge vor der finalen Grenze erkennen; Segmentierung als gesondertes Experiment und gegebenenfalls integrieren | Zusätzliche Flächen bei lückenhaftem OSM und schwachem Kataster erkennen |

Die konkrete Wirkung wird nach jeder Stufe gemessen. Eine bundesweit zuverlässige Vollautomatik oder eine bestimmte Genauigkeit ist durch die bisher vorliegenden Daten noch nicht belegbar.

Die Umsetzung beginnt erst nach deinem Review dieses Plans. Die folgenden Arbeitspakete sind eine Planung, keine bereits ausgeführten Änderungen. Commit, Push und Veröffentlichung sind nicht Bestandteil der Erstellung dieses Review-Dokuments.

## 2. Fachliche Festlegung

**Arbeitsannahme zur Prüfung:** Gesucht wird das operativ genutzte Gelände eines einzelnen Autohausstandorts. Dazu zählen zugeordnete Gebäude, Ausstellung, Lager, Werkstatt, Kundenparkplätze und interne Verkehrsflächen. Bepflanzte Inseln innerhalb des Betriebs können dazugehören; Versiegelung ist keine Voraussetzung für Betriebszugehörigkeit.

Katasterparzellen bleiben als gesonderte Ebene erhalten. Öffentliche Straßen, fremde Betriebe und nicht zuordenbare Gemeinschaftsflächen gehören nicht automatisch zur Betriebsfläche. Eine separate Fläche gegenüber kann dazugehören, wenn ihre Zuordnung belegt ist. Weitere Filialen desselben Unternehmens werden nicht allein wegen des gleichen Betreibers zusammengeschlossen.

Vier Beziehungen werden getrennt erfasst: geometrische Nachbarschaft, physische Verbindung, betriebliche Zugehörigkeit und rechtliche Parzellenstruktur. Eine gemeinsame Kante beweist keine gemeinsame Nutzung; ein interner Zaun trennt nicht zwingend zwei Betriebe.

Für mehrdeutige Fälle gibt es eine bestätigte Kernfläche und separat markierte mögliche Erweiterungen. „Unbekannt“ ist ein zulässiges Ergebnis. Unsichere Bereiche werden in der Bewertung berücksichtigt und im Review gezielt angeboten.

## 3. Was der aktuelle Code tatsächlich zeigt

Diese Befunde stammen aus der Codeprüfung. Der aktive Zustand einer installierten App und die aktuelle Erreichbarkeit der Katasterdienste wurden für diesen Plan nicht live geprüft.

| Befund | Konsequenz für den Plan | Einstieg im Repository |
| --- | --- | --- |
| Fusion läuft nur bei `boundaryEngine === "fused"`; die Standardsettings setzen diesen Wert nicht | Erst aktive Engine und Fallback-Gründe erfassen; tatsächlichen Installationszustand feststellen | `boundary.service.ts`, `settings.service.ts` |
| Der öffentliche Benchmark ruft `detectBoundary(lat, lon)` ohne Name und Adresse auf | Benchmark muss auch den produktiven Kontext abbilden | `boundary/boundary-benchmark.run.test.ts` |
| Die 17 öffentlichen Referenzen stammen aus OSM; OSM ist zugleich Eingangsquelle | Als technische Regression behalten; unabhängige manuelle Referenzen für die Qualitätsaussage ergänzen | `resources/benchmarks/` |
| Die Montage erhält alle umliegenden OSM-Parkplätze und Händlerflächen als Unterstützung | Standortzugehörigkeit vor der Erweiterung prüfen | `boundary/fusion.ts` |
| Die Montage reduziert MultiPolygone auf den größten Außenring; die Fläche stammt dagegen aus der vollständigen Union | Geometrie und Fläche können auseinanderlaufen; alle Komponenten und Löcher durchgängig erhalten | `boundary/parcel-assembly.ts` |
| Auch Karte, Bildausschnitt und Evaluator verwenden an mehreren Stellen nur `coordinates[0]` | Eine reine Typänderung reicht nicht; alle Verbraucher müssen migriert werden | `BoundaryLayer.tsx`, `tiles.service.ts`, `boundary-benchmark.ts` |
| Fahrzeugerkennung folgt der Grenzerkennung und dem daraus abgeleiteten Bildausschnitt | Kontextbild und erste Fahrzeugerkennung vor die endgültige Grenzauswahl ziehen | `analyze.service.ts`, `detection.service.ts` |
| Fehlende Bildkacheln werden grau ersetzt; die Oberflächenheuristik sucht graue Flächen | Gültigkeitsmaske zwingend bis zur Segmentierung durchreichen | `tiles.service.ts`, `surface-boundary.service.ts` |
| Fusion verwendet Quellendiversität als `barrierSupport`; ihr `top2Margin` wird auf 1 gesetzt | Tatsächliche Grenzstützung und echte Kandidatenkonkurrenz messen | `boundary.service.ts` |
| Die Showroom-Sonderregel beruht auf Fläche; im Fusionspfad ist der übergebene Footprint bereits die gewachsene Fläche | Gebäude-/Geländesemantik explizit führen, statt allein 1.000 m² als Trennlinie zu verwenden | `boundary/fusion.ts`, `boundary/parcel-assembly.ts` |

Die historischen Befunde „16 Endpunkte gescheitert“, „CQL-Filter ignoriert“ und „Copernicus-URL liefert 404“ bleiben datierte Beobachtungen über die getesteten Requests. Daraus folgt weder dauerhafte Nichtverfügbarkeit ganzer Länder noch, dass standardkonforme räumliche WFS-Filter grundsätzlich unmöglich sind. Neue Quellen werden mit dokumentierten Kontrollabfragen geprüft.

## 4. Erfolg vor der Optimierung definieren

### Referenzdaten und faire Vergleiche

1. Mit 40 Pilotstandorten beginnen: erfolgreiche und fehlerhafte Fälle, unterschiedliche Regionen, kleine und große Gelände, mehrere Parzellen, Teilparzellennutzung, fremde Nachbarparkplätze, getrennte Standortelemente und Standorte ohne Katasterzugang.
2. Für eine breitere Freigabe auf zunächst 200 Standorte ausbauen: 100 Entwicklung, 40 Kalibrierung, 60 abschließender Hold-out. Pilotstandorte zählen zur Entwicklung. Räumliche Gruppen und gemeinsame Bildausschnitte bleiben jeweils vollständig in einem Split.
3. Mindestens 15 räumlich getrennte Gruppen anstreben, davon mindestens fünf im Hold-out. Ergebnisse zusätzlich nach Region, Quellenabdeckung und Schwierigkeit ausweisen. Diese Stichprobe liefert erste belastbare Hinweise, noch keinen Vollständigkeitsnachweis für alle Bundesländer.
4. Manuelle Referenzen anhand eines schriftlichen Annotationsleitfadens erstellen. Namen, Adressen, Bilddatum beziehungsweise unbekanntes Datum, Auflösung und Zuordnungsbelege dokumentieren. 20 % doppelt annotieren, strittige Fälle abgleichen. Sichtbar unentscheidbare Randbereiche gesondert markieren.
5. Referenzpolygone bei der Annotation zunächst ohne Modellvorhersage zeichnen. Den bisherigen OSM-Satz und nutzerinitiierte Korrekturen separat ausweisen, weil beide andere Verzerrungen besitzen.
6. Eingangsquellen pro Standort versioniert einfrieren: Rohdaten, normalisierte Features, Bildausschnitt, Gültigkeitsmaske, Herkunft, Zeit, Abfrageparameter und Prüfsummen. Speicherung und Weitergabe richten sich nach den jeweiligen Datenrechten. Kundengeometrien bleiben entsprechend der vorhandenen Projektregel außerhalb des Repositorys.
7. Alle Algorithmen gegen dieselben eingefrorenen Inputs abspielen. Zusätzlich kontrollierte Ausfallszenarien messen. Live-Erreichbarkeit separat protokollieren; ein Quellenwechsel zwischen zwei Läufen darf nicht als Algorithmusgewinn gelten.

Der heutige Legacy-Stand und die heutige Fusion werden beide als neue Vergleichsbasis gemessen. Die historische IoU von 0,331 ist Kontext und kein ausreichender Maßstab für die neue Version. Im Kontextbenchmark erhalten beide Engines dieselben Namen, Adressen und Koordinaten; ein zusätzlicher Koordinaten-only-Lauf misst die Robustheit bei fehlenden Metadaten.

Der abschließende Hold-out wird erst nach Fixierung der Methode geöffnet. Nach einer Anpassung anhand dieser Ergebnisse wird er zum Entwicklungsdatensatz; eine erneute finale Aussage benötigt neue unangetastete Testfälle.

### Vorgeschlagene Abnahmekriterien

Die Zahlen sind **Zielvorschläge für dein Review**, keine behaupteten Ergebnisse. Nach Erhebung der Baseline werden sie vor weiteren Optimierungen verbindlich festgelegt.

Sei `P` die Vorhersage, `R` die Referenz und `A` die Fläche. Gemessen wird pro Standort; Portfoliozahlen werden zusätzlich, nicht anstelle der Standortverteilung ausgewiesen.

| Kriterium | Definition / Zielvorschlag |
| --- | --- |
| Gesamtform | Mittlerer Fehler `1 − IoU` mindestens 25 % kleiner als bei der besseren der beiden aktuellen Baselines |
| Fehlende Betriebsfläche | Mittel von `A(R \ P) / A(R)` mindestens 20 % kleiner |
| Zusätzlich aufgenommene Fläche | Mittel von `A(P \ R) / A(R)` mindestens 30 % kleiner; explizit fremde Betriebsflächen separat markieren |
| Bereits gute Fälle | Mindestens 90 % der Fälle mit bisheriger IoU ≥ 0,85 verlieren höchstens 0,03 IoU |
| Schwere Fehler | Kein neuer unmarkierter schwerer Fehler im Test: mehr als 25 % fehlende oder zusätzliche Fläche oder ein wesentlicher falscher Standortteil |
| Manuelle Arbeit | Median der Zeit bis zu einer akzeptierten Grenze mindestens 30 % kleiner; 90. Perzentil darf nicht schlechter werden |
| Automatische Freigabe | Ziel mindestens 60 % ohne nötige geometrische Korrektur; falsche automatische Freigaben separat mit Stichprobengröße und Unsicherheitsintervall ausweisen |
| Geometrie | Alle gespeicherten Ergebnisse valide; Flächenberechnung, Anzeige, Export und Fahrzeugfilter verwenden dieselbe vollständige Geometrie |

Bei einem Baselinefehler von null gilt Erhalt statt relativer Verbesserung. Grenz-F1 bei 2 m und 5 m, signierter Flächenfehler, schlechtestes Zehntel und Ergebnis pro Fallklasse ergänzen die Hauptmetriken. Zwei Meter sind eine Messtoleranz, keine zugesagte Lagegenauigkeit des Luftbilds. Unklare Referenzbereiche werden separat als Sensitivitätsanalyse ausgewertet.

Gepaarte Differenzen und nach räumlichen Gruppen berechnete Unsicherheitsintervalle begleiten jede Qualitätsaussage. Ist die Datenlage für ein Kriterium zu dünn, bleibt der Rollout auf einen überprüften Pilot begrenzt. Ein geringer Review-Aufwand darf nicht durch still akzeptierte Fehler entstehen.

## 5. Zielarchitektur

Die Verarbeitung erhält eine gemeinsame, versionierte Evidenzsammlung pro Standort:

```text
Adresse / Koordinaten / bestehende manuelle Vorgaben
                         ↓
Standortkandidaten + begrenzter Suchraum
                         ↓
OSM + Kataster + Kontextbild + Quellenstatus
                         ↓
Gebäude / Stellflächen / Zufahrten / Barrieren / Fahrzeuggruppen
                         ↓
Standortzugehörigkeit pro Teilfläche
                         ↓
Bis zu drei plausible Geländevarianten
                         ↓
Lokale Grenzanpassung + vollständige Geometrieprüfung
                         ↓
Auswahl mit Unsicherheit → gezieltes Review → Speicherung
                         ↓
Fahrzeuge innerhalb der bestätigten Fläche + bestehende Risikoberechnung
```

Bildsegmentierung ist ein optionaler Lieferant von Teilflächen. Sie entscheidet nicht allein über deren Zugehörigkeit. Der geometrische Kern bleibt ohne Netzwerk und Modellaufrufe ausführbar. Die bestehende Provider-Architektur und der reine Fusionskern werden weiterverwendet.

Die Evidenz enthält stabile Feature-IDs, Quellfamilie, Abfrage- und Beobachtungszeit, Qualität, Abdeckung, Objektart und Zuordnungsargumente. OSM-Features aus Overpass und Nominatim gelten bei gleicher Herkunft nicht als unabhängige Bestätigungen. Dieselbe Beobachtung darf nicht mehrfach das Vertrauen erhöhen.

## 6. Arbeitspakete und ihre Abnahme

### P0 — Ist-Zustand, Diagnose und Versionen

**Arbeit:** Installierten Build, aktive Engine, gespeicherte Analyseversion und wirksame Einstellungen read-only prüfen. Pro Ergebnis angeforderte und tatsächlich verwendete Engine, Fallback-Grund, Quellenstatus und Parameterversion speichern. In der Diagnoseansicht sichtbar machen. Veraltete Dokumentationsstellen berichtigen. Gespeicherte Ergebnisse und Caches explizit versionieren; Neuberechnung alter automatischer Ergebnisse anbieten, manuelle Grenzen bewahren.

**Lieferung:** Diagnosebericht und reproduzierbare Aufrufe für Legacy/Fusion mit identischem Standortkontext.

**Abnahme:** Ein Teststandort lässt sich bis zum tatsächlichen Ausführungspfad erklären. Fehlende Einstellung, Quellenfehler, alter Cache und echte geometrische Ablehnung sind unterscheidbar. Noch keine pauschale Aktivierung einer ungemessenen neuen Engine.

### P1 — Referenzsatz und deterministischer Replay-Benchmark

**Arbeit:** Referenzsatz aus Abschnitt 4, Snapshot-Format und Replay-Runner erstellen. Benchmark um Namen, Adressen, Quellenstatus, neue Fehlermetriken und getrennte Ausfalltests erweitern. Bild-Overlays pro Standort ausgeben: Referenz, Vorhersage, fehlende und zusätzlich aufgenommene Flächen.

**Lieferung:** Pilotdatensatz, Baselinevergleich, Fehlerkatalog, ausführbarer Offline-Benchmark und Messblatt für manuelle Bearbeitungszeit.

**Abnahme:** Wiederholte Ausführung mit denselben Inputs, Parametern und Versionen liefert dieselben Ergebnisse. Beide heutigen Engines sind gemessen. Referenzen gelangen nicht als zusätzliche Features in die Erkennung.

### P2 — Vollständige Geometrie und verlässliche Quellenverarbeitung

**Arbeit:** Gemeinsamen Typ für `Polygon | MultiPolygon` mit Innenringen einführen. Kleine zentrale Funktionen für Fläche, Bounding Box, Punktzugehörigkeit, Union, Rasterisierung und Darstellung etablieren. Parser, Montage, Fusionsvektorisierung, Karte/Editor, IPC, Sitzungsspeicherung, Fahrzeugfilter, Dachauswertung, Exporte und Benchmark auf vollständige Geometrie umstellen. Alte Polygon-Sitzungen bleiben lesbar; bestehende manuelle Originale bleiben erhalten.

Für Entfernungen, Snapping und Bildzuordnung explizite Koordinatentransformationen mit metrischer Arbeitsebene verwenden. WFS-Version, CRS, Achsenreihenfolge, Pagination, abgeschnittene Antworten und Geometriegültigkeit prüfen. Zusammenführungsfehler werden als unvollständiges Ergebnis gemeldet. Flächenzahlen werden aus genau der ausgegebenen Geometrie berechnet.

Quellenstatus differenzieren: nicht abgefragt, erfolgreich mit Daten, erfolgreich leer, teilweise geliefert, zeitweise fehlgeschlagen und für diesen Ort nicht unterstützt. Bei räumlich gerundeten Cache-Schlüsseln punktbezogene Werte wie `containsAnchor` für den aktuellen Punkt neu berechnen. Cache-Schlüssel berücksichtigen auch Bildanbieter-Konfiguration und Daten-/Parser-/Modellversion.

**Lieferung:** Durchgängiger Geometrievertrag und geprüfte Quellenadapter.

**Abnahme:** Zwei getrennte Flächen und ein Innenloch überstehen Laden, Editieren, Speichern, Neustart, Bildbeschaffung und Export. Fahrzeuge im Loch werden ausgeschlossen. Teilweise fehlende Bilder besitzen eine Gültigkeitsmaske und erzeugen keine Asphalt-Evidenz. Adapter-Kontrolltests erkennen ignorierte Filter und falsche Achsenreihenfolge.

### P3 — Standortzugehörigkeit und begrenzte Teilflächenmontage

**Arbeit:** Geocoding-Kandidaten anhand des verfügbaren Standorthinweises bewerten; mehrdeutige Treffer erhalten Unsicherheit. Neben dem Adresspunkt können sicher zugeordnete Gebäude oder Flächen als Startpunkte dienen.

Teilflächen bekommen nachvollziehbare Zugehörigkeitssignale: Name, Betreiber, Adresse, Gebäudenutzung, Eingang/Zufahrt, interne Verbindung und bestätigte Nachbarteile. Fremde Identität oder getrennte betriebliche Erschließung sind Gegenargumente. Fehlende Tags bleiben unbekannt. Namensvarianten werden normalisiert; gleicher Konzernname allein reicht nicht.

Aus den Teilflächen entsteht ein Graph mit getrennten Beziehungen für Nachbarschaft, Zugang und Betriebszugehörigkeit. Im ersten Schritt reicht eine deterministische, begrenzte Suche mit dokumentierten Scores. Jede Erweiterung braucht eigene Unterstützung; räumliche Nähe und graue Pixel genügen nicht. Interne Zäune, Grüninseln und Fahrgassen werden kontextabhängig behandelt. Gebäude versus Gesamtgelände wird semantisch bestimmt; die Showroom-Flächenregel bleibt höchstens ein schwacher Prior.

Suchraum bei belegten Hinweisen am Ausschnittsrand kontrolliert erweitern, anfangs höchstens zweimal und mit Gesamtbudget. Ein erreichtes Limit führt zu „möglicherweise unvollständig“. Abfrageabdeckung und Bildausschnitt wachsen konsistent mit. Getrennte Flächen benötigen stärkere Zuordnung und bleiben geometrisch getrennt.

**Lieferung:** Zugehörigkeitsbewertung pro Teilfläche einschließlich positiver/negativer Gründe; verbesserte Montage.

**Abnahme:** Autohaus neben Supermarkt, zwei benachbarte Autohäuser, Showroom auf großer Parzelle, Privatparkplatz ohne Tags und belegtes Außenlager gegenüber sind im Replay abgedeckt. Jeder hinzugefügte Standortteil ist begründbar; keine unkontrollierte Kette durch ein Gewerbegebiet.

### P4 — Kandidatenvergleich und abschnittsweises Snapping

**Arbeit:** Bis zu drei unterschiedliche plausible Geometrien erzeugen, etwa Kernfläche, Kern plus sicher angebundene Erweiterung und Variante mit separatem Lagerplatz. Doppelte Kandidaten entfernen. Rangfolge anhand von Zugehörigkeit, tatsächlich gestützter Kontur, Gegenargumenten und fehlender Evidenz bilden.

Einzelne Konturabschnitte dürfen zu Kataster-, Zaun- oder Straßenkanten wandern, wenn Abstand, Richtung, lokale Evidenz und Gesamtgeometrie passen. Toleranzen folgen Auflösung und Lageunsicherheit; keine pauschale Genauigkeit aus der Rasterzellgröße ableiten. Verschiebung, Flächenänderung und Topologie begrenzen. Bei Verschlechterung zum ursprünglichen Abschnitt zurückkehren. Unbelegte Lücken werden nicht durch eine große Hülle geschlossen.

`barrierSupport` misst danach wirklich den gestützten Anteil der Kontur. Ein Kandidatenabstand entsteht aus konkurrierenden Ergebnissen; fehlende Alternativen bedeuten nicht automatisch maximale Sicherheit. Snapping ist eine kontrollierte Korrektur, keine unabhängige neue Bestätigung derselben Evidenz.

**Lieferung:** Begründete Varianten, lokale Grenzstützung, sichere Konturanpassung.

**Abnahme:** Nutzung einer Teilparzelle bleibt eine Teilparzelle. Kleine Lagefehler werden korrigiert, ohne Nachbarflächen zu übernehmen. Löcher, schmale Zufahrten und separate Komponenten bleiben gültig. Der Replay zeigt den isolierten Effekt des Snappings gegenüber P3.

### P5 — Fahrzeug- und Bildevidenz; Experiment mit Entscheidungsschwelle

**Arbeit:** Kontextbild vor der finalen Grenze beschaffen und das vorhandene Fahrzeugmodell zunächst ohne endgültigen Grenzfilter ausführen. Ergebnisse einschließlich Georeferenzierung wiederverwenden; nach Grenzauswahl nur räumlich zuordnen. Bei überlappenden Kacheln Fahrzeuge deduplizieren. Falls kein reales Modell vorhanden ist, liefern Ersatzschätzungen keine Fahrzeug-Evidenz für die Grenzerkennung.

Fahrzeuggruppen können zusätzliche Stellflächen stützen. Leere Stellflächen werden nicht abgewertet; fremde Parkplatzgruppen müssen dieselbe Zugehörigkeitsprüfung passieren. Aus Fahrzeuggruppen wird keine pauschale Gelände-Hülle erzeugt.

Optionalen Segmentierungsprototyp auf denselben Bildern vergleichen: heutige Oberflächenheuristik, Variante mit Fahrzeug-Evidenz und Variante zusätzlich mit vortrainierter Segmentierung. Sichere Betriebsflächen dienen als positive, sichere fremde Bereiche als negative Vorgaben. Bildalter, Wolken/Schatten, Kachelqualität und tatsächliche Bodenauflösung fließen in die Bewertung ein. Aufnahmezeit und Abrufzeit bleiben getrennt.

SamGeo ist ein möglicher Prototyp-Adapter: Die offizielle Dokumentation beschreibt GeoTIFF-Segmentierung, Vordergrund-/Hintergrundmarkierungen und Vektorexport. Die Desktop-Eignung und Autohausgenauigkeit müssen jedoch separat gemessen werden. Modellversion, Gewichte, Lizenzbedingungen, Laufzeit, Speicher und Paketgröße werden vor Integration festgehalten. [SamGeo-Dokumentation](https://samgeo.gishub.org/)

**Lieferung:** Wiederverwendbare Kontext-Inferenz und Vergleichsbericht mit klarer Entscheidung zur Segmentierung.

**Abnahme:** Fahrzeuge außerhalb der alten Grenze können eine belegte Erweiterung anregen. Leere Gelände und Nachbarparkplätze bleiben korrekt behandelt. Segmentierung wird nur übernommen, wenn sie auf dem Entwicklungs-/Validierungssatz den verbleibenden mittleren IoU-Fehler um mindestens weitere 10 % senkt, schwere Fehlzuordnungen nicht erhöht und das vereinbarte Laufzeitbudget einhält. Der finale Hold-out bleibt bis P7 geschlossen.

Scheitert das Experiment an Qualität oder Desktop-Ressourcen, wird Lieferstufe B mit der nützlichen Fahrzeug-Evidenz weitergeführt. Modelltraining ist eine spätere Option nach genügend kuratierten Beispielen; aus dem kleinen Pilot entsteht kein pauschales Trainingsversprechen.

### P6 — Review mit wenigen gezielten Entscheidungen

**Arbeit:** Kernfläche und strittige Teilflächen unterschiedlich darstellen. Aktionen „gehört dazu“, „gehört nicht dazu“, Teilfläche hinzufügen/entfernen, Loch erhalten/anlegen sowie bestehendes freies Editieren anbieten. Unterschiede zwischen bis zu drei Kandidaten direkt hervorheben; den wesentlichen Zuordnungsgrund anzeigen.

Manuelle Entscheidungen versioniert mit Original, Ergebnis und Undo speichern. Bei Neuberechnung gelten sie als Vorgaben; Widersprüche werden zur Prüfung gezeigt. „Vom Nutzer bestätigt“ getrennt von Modellkonfidenz führen. Aus der bestätigten Geometrie Fahrzeugzuordnung und betroffene abgeleitete Werte konsistent aktualisieren.

Korrekturen bilden zunächst einen lokalen Referenz- und Regelsatz. Automatisches Lernen aus jeder Bearbeitung ist nicht Teil der ersten Version. Gemeinsame Flächen können ausdrücklich unentschieden bleiben.

**Lieferung:** Bedienbarer Review-Ablauf mit dauerhaften Entscheidungen und korrekter Folgeanalyse.

**Abnahme:** Eine falsche Erweiterung lässt sich ohne Nachzeichnen entfernen; ein belegtes Außenlager hinzufügen. Undo, Neustart und erneute Analyse erhalten die Entscheidung. Gegenbalancierter Vergleich der alten und neuen Bedienung misst Bearbeitungszeit und Fehlerrate; Lern-/Reihenfolgeeffekte werden berücksichtigt.

### P7 — Kalibrierung, Gesamtabnahme und Einführung

**Arbeit:** Aus Fehlzuordnung, fehlender Evidenz, Kandidatenkonkurrenz, Bildqualität und Instabilität bei kleinen plausiblen Eingabeänderungen eine Review-Entscheidung ableiten. Stabilität ist ein Diagnosemerkmal, kein Beweis für Richtigkeit.

Qualitätsklassen zunächst erklärbar halten. Eine Prozentwahrscheinlichkeit erst verwenden, wenn sie auf dem separaten Kalibrierungssatz auf ein klares Ereignis kalibriert wurde, zum Beispiel „keine wesentliche geometrische Korrektur nötig“. Erwartete IoU und Wahrscheinlichkeit einer akzeptablen Grenze dürfen nicht vermischt werden. Automatische Akzeptanzrate und Fehler unter akzeptierten Fällen gemeinsam ausweisen.

Methode einfrieren, finalen Hold-out öffnen, Ziele prüfen und Fall-Overlays manuell durchsehen. Standardmäßig zuerst Schattenvergleich: neue Ergebnisse berechnen, bestehende Grenzen nicht ersetzen. Danach begrenzter Pilot und erst nach bestandener Abnahme Standardaktivierung. Neue Versionen dürfen bestätigte manuelle Grenzen nicht überschreiben. Engine und Ergebnisversion bleiben für Rollback verfügbar.

**Lieferung:** Abnahmebericht, Vorher-/Nachher-Fälle, bekannte Einschränkungen, Ressourcenmessung und Rückfallweg.

**Abnahme:** Ziele aus Abschnitt 4 erfüllt beziehungsweise transparent als nicht erreicht ausgewiesen; keine Freigabe aufgrund eines besseren Durchschnitts bei neuen schweren Fehlern. Gebaute Desktop-App, nicht nur Tests, zeigt die neue Engine und korrekte Ergebnisse.

### P8 — Zusätzliche Datenabdeckung als gesonderte Spur

**Arbeit:** Für Regionen mit nachgewiesenem Datenmangel offizielle GDI-/INSPIRE-Kataloge und Landesportale durchsuchen. WFS oder alternative offiziell angebotene Downloads/API-Zugänge anhand tatsächlicher Geometrien prüfen. DOP/Orthofotos nach Abdeckung, Datum und Auflösung bewerten. Bestehende Endpoint-Negativbefunde nicht ungeprüft fortschreiben.

Jeder neue Adapter braucht einen positiven Standort, einen passenden negativen Kontrollbereich, lokale Lageprüfung, Vergleich unterschiedlicher BBOXen, CRS-/Pagination-Tests und dokumentierte Nutzungsbedingungen. WFS-Filterunterstützung wird pro Dienst und Requestform geprüft; die allgemeine Schnittstellenreferenz ist die [OGC-WFS-Spezifikation](https://www.ogc.org/standards/wfs/).

**Lieferung:** Verifizierte Quellenmatrix mit Datum, Abdeckung, Limitierungen und reproduzierbaren Abfragen.

**Abnahme:** Ein neuer Dienst liefert im Replay passende Geometrien und verbessert konkrete bisher schwache Fälle. Ein versiegelungsbezogener Grobraster-Layer wäre höchstens Kontext; er ersetzt keinen Nachweis einer Grundstückskante. P8 ist keine Voraussetzung für Lieferstufe B.

## 7. Reihenfolge, Aufwand und Zuständigkeit

| Paket | Abhängigkeit | Grobe Aufwandsspanne in Personentagen |
| --- | --- | --- |
| P0 Diagnose | keine | 1–2 |
| P1 Benchmark und Referenzorganisation | P0 | 3–5 plus Annotation |
| P2 Geometrie und Quellenstatus | P0; Tests aus P1 | 4–7 |
| P3 Betriebszuordnung | P1, P2 | 4–7 |
| P4 Kandidaten und Konturanpassung | P3 | 3–5 |
| P5 Fahrzeugkontext und Segmentierungsversuch | P1, P2; Zuordnung aus P3 für Integration | 4–7 für Experiment; bei Erfolg weitere 3–6 für Integration |
| P6 Review | P2; finale Anbindung an P3/P4 | 3–5 |
| P7 Abnahme und Einführung | P1–P4, P6; P5 falls übernommen | 3–5 |
| P8 Quellenrecherche | nach Fehlerpriorisierung aus P1, parallel möglich | zunächst auf 3 Tage begrenzen, danach Ergebnisentscheidung |

Lieferstufen A/B einschließlich Abnahme: **21–36 Personentage plus Annotation**. P5 und P8 sind zusätzliche, begrenzte Arbeitspakete. Das sind Planungsschätzungen für Implementierung und Prüfung durch eine erfahrene Person, keine zugesagte Kalenderdauer. Nach P1/P2 wird anhand der tatsächlichen Migrationsbreite neu geschätzt.

Technische Umsetzung und Benchmarks liegen bei der Entwicklung. Fachliche Abgrenzung, strittige Referenzflächen und manuelle Endabnahme benötigen einen Reviewer mit Standortkenntnis. Für 200 Referenzen zunächst etwa 20–40 Stunden Annotation/Abgleich reservieren und nach den ersten zehn Fällen korrigieren. Warten auf externe Dienste oder neue Bilddaten ist darin nicht enthalten.

Parallel sinnvoll: Annotation zu P2; P5-Prototyp und Review-Oberfläche nach Festlegung des Geometrievertrags; P8 nach bekanntem regionalem Fehlerbild. Der kritische Pfad lautet P0 → P1/P2 → P3 → P4 → P7; P6 muss vor P7 integriert sein.

## 8. Laufzeit, Desktop-Betrieb und Verifikation

**Vorgeschlagene Budgets zur Prüfung:** Auf dokumentierter Referenzhardware höchstens 15 Sekunden im 95. Perzentil für die geometrische Erkennung mit bereits geladenen Inputs; bei frischem Abruf spätestens nach 60 Sekunden ein nachvollziehbarer Vektor-/Fallback-Stand; optionale Bildverfeinerung insgesamt auf 120 Sekunden begrenzen. Budgets werden in P1 gemessen und vor Integration festgelegt. GPU-Verfügbarkeit wird nicht vorausgesetzt.

Alle Provider teilen ein Gesamtzeitbudget. Spiegelwechsel und Wiederholungen dürfen es nicht multiplizieren; Teilaufgaben müssen abbrechbar sein. Tileanzahl, Pixelzahl, Suchraum und parallele Standorte sind begrenzt. Inferenz läuft außerhalb des UI-Threads. Kachelweise Verarbeitung vermeidet riesige Bilder zwischen entfernten Standortteilen. Fortschritt, Abbruch und Teilresultate sind im Desktop nachvollziehbar.

Die Produktionsintegration eines Segmentierungsmodells braucht Nachweise auf macOS Apple Silicon/Intel und Windows x64 oder einen ausdrücklich eingeschränkten Funktionsumfang mit Vektor-Fallback. Python-Prototyp, ONNX-Portierung und produktiv verteiltes Modell sind getrennte Meilensteine; eine portable Modellintegration wird nicht einfach angenommen.

Gezielte Tests sichern die konkreten Fehlerklassen: Punkt auf Straße, falscher Geocoding-Treffer, zwei Betriebe auf einer Parzelle, ein Betrieb auf mehreren Parzellen, Eckberührung, echte gemeinsame Kante, schmale Lücke, internes Tor, MultiPolygon, Loch, partieller WFS-Download, ignorierter Filter, fehlende Bildkachel, veralteter Cache, leeres Gelände und fehlendes Fahrzeugmodell.

Zusätzlich gelten die vorhandenen CI-Prüfungen: Typecheck, Lint, Tests/Coverage, Build, Desktop-Smoke und Dependency-Audit. Offline-Replays können CI-Gates bilden; öffentliche Geodienste bleiben außerhalb deterministischer CI-Gates. Vor Veröffentlichung werden Pakete und ein kompletter Ablauf von Import bis Export auf den Zielplattformen geprüft.

## 9. Was du beim Review entscheiden solltest

Die folgenden Empfehlungen machen den Plan ausführbar. Abweichungen lassen sich hier festhalten, bevor Implementierung beginnt.

| Entscheidung | Empfehlung | Dein Kommentar |
| --- | --- | --- |
| Fachliche Zielgrenze | Operativ genutzter Einzelstandort inklusive zugehöriger Gebäude/Grüninseln; Kataster separat | |
| Getrennte Teilflächen | Zulassen bei belegter Standortzugehörigkeit; keine Verbindungshülle über Straßen | |
| Mehrdeutige Gemeinschaftsflächen | Markieren und gezielt bestätigen lassen | |
| Priorität | Falsche Nachbarflächen stärker reduzieren, zugleich fehlende Betriebsflächen messbar senken | |
| Lieferumfang | A/B verbindlich planen; P5 als Experiment mit messbarer Eintrittsschwelle | |
| Rechenbetrieb | Lokaler Desktop als Basis; keine vorausgesetzte GPU oder Cloudabhängigkeit | |
| Referenzdaten | 40 Pilotfälle, vor breiter Freigabe 200 kuratierte Fälle und unabhängiger Hold-out | |
| Zusatzquellen | P8 zeitlich begrenzen und nach Fehlerregion priorisieren | |
| Automatische Aktivierung | Erst nach Schattenvergleich, Pilot und bestandenen Abnahmekriterien | |

**Review-Ergebnis:** ☐ freigegeben · ☐ mit Änderungen freigegeben · ☐ überarbeiten  
**Anmerkungen:**

---

## 10. Nachweise und Einstiegspunkte

Die Codebefunde beziehen sich auf `169a48f` und die folgenden Dateien unter `/Users/janis/GitHub/DealerShipRiskMappingApp`:

- [Engine und Kandidatenauswahl](/Users/janis/GitHub/DealerShipRiskMappingApp/desktop-app/src/main/services/boundary.service.ts)
- [Fusionskern](/Users/janis/GitHub/DealerShipRiskMappingApp/desktop-app/src/main/services/boundary/fusion.ts)
- [Parzellenmontage](/Users/janis/GitHub/DealerShipRiskMappingApp/desktop-app/src/main/services/boundary/parcel-assembly.ts)
- [Evidenzbeschaffung](/Users/janis/GitHub/DealerShipRiskMappingApp/desktop-app/src/main/services/boundary/evidence-sources.ts)
- [Katasteradapter](/Users/janis/GitHub/DealerShipRiskMappingApp/desktop-app/src/main/services/alkis.service.ts)
- [Analyseablauf](/Users/janis/GitHub/DealerShipRiskMappingApp/desktop-app/src/main/services/analyze.service.ts)
- [Bildbeschaffung](/Users/janis/GitHub/DealerShipRiskMappingApp/desktop-app/src/main/services/tiles.service.ts)
- [Oberflächenheuristik](/Users/janis/GitHub/DealerShipRiskMappingApp/desktop-app/src/main/services/surface-boundary.service.ts)
- [Datenmodell](/Users/janis/GitHub/DealerShipRiskMappingApp/desktop-app/src/shared/types.ts)
- [Karte und Editor](/Users/janis/GitHub/DealerShipRiskMappingApp/desktop-app/src/renderer/src/components/map/BoundaryLayer.tsx)
- [Benchmark-Runner](/Users/janis/GitHub/DealerShipRiskMappingApp/desktop-app/src/main/services/boundary/boundary-benchmark.run.test.ts)
- [Benchmark-Metriken](/Users/janis/GitHub/DealerShipRiskMappingApp/desktop-app/src/main/services/boundary-benchmark.ts)
- [Vorhandene Modelldokumentation](/Users/janis/GitHub/DealerShipRiskMappingApp/docs/boundary-model.md)

Externe Referenzen wurden am 14. September 2026 für die Planung eingesehen. Sie belegen verfügbare Schnittstellen und Werkzeuge, nicht die Qualität einer noch nicht implementierten Autohauserkennung.
