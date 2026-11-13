import { AlertTriangle, ExternalLink, FileSpreadsheet, FileText } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { DownloadCards, UnsignedBuildNotes } from "@/components/download";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { DocSlug } from "@/lib/docs-pages";
import type { Lang, Localized } from "@/lib/i18n";
import {
  DATASET_REPO_URL,
  RELEASES_URL,
  SAMPLE_DATASETS,
  repoFile,
  sitePath,
} from "@/lib/site";

const SAMPLE_CSV = `name,address,lat,lon,value
Autohaus Beispiel Nord,"Musterstraße 1, 20095 Hamburg",,,1800000
Autohaus Beispiel Süd,"Beispielweg 5, 80331 München",48.137,11.575,2500000`;

const MODEL_PATH = "desktop-app/resources/models/yolov26s_aerial_vehicles.onnx";

const EAL_FORMULA = "EAL = N × λ_z × (p_S·S_S + p_M·S_M + p_L·S_L)";

const BUILD_COMMANDS = (comment: string): string => `git clone https://github.com/JanisKre/DealerShipRiskMappingApp.git
cd DealerShipRiskMappingApp/desktop-app
npm ci
npm run rebuild
npm run dev
# ${comment}
npm run dist`;

const INSTALLATION: Localized<React.ReactNode> = {
  en: (
    <>
      <p>
        Installers are built from the repository by the tag-driven release
        workflow and ship with SHA-256 checksums, a CycloneDX SBOM and build
        provenance.
      </p>
      <DownloadCards />
      <p className="text-muted-foreground">
        Linux: build an AppImage from source (see{" "}
        <A href={sitePath("installation", "build")}>Build from source</A>).
        Older versions, checksums and SBOMs are on the{" "}
        <A href={RELEASES_URL}>releases page</A>.
      </p>
      <H2 id="unsigned-builds">Opening an unsigned build</H2>
      <p>
        Builds are not code-signed yet (no paid developer certificate), so the
        operating system warns on first launch.
      </p>
      <UnsignedBuildNotes />
      <H2 id="updates">Updates</H2>
      <p className="text-muted-foreground">
        The app checks this repository’s releases at start-up and once a day.
        Windows downloads an update in the background and installs it on the
        next restart; on macOS the app links to the release page. Switch the
        check off under Settings → General → App &amp; support if your
        organisation rolls out versions itself.
      </p>
    </>
  ),
  de: (
    <>
      <p>
        Die Installer entstehen im Repository über den tag-gesteuerten
        Release-Workflow und enthalten SHA-256-Prüfsummen, eine CycloneDX-SBOM
        und Build-Provenienz.
      </p>
      <DownloadCards />
      <p className="text-muted-foreground">
        Linux: Baue ein AppImage aus dem Quellcode (siehe{" "}
        <A href={sitePath("installation", "build")}>Aus dem Quellcode bauen</A>).
        Ältere Versionen, Prüfsummen und SBOMs findest du auf der{" "}
        <A href={RELEASES_URL}>Releases-Seite</A>.
      </p>
      <H2 id="unsigned-builds">Unsignierten Build öffnen</H2>
      <p>
        Die Builds sind noch nicht code-signiert (kein kostenpflichtiges
        Entwicklerzertifikat), deshalb warnt das Betriebssystem beim ersten
        Start.
      </p>
      <UnsignedBuildNotes />
      <H2 id="updates">Updates</H2>
      <p className="text-muted-foreground">
        Die App prüft beim Start und einmal täglich die Releases dieses
        Repositorys. Unter Windows lädt sie ein Update im Hintergrund und
        installiert es beim nächsten Neustart; unter macOS verlinkt sie die
        Releases-Seite. Abschalten lässt sich die Prüfung unter Einstellungen
        → Allgemein → App &amp; Support, falls deine Organisation Versionen
        selbst verteilt.
      </p>
    </>
  ),
  fr: (
    <>
      <p>
        Les installateurs sont générés depuis le dépôt par le workflow de
        publication déclenché par tag et fournis avec des sommes de contrôle
        SHA-256, un SBOM CycloneDX et une attestation de provenance.
      </p>
      <DownloadCards />
      <p className="text-muted-foreground">
        Linux : compilez une AppImage depuis les sources (voir{" "}
        <A href={sitePath("installation", "build")}>Compiler depuis les sources</A>).
        Les anciennes versions, sommes de contrôle et SBOM se trouvent sur la{" "}
        <A href={RELEASES_URL}>page des versions</A>.
      </p>
      <H2 id="unsigned-builds">Ouvrir une version non signée</H2>
      <p>
        Les versions ne sont pas encore signées (pas de certificat de
        développeur payant), le système d’exploitation affiche donc un
        avertissement au premier lancement.
      </p>
      <UnsignedBuildNotes />
      <H2 id="updates">Mises à jour</H2>
      <p className="text-muted-foreground">
        L’application consulte les versions de ce dépôt au démarrage puis une
        fois par jour. Sous Windows, elle télécharge la mise à jour en
        arrière-plan et l’installe au prochain redémarrage ; sous macOS, elle
        renvoie vers la page des versions. Désactivez la vérification dans
        Paramètres → Général → Application et support si votre organisation
        déploie elle-même les versions.
      </p>
    </>
  ),
};

