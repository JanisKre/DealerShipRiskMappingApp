import { AlertTriangle, ExternalLink } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { DownloadCards, UnsignedBuildNotes } from "@/components/download";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { DocSlug } from "@/lib/docs-pages";
import type { Lang, Localized } from "@/lib/i18n";
import { RELEASES_URL, repoFile, sitePath } from "@/lib/site";

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
          <A href={sitePath("quick-start", "import-format")}>import format</A>.
        </>
      ),
    },
    {
      title: "Review lot boundaries",
      text: "Check the detected parking areas on the map and correct polygons where needed. Edited boundaries are rescored immediately; use “Update car detection” to recount vehicles.",
    },
    {
      title: "Run the analysis",
      text: "The app counts vehicles, looks up the hail score and calculates the hail EAL for every location. A batch can be stopped after the active location; failures are kept per location.",
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
          <A href={sitePath("quick-start", "import-format")}>Importformat</A>.
        </>
      ),
    },
    {
      title: "Grundstücksgrenzen prüfen",
      text: "Prüfe die erkannten Parkflächen auf der Karte und korrigiere Polygone bei Bedarf. Bearbeitete Grenzen werden sofort neu bewertet; mit „Fahrzeugerkennung aktualisieren“ zählst du die Fahrzeuge neu.",
    },
    {
      title: "Analyse starten",
      text: "Die App zählt die Fahrzeuge, ermittelt den Hagel-Score und berechnet die Hagel-EAL für jeden Standort. Ein Lauf lässt sich nach dem aktiven Standort anhalten; Fehler bleiben je Standort erhalten.",
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
          <A href={sitePath("quick-start", "import-format")}>format d’import</A>.
        </>
      ),
    },
    {
      title: "Vérifier les limites de parcelle",
      text: "Vérifiez les zones de stationnement détectées sur la carte et corrigez les polygones si nécessaire. Les limites modifiées sont réévaluées immédiatement ; « Actualiser la détection des voitures » recompte les véhicules.",
    },
    {
      title: "Lancer l’analyse",
      text: "L’application compte les véhicules, récupère le score grêle et calcule l’EAL grêle de chaque site. Un lot peut être arrêté après le site en cours ; les erreurs sont conservées par site.",
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
        <Code>PLZ</Code> work too.
      </p>
      <H2 id="columns">Columns</H2>
      <ul className="text-muted-foreground list-disc space-y-1 pl-5">
        <li>
          <Code>name</Code> and <Code>address</Code> (or <Code>street</Code>,{" "}
          <Code>postcode</Code>, <Code>city</Code>) identify each location.
        </li>
        <li>
          <Code>lat</Code> / <Code>lon</Code> are optional; empty values are
          geocoded.
        </li>
        <li>
          <Code>value</Code> is the insured value in EUR. Optional: business
          type, sales partner, subportfolio, group, limit and deductible.
        </li>
      </ul>
      <H2 id="sample">Sample file</H2>
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
        funktionieren ebenfalls.
      </p>
      <H2 id="columns">Spalten</H2>
      <ul className="text-muted-foreground list-disc space-y-1 pl-5">
        <li>
          <Code>name</Code> und <Code>address</Code> (oder <Code>street</Code>,{" "}
          <Code>postcode</Code>, <Code>city</Code>) identifizieren jeden
          Standort.
        </li>
        <li>
          <Code>lat</Code> / <Code>lon</Code> sind optional; leere Werte werden
          geokodiert.
        </li>
        <li>
          <Code>value</Code> ist der Versicherungswert in EUR. Optional:
          Geschäftsart, Vertriebspartner, Teilportfolio, Gruppe, Limit und
          Selbstbehalt.
        </li>
      </ul>
      <H2 id="sample">Beispieldatei</H2>
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
        fonctionnent aussi.
      </p>
      <H2 id="columns">Colonnes</H2>
      <ul className="text-muted-foreground list-disc space-y-1 pl-5">
        <li>
          <Code>name</Code> et <Code>address</Code> (ou <Code>street</Code>,{" "}
          <Code>postcode</Code>, <Code>city</Code>) identifient chaque site.
        </li>
        <li>
          <Code>lat</Code> / <Code>lon</Code> sont facultatifs ; les valeurs
          vides sont géocodées.
        </li>
        <li>
          <Code>value</Code> est la valeur assurée en EUR. Facultatif : type
          d’affaire, partenaire commercial, sous-portefeuille, groupe, limite et
          franchise.
        </li>
      </ul>
      <H2 id="sample">Fichier d’exemple</H2>
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
        Underwriting memos, executive summaries and portfolio chat are
        optional. Choose a provider in the settings: a local runtime (Ollama,
        LM Studio, llama.cpp), OpenAI, Claude, or a custom endpoint.
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
        Underwriting-Memos, Executive Summaries und der Portfolio-Chat sind
        optional. Wähle in den Einstellungen einen Anbieter: eine lokale
        Runtime (Ollama, LM Studio, llama.cpp), OpenAI, Claude oder einen
        eigenen Endpunkt.
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
        Les notes de souscription, synthèses exécutives et le chat sur le
        portefeuille sont facultatifs. Choisissez un fournisseur dans les
        paramètres : un runtime local (Ollama, LM Studio, llama.cpp), OpenAI,
        Claude ou un point d’accès personnalisé.
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
        local SQLite database.
      </p>
      <H2 id="external-services">External services</H2>
      <p className="text-muted-foreground">
        To run an analysis, the app contacts third-party services for geocoding
        (Nominatim, Photon), map data (Overpass, Overture Maps), aerial imagery
        (Esri, state orthophoto services) and weather (Open-Meteo). These
        requests contain addresses or coordinates. Do not import confidential
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
        Einstellungen liegen in einer lokalen SQLite-Datenbank.
      </p>
      <H2 id="external-services">Externe Dienste</H2>
      <p className="text-muted-foreground">
        Für eine Analyse kontaktiert die App Drittanbieter für Geokodierung
        (Nominatim, Photon), Kartendaten (Overpass, Overture Maps), Luftbilder
        (Esri, Orthofoto-Dienste der Länder) und Wetter (Open-Meteo). Diese
        Anfragen enthalten Adressen oder Koordinaten. Importiere keine
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
        et paramètres sont stockés dans une base SQLite locale.
      </p>
      <H2 id="external-services">Services externes</H2>
      <p className="text-muted-foreground">
        Pour une analyse, l’application contacte des services tiers pour le
        géocodage (Nominatim, Photon), les données cartographiques (Overpass,
        Overture Maps), les images aériennes (Esri, services d’orthophotos des
        Länder) et la météo (Open-Meteo). Ces requêtes contiennent des adresses
        ou des coordonnées. N’importez pas de données client confidentielles si
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