const QUICK_START: Localized<{ title: string; text: React.ReactNode }[]> = {
  en: [
    {
      title: "Install",
      text: (
        <>
          Download the installer for your platform and follow the notes for
          unsigned builds on the{" "}
          <A href={sitePath("quick-start", "installation")}>installation page</A>.
        </>
      ),
    },
    {
      title: "Install the detection model",
      text: "On first launch a wizard offers to download the vehicle detection model. You can skip it; the app then uses an area-based estimate.",
    },
    {
      title: "Import your portfolio",
      text: (
        <>
          Load a CSV, TSV or Excel file, or add single locations by address.
          Addresses without coordinates are geocoded. See the{" "}
          <A href={sitePath("quick-start", "import-format")}>import format</A>;
          to try the app first, use a{" "}
          <A href={sitePath("quick-start", "import-format", "#sample-datasets")}>
            sample dataset
          </A>{" "}
          with 10 to 500 real dealerships.
        </>
      ),
    },
    {
      title: "Review lot boundaries",
      text: "Boundaries to check are walked through one by one, each with its reasons: confirm, pick another suggestion or correct the polygon on the map. Edited boundaries are rescored immediately; “Save & update car detection” recounts the vehicles.",
    },
    {
      title: "Run the analysis",
      text: "The app counts vehicles, looks up the hail score and calculates the hail EAL for every location. A batch can be stopped after the active location and continued later; failures are kept per location.",
    },
    {
      title: "Read and share the results",
      text: "Explore the map and dashboard, open a location to see the full calculation, generate an AI memo and export to PDF, Excel, CSV or a .drm portfolio file.",
    },
  ],
  de: [
    {
      title: "Installieren",
      text: (
        <>
          Lade den Installer für deine Plattform herunter und folge den
          Hinweisen zu unsignierten Builds auf der{" "}
          <A href={sitePath("quick-start", "installation")}>Installationsseite</A>.
        </>
      ),
    },
    {
      title: "Erkennungsmodell installieren",
      text: "Beim ersten Start bietet ein Assistent an, das Modell zur Fahrzeugerkennung herunterzuladen. Du kannst das überspringen; die App schätzt dann anhand der Fläche.",
    },
    {
      title: "Portfolio importieren",
      text: (
        <>
          Lade eine CSV-, TSV- oder Excel-Datei oder füge einzelne Standorte
          per Adresse hinzu. Adressen ohne Koordinaten werden geokodiert. Siehe{" "}
          <A href={sitePath("quick-start", "import-format")}>Importformat</A>;
          zum Ausprobieren gibt es{" "}
          <A href={sitePath("quick-start", "import-format", "#sample-datasets")}>
            Beispieldatensätze
          </A>{" "}
          mit 10 bis 500 echten Autohäusern.
        </>
      ),
    },
    {
      title: "Grundstücksgrenzen prüfen",
      text: "Zu prüfende Grenzen gehst du einzeln durch, jeweils mit Begründung: bestätigen, einen anderen Vorschlag wählen oder das Polygon auf der Karte korrigieren. Bearbeitete Grenzen werden sofort neu bewertet; „Speichern & Fahrzeugerkennung aktualisieren“ zählt die Fahrzeuge neu.",
    },
    {
      title: "Analyse starten",
      text: "Die App zählt die Fahrzeuge, ermittelt den Hagel-Score und berechnet die Hagel-EAL für jeden Standort. Ein Lauf lässt sich nach dem aktiven Standort anhalten und später fortsetzen; Fehler bleiben je Standort erhalten.",
    },
    {
      title: "Ergebnisse lesen und teilen",
      text: "Erkunde Karte und Dashboard, öffne einen Standort für die vollständige Berechnung, erstelle ein KI-Memo und exportiere als PDF, Excel, CSV oder .drm-Portfoliodatei.",
    },
  ],
  fr: [
    {
      title: "Installer",
      text: (
        <>
          Téléchargez l’installateur pour votre plateforme et suivez les notes
          sur les versions non signées de la{" "}
          <A href={sitePath("quick-start", "installation")}>page d’installation</A>.
        </>
      ),
    },
    {
      title: "Installer le modèle de détection",
      text: "Au premier lancement, un assistant propose de télécharger le modèle de détection des véhicules. Vous pouvez l’ignorer ; l’application utilise alors une estimation fondée sur la surface.",
    },
    {
      title: "Importer le portefeuille",
      text: (
        <>
          Chargez un fichier CSV, TSV ou Excel, ou ajoutez des sites un par un
          par adresse. Les adresses sans coordonnées sont géocodées. Voir le{" "}
          <A href={sitePath("quick-start", "import-format")}>format d’import</A>{" "}
          ; pour un essai, utilisez un{" "}
          <A href={sitePath("quick-start", "import-format", "#sample-datasets")}>
            jeu de données d’exemple
          </A>{" "}
          de 10 à 500 vraies concessions.
        </>
      ),
    },
    {
      title: "Vérifier les limites de parcelle",
      text: "Les limites à vérifier sont passées en revue une à une, chacune avec ses motifs : confirmer, choisir une autre proposition ou corriger le polygone sur la carte. Les limites modifiées sont réévaluées immédiatement ; « Enregistrer et actualiser la détection » recompte les véhicules.",
    },
    {
      title: "Lancer l’analyse",
      text: "L’application compte les véhicules, récupère le score grêle et calcule l’EAL grêle de chaque site. Un lot peut être arrêté après le site en cours et repris plus tard ; les erreurs sont conservées par site.",
    },
    {
      title: "Consulter et partager les résultats",
      text: "Explorez la carte et le tableau de bord, ouvrez un site pour voir le calcul complet, générez une note IA et exportez en PDF, Excel, CSV ou fichier de portefeuille .drm.",
    },
  ],
};

const IMPORT_FORMAT: Localized<React.ReactNode> = {
  en: (
    <>
      <p>
        CSV, TSV (comma, semicolon or tab, detected automatically) and XLSX
        files are supported. Column names are matched case-insensitively, and
        German headers such as <Code>Autohaus</Code>, <Code>Adresse</Code> or{" "}
        <Code>PLZ</Code> work too. Title rows above the header are skipped; in
        a workbook, the sheet with the clearest header is read.
      </p>
      <H2 id="columns">Columns</H2>
      <ul className="text-muted-foreground list-disc space-y-1 pl-5">
        <li>
          <Code>name</Code> and <Code>address</Code> (or <Code>street</Code>,{" "}
          <Code>house number</Code>, <Code>postcode</Code>, <Code>city</Code>)
          identify each location.
        </li>
        <li>
          <Code>lat</Code> / <Code>lon</Code> are optional; empty values are
          geocoded.
        </li>
        <li>
          <Code>value</Code> is the insured value in EUR. Optional: website,
          business type, sales partner, subportfolio, group, limit and
          deductible.
        </li>
      </ul>
      <p className="text-muted-foreground">
        A preview lists every row before the import: duplicates and rows
        without a place are flagged, addresses can be checked and single rows
        left out.
      </p>
      <H2 id="sample-datasets">Sample datasets</H2>
      <p>
        No portfolio at hand? The{" "}
        <A href={DATASET_REPO_URL}>German car dealership dataset</A> holds real
        dealership locations from OpenStreetMap with name, address,
        coordinates and website. The files import as they are. Smaller sets
        are subsets of larger ones, spread over the federal states in
        proportion; start with 10 locations for a quick run.
      </p>
      <SampleDatasets lang="en" />
      <p className="text-muted-foreground text-sm">
        The files carry no portfolio terms (insured value, business type,
        limit, deductible); those fields stay empty. Records were not verified
        individually and are meant for testing. Data © OpenStreetMap
        contributors, ODbL 1.0.
      </p>
      <H2 id="sample">Minimal example</H2>
      <CodeBlock code={SAMPLE_CSV} plain />
    </>
  ),
  de: (
    <>
      <p>
        Unterstützt werden CSV, TSV (Komma, Semikolon oder Tab, automatisch
        erkannt) und XLSX. Spaltennamen werden ohne Beachtung der
        Groß-/Kleinschreibung zugeordnet; deutsche Überschriften wie{" "}
        <Code>Autohaus</Code>, <Code>Adresse</Code> oder <Code>PLZ</Code>{" "}
        funktionieren ebenfalls. Titelzeilen über der Kopfzeile werden
        übersprungen; aus einer Arbeitsmappe wird das Blatt mit der
        eindeutigsten Kopfzeile gelesen.
      </p>
      <H2 id="columns">Spalten</H2>
      <ul className="text-muted-foreground list-disc space-y-1 pl-5">
        <li>
          <Code>name</Code> und <Code>address</Code> (oder <Code>street</Code>,{" "}
          <Code>house number</Code>, <Code>postcode</Code>, <Code>city</Code>)
          identifizieren jeden Standort.
        </li>
        <li>
          <Code>lat</Code> / <Code>lon</Code> sind optional; leere Werte werden
          geokodiert.
        </li>
        <li>
          <Code>value</Code> ist der Versicherungswert in EUR. Optional:
          Website, Geschäftsart, Vertriebspartner, Teilportfolio, Gruppe, Limit
          und Selbstbehalt.
        </li>
      </ul>
      <p className="text-muted-foreground">
        Vor dem Import zeigt eine Vorschau jede Zeile: Dubletten und Zeilen
        ohne Ort werden markiert, Adressen lassen sich prüfen und einzelne
        Zeilen abwählen.
      </p>
      <H2 id="sample-datasets">Beispieldatensätze</H2>
      <p>
        Kein Portfolio zur Hand? Der{" "}
        <A href={DATASET_REPO_URL}>Datensatz deutscher Autohäuser</A> enthält
        echte Autohaus-Standorte aus OpenStreetMap mit Name, Adresse,
        Koordinaten und Website. Die Dateien lassen sich unverändert
        importieren. Kleinere Sets sind Teilmengen der größeren und
        proportional über die Bundesländer verteilt; für einen schnellen
        Durchlauf reichen 10 Standorte.
      </p>
      <SampleDatasets lang="de" />
      <p className="text-muted-foreground text-sm">
        Die Dateien enthalten keine Vertragsdaten (Versicherungswert,
        Geschäftsart, Limit, Selbstbehalt); diese Felder bleiben leer. Die
        Einträge wurden nicht einzeln geprüft und sind zum Testen gedacht.
        Daten © OpenStreetMap-Mitwirkende, ODbL 1.0.
      </p>
      <H2 id="sample">Minimalbeispiel</H2>
      <CodeBlock code={SAMPLE_CSV} plain />
    </>
  ),
  fr: (
    <>
      <p>
        Les fichiers CSV, TSV (virgule, point-virgule ou tabulation, détectés
        automatiquement) et XLSX sont pris en charge. Les noms de colonnes sont
        reconnus sans tenir compte de la casse, et les en-têtes allemands comme{" "}
        <Code>Autohaus</Code>, <Code>Adresse</Code> ou <Code>PLZ</Code>{" "}
        fonctionnent aussi. Les lignes de titre au-dessus de l’en-tête sont
        ignorées ; dans un classeur, la feuille dont l’en-tête est le plus
        clair est lue.
      </p>
      <H2 id="columns">Colonnes</H2>
      <ul className="text-muted-foreground list-disc space-y-1 pl-5">
        <li>
          <Code>name</Code> et <Code>address</Code> (ou <Code>street</Code>,{" "}
          <Code>house number</Code>, <Code>postcode</Code>, <Code>city</Code>)
          identifient chaque site.
        </li>
        <li>
          <Code>lat</Code> / <Code>lon</Code> sont facultatifs ; les valeurs
          vides sont géocodées.
        </li>
        <li>
          <Code>value</Code> est la valeur assurée en EUR. Facultatif : site
          web, type d’affaire, partenaire commercial, sous-portefeuille,
          groupe, limite et franchise.
        </li>
      </ul>
      <p className="text-muted-foreground">
        Avant l’import, un aperçu affiche chaque ligne : les doublons et les
        lignes sans localisation sont signalés, les adresses peuvent être
        vérifiées et des lignes écartées.
      </p>
      <H2 id="sample-datasets">Jeux de données d’exemple</H2>
      <p>
        Pas de portefeuille sous la main ? Le{" "}
        <A href={DATASET_REPO_URL}>jeu de données de concessions allemandes</A>{" "}
        contient de vraies concessions issues d’OpenStreetMap avec nom,
        adresse, coordonnées et site web. Les fichiers s’importent tels quels.
        Les petits jeux sont des sous-ensembles des plus grands, répartis
        proportionnellement entre les Länder ; 10 sites suffisent pour un
        premier essai.
      </p>
      <SampleDatasets lang="fr" />
      <p className="text-muted-foreground text-sm">
        Les fichiers ne contiennent aucune condition de contrat (valeur
        assurée, type d’affaire, limite, franchise) ; ces champs restent vides.
        Les entrées n’ont pas été vérifiées une à une et servent aux tests.
        Données © contributeurs OpenStreetMap, ODbL 1.0.
      </p>
      <H2 id="sample">Exemple minimal</H2>
      <CodeBlock code={SAMPLE_CSV} plain />
    </>
  ),
};

const DETECTION_MODEL: Localized<React.ReactNode> = {
  en: (
    <>
      <p>
        Vehicles are counted with a YOLOv26s model fine-tuned on aerial imagery
        (~36 MB, AGPL-3.0). It is not bundled with the source code. The app
        installs it on first launch; for a source build, place it at:
      </p>
      <CodeBlock code={MODEL_PATH} plain />
      <H2 id="without-the-model">Without the model</H2>
      <p className="text-muted-foreground">
        The app still runs, but vehicle counts come from an area-based
        heuristic and are flagged as such.
      </p>
    </>
  ),
  de: (
    <>
      <p>
        Fahrzeuge werden mit einem YOLOv26s-Modell gezählt, das auf Luftbilder
        feinabgestimmt ist (~36 MB, AGPL-3.0). Es ist nicht im Quellcode
        enthalten. Die App installiert es beim ersten Start; bei einem Build aus
        dem Quellcode legst du es hier ab:
      </p>
      <CodeBlock code={MODEL_PATH} plain />
      <H2 id="without-the-model">Ohne das Modell</H2>
      <p className="text-muted-foreground">
        Die App läuft trotzdem, die Fahrzeugzahlen stammen dann aber aus einer
        flächenbasierten Heuristik und sind entsprechend gekennzeichnet.
      </p>
    </>
  ),
  fr: (
    <>
      <p>
        Les véhicules sont comptés avec un modèle YOLOv26s affiné sur des
        images aériennes (~36 Mo, AGPL-3.0). Il n’est pas inclus dans le code
        source. L’application l’installe au premier lancement ; pour une
        compilation depuis les sources, placez-le ici :
      </p>
      <CodeBlock code={MODEL_PATH} plain />
      <H2 id="without-the-model">Sans le modèle</H2>
      <p className="text-muted-foreground">
        L’application fonctionne quand même, mais le nombre de véhicules
        provient alors d’une heuristique fondée sur la surface et est signalé
        comme tel.
      </p>
    </>
  ),
};

const HAIL_MODEL: Localized<React.ReactNode> = {
  en: (
    <>
      <p>
        The app assesses <strong>hail only</strong>. The hail score (0–100)
        comes from, in this order: a licensed provider you configure, the GDV
        hail zone of the postcode, or a weather-based proxy from Open-Meteo
        convective energy (CAPE).
      </p>
      <H2 id="expected-annual-loss">Expected annual loss</H2>
      <p>The expected annual loss per location is:</p>
      <CodeBlock code={EAL_FORMULA} plain />
      <p className="text-muted-foreground">
        <Code>N</Code> is the reviewed or detected vehicle count,{" "}
        <Code>λ_z</Code> the damaging hail events per year in zone{" "}
        <Code>z</Code>, and <Code>p</Code> / <Code>S</Code> the share and
        per-vehicle loss of small, medium and large events. Every result stores
        its inputs, sources, confidence and limitations, so each number can be
        traced in the location details.
      </p>
      <H2 id="hail-history">Hail history</H2>
      <p className="text-muted-foreground">
        The location details also show how often hail was observed at the
        nearest stations of the Deutscher Wetterdienst (open data). These are
        point observations and often end around 2011; they are context for the
        underwriter and never enter the score or the EAL.
      </p>
      <H2 id="limitations">Limitations</H2>
      <Callout>
        Results are <strong>screening estimates</strong>, not an engineering,
        legal or insurance decision. The default frequency and severity
        parameters are uncalibrated placeholders, and the CAPE proxy reflects a
        recent 92-day window rather than a hail climatology. See{" "}
        <A href={repoFile("docs/risk-model.md")}>the risk model</A> for sources
        and limitations.
      </Callout>
    </>
  ),
  de: (
    <>
      <p>
        Die App bewertet <strong>ausschließlich Hagel</strong>. Der Hagel-Score
        (0–100) stammt in dieser Reihenfolge aus: einem lizenzierten Anbieter,
        den du einrichtest, der GDV-Hagelzone der Postleitzahl oder einem
        wetterbasierten Proxy aus der konvektiven Energie (CAPE) von Open-Meteo.
      </p>
      <H2 id="expected-annual-loss">Erwarteter Jahresschaden</H2>
      <p>Der erwartete Jahresschaden (EAL) je Standort ist:</p>
      <CodeBlock code={EAL_FORMULA} plain />
      <p className="text-muted-foreground">
        <Code>N</Code> ist die geprüfte oder erkannte Fahrzeugzahl,{" "}
        <Code>λ_z</Code> die Zahl schadensrelevanter Hagelereignisse pro Jahr in
        Zone <Code>z</Code>, und <Code>p</Code> / <Code>S</Code> sind Anteil und
        Schaden je Fahrzeug bei kleinen, mittleren und großen Ereignissen. Jedes
        Ergebnis speichert Eingaben, Quellen, Konfidenz und Grenzen, sodass sich
        jede Zahl in den Standortdetails nachvollziehen lässt.
      </p>
      <H2 id="hail-history">Hagelhistorie</H2>
      <p className="text-muted-foreground">
        Die Standortdetails zeigen außerdem, wie oft an den nächstgelegenen
        Stationen des Deutschen Wetterdienstes (Open Data) Hagel beobachtet
        wurde. Das sind Punktbeobachtungen, die oft um 2011 enden; sie dienen
        dem Underwriter als Kontext und fließen nie in Score oder EAL ein.
      </p>
      <H2 id="limitations">Grenzen</H2>
      <Callout>
        Die Ergebnisse sind <strong>Screening-Schätzungen</strong>, keine
        technische, rechtliche oder versicherungstechnische Entscheidung. Die
        Standardwerte für Frequenz und Schadenhöhe sind unkalibrierte
        Platzhalter, und der CAPE-Proxy bildet ein aktuelles 92-Tage-Fenster ab,
        keine Hagelklimatologie. Quellen und Grenzen beschreibt das{" "}
        <A href={repoFile("docs/risk-model.md")}>Risikomodell</A> (auf
        Englisch).
      </Callout>
    </>
  ),
  fr: (
    <>
      <p>
        L’application évalue <strong>uniquement la grêle</strong>. Le score
        grêle (0–100) provient, dans cet ordre : d’un fournisseur sous licence
        que vous configurez, de la zone de grêle GDV du code postal, ou d’un
        proxy météorologique fondé sur l’énergie convective (CAPE) d’Open-Meteo.
      </p>
      <H2 id="expected-annual-loss">Perte annuelle attendue</H2>
      <p>La perte annuelle attendue (EAL) par site est :</p>
      <CodeBlock code={EAL_FORMULA} plain />
      <p className="text-muted-foreground">
        <Code>N</Code> est le nombre de véhicules vérifié ou détecté,{" "}
        <Code>λ_z</Code> le nombre d’épisodes de grêle dommageables par an dans
        la zone <Code>z</Code>, et <Code>p</Code> / <Code>S</Code> la part et le
        dommage par véhicule des épisodes faibles, moyens et forts. Chaque
        résultat conserve ses entrées, sources, indice de confiance et limites,
        afin que chaque valeur puisse être retracée dans le détail du site.
      </p>
      <H2 id="hail-history">Historique de grêle</H2>
      <p className="text-muted-foreground">
        Le détail du site indique aussi la fréquence de la grêle observée aux
        stations les plus proches du Deutscher Wetterdienst (données
        ouvertes). Ce sont des observations ponctuelles qui s’arrêtent souvent
        vers 2011 ; elles servent de contexte au souscripteur et n’entrent
        jamais dans le score ni dans l’EAL.
      </p>
      <H2 id="limitations">Limites</H2>
      <Callout>
        Les résultats sont des <strong>estimations de screening</strong>, et non
        une décision d’ingénierie, juridique ou d’assurance. Les paramètres de
        fréquence et de sévérité par défaut sont des valeurs provisoires non
        calibrées, et le proxy CAPE reflète une fenêtre récente de 92 jours
        plutôt qu’une climatologie de la grêle. Sources et limites :{" "}
        <A href={repoFile("docs/risk-model.md")}>modèle de risque</A> (en
        anglais).
      </Callout>
    </>
  ),
};

const AI_MEMO: Localized<React.ReactNode> = {
  en: (
    <>
      <p>
        Underwriting memos and the portfolio chat are optional. Choose a
        provider in the settings: a local runtime (Ollama, LM Studio,
        llama.cpp), OpenAI, Claude, or a custom endpoint.
      </p>
      <H2 id="dashboards">AI dashboards</H2>
      <p className="text-muted-foreground">
        Ask the chat for a dashboard (“Build a dashboard of all locations from
        zone 4”) and it is built from a fixed set of tiles (KPIs, bar and pie
        charts, tables) and saved as a tab next to the overview; follow-up
        requests change it. The figures are computed by the app from your
        portfolio, not by the model.
      </p>
      <H2 id="api-keys">API keys</H2>
      <p className="text-muted-foreground">
        API keys are encrypted with the operating system's keychain and never
        stored in plain text. Nothing is sent to an AI provider unless you
        configure one and request a memo.
      </p>
    </>
  ),
  de: (
    <>
      <p>
        Underwriting-Memos und der Portfolio-Chat sind optional. Wähle in den
        Einstellungen einen Anbieter: eine lokale Runtime (Ollama, LM Studio,
        llama.cpp), OpenAI, Claude oder einen eigenen Endpunkt.
      </p>
      <H2 id="dashboards">KI-Dashboards</H2>
      <p className="text-muted-foreground">
        Bitte den Chat um ein Dashboard („Baue mir ein Dashboard zu allen
        Standorten ab Zone 4“): Es entsteht aus festen Bausteinen (Kennzahlen,
        Balken- und Kreisdiagramme, Tabellen) und wird als Tab neben der
        Übersicht gespeichert; weitere Wünsche ändern es. Die Zahlen berechnet
        die App aus deinem Portfolio, nicht das Modell.
      </p>
      <H2 id="api-keys">API-Keys</H2>
      <p className="text-muted-foreground">
        API-Keys werden mit dem Schlüsselbund des Betriebssystems verschlüsselt
        und nie im Klartext gespeichert. An einen KI-Anbieter geht nichts,
        solange du keinen einrichtest und kein Memo anforderst.
      </p>
    </>
  ),
  fr: (
    <>
      <p>
        Les notes de souscription et le chat sur le portefeuille sont
        facultatifs. Choisissez un fournisseur dans les paramètres : un
        runtime local (Ollama, LM Studio, llama.cpp), OpenAI, Claude ou un
        point d’accès personnalisé.
      </p>
      <H2 id="dashboards">Tableaux de bord IA</H2>
      <p className="text-muted-foreground">
        Demandez un tableau de bord au chat (« Crée un tableau de bord de tous
        les sites à partir de la zone 4 ») : il est construit à partir de
        blocs fixes (indicateurs, diagrammes en barres et circulaires,
        tableaux) et enregistré comme onglet à côté de la vue d’ensemble ; les
        demandes suivantes le modifient. Les chiffres sont calculés par
        l’application à partir de votre portefeuille, pas par le modèle.
      </p>
      <H2 id="api-keys">Clés API</H2>
      <p className="text-muted-foreground">
        Les clés API sont chiffrées avec le trousseau du système d’exploitation
        et ne sont jamais stockées en clair. Rien n’est envoyé à un fournisseur
        d’IA tant que vous n’en configurez pas un et ne demandez pas de note.
      </p>
    </>
  ),
};

const PRIVACY: Localized<React.ReactNode> = {
  en: (
    <>
      <p>
        There are no accounts, no analytics and no telemetry; the maintainer
        receives none of your data. Portfolios, results and settings live in a
        local SQLite database. The app does not encrypt it, so keep full-disk
        encryption (FileVault, BitLocker) switched on. Settings → General →
        App &amp; support exports a diagnostics file without your portfolios
        and deletes all local data.
      </p>
      <H2 id="external-services">External services</H2>
      <p className="text-muted-foreground">
        To run an analysis, the app contacts third-party services for geocoding
        (Nominatim, Photon, state address services), map and cadastre data
        (Overpass, state ALKIS services, basemap.de), aerial imagery (Esri,
        state orthophoto services), weather (Open-Meteo) and hail history
        (Deutscher Wetterdienst). Most requests contain addresses or
        coordinates. The dealer directory comes from Overture Maps, the model
        and updates from GitHub. Do not import confidential
        customer data unless you may share it with these services. Details:{" "}
        <A href={repoFile("PRIVACY.md")}>privacy policy</A>.
      </p>
    </>
  ),
  de: (
    <>
      <p>
        Es gibt keine Konten, keine Analyse-Tools und keine Telemetrie; der
        Maintainer erhält keine deiner Daten. Portfolios, Ergebnisse und
        Einstellungen liegen in einer lokalen SQLite-Datenbank. Die App
        verschlüsselt sie nicht selbst, lass deshalb die
        Festplattenverschlüsselung (FileVault, BitLocker) eingeschaltet. Unter
        Einstellungen → Allgemein → App &amp; Support exportierst du eine
        Diagnose ohne deine Portfolios oder löschst alle lokalen Daten.
      </p>
      <H2 id="external-services">Externe Dienste</H2>
      <p className="text-muted-foreground">
        Für eine Analyse kontaktiert die App Drittanbieter für Geokodierung
        (Nominatim, Photon, Adressdienste der Länder), Karten- und
        Katasterdaten (Overpass, ALKIS-Dienste der Länder, basemap.de),
        Luftbilder (Esri, Orthofoto-Dienste der Länder), Wetter (Open-Meteo)
        und Hagelhistorie (Deutscher Wetterdienst). Die meisten Anfragen
        enthalten Adressen oder Koordinaten. Das Händlerverzeichnis stammt von
        Overture Maps, Modell und Updates von GitHub. Importiere keine
        vertraulichen Kundendaten, wenn du sie nicht mit diesen Diensten teilen
        darfst. Details:{" "}
        <A href={repoFile("PRIVACY.md")}>Datenschutzerklärung</A> (auf
        Englisch).
      </p>
    </>
  ),
  fr: (
    <>
      <p>
        Pas de compte, pas d’outil d’analyse d’audience, pas de télémétrie ; le
        mainteneur ne reçoit aucune de vos données. Les portefeuilles, résultats
        et paramètres sont stockés dans une base SQLite locale. L’application
        ne la chiffre pas elle-même : gardez le chiffrement du disque
        (FileVault, BitLocker) activé. Paramètres → Général → Application et
        support permet d’exporter un diagnostic sans vos portefeuilles et
        de supprimer toutes les données locales.
      </p>
      <H2 id="external-services">Services externes</H2>
      <p className="text-muted-foreground">
        Pour une analyse, l’application contacte des services tiers pour le
        géocodage (Nominatim, Photon, services d’adresses des Länder), les
        données cartographiques et cadastrales (Overpass, services ALKIS des
        Länder, basemap.de), les images aériennes (Esri, services d’orthophotos
        des Länder), la météo (Open-Meteo) et l’historique de grêle (Deutscher
        Wetterdienst). La plupart des requêtes contiennent des adresses ou des
        coordonnées. L’annuaire des concessions provient d’Overture Maps, le
        modèle et les mises à jour de GitHub. N’importez pas de données client confidentielles si
        vous n’êtes pas autorisé à les partager avec ces services. Détails :{" "}
        <A href={repoFile("PRIVACY.md")}>politique de confidentialité</A> (en
        anglais).
      </p>
    </>
  ),
};

const BUILD: Localized<React.ReactNode> = {
  en: (
    <>
      <p>
        Requires Node.js 22 or newer. Native modules are rebuilt against
        Electron's ABI.
      </p>
      <CodeBlock code={BUILD_COMMANDS("Installer for the current OS (dmg / nsis / AppImage)")} />
      <p className="text-muted-foreground">
        The vehicle detection model is not part of the repository; see{" "}
        <A href={sitePath("build", "detection-model")}>Vehicle detection</A>{" "}
        for where to place it.
      </p>
    </>
  ),
  de: (
    <>
      <p>
        Benötigt Node.js 22 oder neuer. Native Module werden gegen die ABI von
        Electron neu gebaut.
      </p>
      <CodeBlock code={BUILD_COMMANDS("Installer für das aktuelle Betriebssystem (dmg / nsis / AppImage)")} />
      <p className="text-muted-foreground">
        Das Modell zur Fahrzeugerkennung ist nicht im Repository; wo es
        hingehört, steht unter{" "}
        <A href={sitePath("build", "detection-model")}>Fahrzeugerkennung</A>.
      </p>
    </>
  ),
  fr: (
    <>
      <p>
        Nécessite Node.js 22 ou plus récent. Les modules natifs sont recompilés
        pour l’ABI d’Electron.
      </p>
      <CodeBlock code={BUILD_COMMANDS("Installateur pour le système actuel (dmg / nsis / AppImage)")} />
      <p className="text-muted-foreground">
        Le modèle de détection des véhicules ne fait pas partie du dépôt ; voir{" "}
        <A href={sitePath("build", "detection-model")}>Détection des véhicules</A>{" "}
        pour savoir où le placer.
      </p>
    </>
  ),
};

const FURTHER_READING: { path: string; text: Localized }[] = [
  {
    path: "ARCHITECTURE.md",
    text: {
      en: "Architecture and the 3-process model",
      de: "Architektur und das 3-Prozess-Modell",
      fr: "Architecture et modèle à 3 processus",
    },
  },
  {
    path: "docs/risk-model.md",
    text: {
      en: "Risk model, formulas and default parameters",
      de: "Risikomodell, Formeln und Standardparameter",
      fr: "Modèle de risque, formules et paramètres par défaut",
    },
  },
  {
    path: "docs/boundary-model.md",
    text: {
      en: "How lot boundaries are detected",
      de: "Wie Grundstücksgrenzen erkannt werden",
      fr: "Comment les limites de parcelle sont détectées",
    },
  },
  {
    path: "docs/cadastre-overlay.md",
    text: {
      en: "Parcel overlay and cadastre coverage per state",
      de: "Flurstücks-Overlay und Katasterabdeckung je Land",
      fr: "Calque des parcelles et couverture cadastrale par Land",
    },
  },
  {
    path: "docs/official-buildings.md",
    text: {
      en: "Official building footprints in the roof mask",
      de: "Amtliche Gebäudeumrisse in der Dachmaske",
      fr: "Emprises officielles des bâtiments dans le masque des toits",
    },
  },
  {
    path: "docs/ai-dashboards.md",
    text: {
      en: "AI dashboards from the chat (A2UI)",
      de: "KI-Dashboards aus dem Chat (A2UI)",
      fr: "Tableaux de bord IA depuis le chat (A2UI)",
    },
  },
  {
    path: "docs/local-overpass.md",
    text: {
      en: "Running your own Overpass server",
      de: "Einen eigenen Overpass-Server betreiben",
      fr: "Utiliser son propre serveur Overpass",
    },
  },
  {
    path: "docs/accessibility.md",
    text: {
      en: "Accessibility checks (WCAG 2.2 AA)",
      de: "Barrierefreiheitsprüfungen (WCAG 2.2 AA)",
      fr: "Contrôles d’accessibilité (WCAG 2.2 AA)",
    },
  },
  {
    path: "docs/imagery-sources.md",
    text: {
      en: "Aerial imagery sources and licences",
      de: "Luftbildquellen und Lizenzen",
      fr: "Sources d’images aériennes et licences",
    },
  },
  {
    path: "PRIVACY.md",
    text: {
      en: "Privacy policy and external services",
      de: "Datenschutzerklärung und externe Dienste",
      fr: "Politique de confidentialité et services externes",
    },
  },
  {
    path: "SECURITY.md",
    text: {
      en: "Reporting a vulnerability",
      de: "Sicherheitslücken melden",
      fr: "Signaler une vulnérabilité",
    },
  },
  {
    path: "CONTRIBUTING.md",
    text: {
      en: "Development workflow and conventions",
      de: "Entwicklungsablauf und Konventionen",
      fr: "Processus de développement et conventions",
    },
  },
  {
    path: "CHANGELOG.md",
    text: {
      en: "Version history",
      de: "Versionsverlauf",
      fr: "Historique des versions",
    },
  },
];

const FURTHER_READING_NOTE: Localized = {
  en: "",
  de: "Die Dokumente im Repository sind auf Englisch.",
  fr: "Les documents du dépôt sont en anglais.",
};

/** Body of each docs page per language; the layout adds title and pager. */
export const DOC_CONTENT: Record<DocSlug, Localized<React.ReactNode>> = {
  installation: INSTALLATION,
  "quick-start": {
    en: <Steps steps={QUICK_START.en} />,
    de: <Steps steps={QUICK_START.de} />,
    fr: <Steps steps={QUICK_START.fr} />,
  },
  "import-format": IMPORT_FORMAT,
  "detection-model": DETECTION_MODEL,
  "hail-model": HAIL_MODEL,
  "ai-memo": AI_MEMO,
  privacy: PRIVACY,
  build: BUILD,
  "further-reading": {
    en: <ReadingList lang="en" />,
    de: <ReadingList lang="de" />,
    fr: <ReadingList lang="fr" />,
  },
};

function Steps({
  steps,
}: {
  steps: { title: string; text: React.ReactNode }[];
}): React.JSX.Element {
  return (
    <ol className="space-y-6">
      {steps.map((step, i) => (
        <li key={step.title} className="flex gap-4">
          <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
            {i + 1}
          </span>
          <div>
            <h2 className="font-medium">{step.title}</h2>
            <p className="text-muted-foreground mt-1">{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ReadingList({ lang }: { lang: Lang }): React.JSX.Element {
  return (
    <>
      {FURTHER_READING_NOTE[lang] && (
        <p className="text-muted-foreground">{FURTHER_READING_NOTE[lang]}</p>
      )}
      <ul className="divide-y rounded-lg border">
        {FURTHER_READING.map((doc) => (
          <li key={doc.path}>
            <a
              href={repoFile(doc.path)}
              className="hover:bg-muted/60 flex items-center justify-between gap-4 px-4 py-3 text-sm transition-colors"
            >
              <span>
                <span className="font-medium">{doc.path}</span>
                <span className="text-muted-foreground"> — {doc.text[lang]}</span>
              </span>
              <ExternalLink className="text-muted-foreground size-4 shrink-0" />
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

const SAMPLE_DATASET_LABEL: Localized<(locations: number, states: number) => string> = {
  en: (n, s) => `${n} locations · ${s} federal states`,
  de: (n, s) => `${n} Standorte · ${s} Bundesländer`,
  fr: (n, s) => `${n} sites · ${s} Länder`,
};

function SampleDatasets({ lang }: { lang: Lang }): React.JSX.Element {
  return (
    <ul className="divide-y rounded-lg border">
      {SAMPLE_DATASETS.map((d) => (
        <li
          key={d.locations}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm"
        >
          <span className="font-medium">
            {SAMPLE_DATASET_LABEL[lang](d.locations, d.states)}
          </span>
          <span className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={d.csv} aria-label={`CSV, ${SAMPLE_DATASET_LABEL[lang](d.locations, d.states)}`}>
                <FileText /> CSV
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={d.xlsx} aria-label={`Excel, ${SAMPLE_DATASET_LABEL[lang](d.locations, d.states)}`}>
                <FileSpreadsheet /> Excel
              </a>
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Callout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Card className="border-chart-4/40 bg-chart-4/5">
      <CardContent className="flex gap-3 p-4 text-sm">
        <AlertTriangle className="text-chart-4 mt-0.5 size-5 shrink-0" />
        <p>{children}</p>
      </CardContent>
    </Card>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-4 pt-6">
      <h2 id={id} className="text-2xl font-semibold tracking-tight">
        {children}
      </h2>
      <Separator />
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <code className="bg-muted rounded px-1.5 py-0.5 text-[0.85em]">{children}</code>
  );
}

export function A({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <a href={href} className="text-primary underline-offset-4 hover:underline">
      {children}
    </a>
  );
}
