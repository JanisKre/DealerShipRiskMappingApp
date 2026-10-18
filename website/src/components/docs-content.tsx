import { AlertTriangle, ExternalLink } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { DownloadCards, UnsignedBuildNotes } from "@/components/download";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { DocSlug } from "@/lib/docs-pages";
import { RELEASES_URL, repoFile, sitePath } from "@/lib/site";

const QUICK_START = [
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
];

const SAMPLE_CSV = `name,address,lat,lon,value
Autohaus Beispiel Nord,"Musterstraße 1, 20095 Hamburg",,,1800000
Autohaus Beispiel Süd,"Beispielweg 5, 80331 München",48.137,11.575,2500000`;

const FURTHER_READING = [
  { path: "ARCHITECTURE.md", text: "Architecture and the 3-process model" },
  { path: "docs/risk-model.md", text: "Risk model, formulas and default parameters" },
  { path: "docs/boundary-model.md", text: "How lot boundaries are detected" },
  { path: "docs/imagery-sources.md", text: "Aerial imagery sources and licences" },
  { path: "PRIVACY.md", text: "Privacy policy and external services" },
  { path: "SECURITY.md", text: "Reporting a vulnerability" },
  { path: "CONTRIBUTING.md", text: "Development workflow and conventions" },
  { path: "CHANGELOG.md", text: "Version history" },
];

function Installation(): React.JSX.Element {
  return (
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
  );
}

function QuickStart(): React.JSX.Element {
  return (
    <ol className="space-y-6">
      {QUICK_START.map((step, i) => (
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

function ImportFormat(): React.JSX.Element {
  return (
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
  );
}

function DetectionModel(): React.JSX.Element {
  return (
    <>
      <p>
        Vehicles are counted with a YOLOv26s model fine-tuned on aerial imagery
        (~36 MB, AGPL-3.0). It is not bundled with the source code. The app
        installs it on first launch; for a source build, place it at:
      </p>
      <CodeBlock
        code="desktop-app/resources/models/yolov26s_aerial_vehicles.onnx"
        plain
      />
      <H2 id="without-the-model">Without the model</H2>
      <p className="text-muted-foreground">
        The app still runs, but vehicle counts come from an area-based
        heuristic and are flagged as such.
      </p>
    </>
  );
}

function HailModel(): React.JSX.Element {
  return (
    <>
      <p>
        The app assesses <strong>hail only</strong>. The hail score (0–100)
        comes from, in this order: a licensed provider you configure, the GDV
        hail zone of the postcode, or a weather-based proxy from Open-Meteo
        convective energy (CAPE).
      </p>
      <H2 id="expected-annual-loss">Expected annual loss</H2>
      <p>The expected annual loss per location is:</p>
      <CodeBlock code="EAL = N × λ_z × (p_S·S_S + p_M·S_M + p_L·S_L)" plain />
      <p className="text-muted-foreground">
        <Code>N</Code> is the reviewed or detected vehicle count,{" "}
        <Code>λ_z</Code> the damaging hail events per year in zone{" "}
        <Code>z</Code>, and <Code>p</Code> / <Code>S</Code> the share and
        per-vehicle loss of small, medium and large events. Every result stores
        its inputs, sources, confidence and limitations, so each number can be
        traced in the location details.
      </p>
      <H2 id="limitations">Limitations</H2>
      <Card className="border-chart-4/40 bg-chart-4/5">
        <CardContent className="flex gap-3 p-4 text-sm">
          <AlertTriangle className="text-chart-4 mt-0.5 size-5 shrink-0" />
          <p>
            Results are <strong>screening estimates</strong>, not an
            engineering, legal or insurance decision. The default frequency and
            severity parameters are uncalibrated placeholders, and the CAPE proxy
            reflects a recent 92-day window rather than a hail climatology. See{" "}
            <A href={repoFile("docs/risk-model.md")}>the risk model</A> for
            sources and limitations.
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function AiMemo(): React.JSX.Element {
  return (
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
  );
}

function Privacy(): React.JSX.Element {
  return (
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
  );
}

function Build(): React.JSX.Element {
  return (
    <>
      <p>
        Requires Node.js 22 or newer. Native modules are rebuilt against
        Electron's ABI.
      </p>
      <CodeBlock
        code={`git clone https://github.com/JanisKre/DealerShipRiskMappingApp.git
cd DealerShipRiskMappingApp/desktop-app
npm ci
npm run rebuild
npm run dev
# Installer for the current OS (dmg / nsis / AppImage)
npm run dist`}
      />
      <p className="text-muted-foreground">
        The vehicle detection model is not part of the repository; see{" "}
        <A href={sitePath("build", "detection-model")}>Vehicle detection</A>{" "}
        for where to place it.
      </p>
    </>
  );
}

function FurtherReading(): React.JSX.Element {
  return (
    <ul className="divide-y rounded-lg border">
      {FURTHER_READING.map((doc) => (
        <li key={doc.path}>
          <a
            href={repoFile(doc.path)}
            className="hover:bg-muted/60 flex items-center justify-between gap-4 px-4 py-3 text-sm transition-colors"
          >
            <span>
              <span className="font-medium">{doc.path}</span>
              <span className="text-muted-foreground"> — {doc.text}</span>
            </span>
            <ExternalLink className="text-muted-foreground size-4 shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export const DOC_CONTENT: Record<DocSlug, () => React.JSX.Element> = {
  installation: Installation,
  "quick-start": QuickStart,
  "import-format": ImportFormat,
  "detection-model": DetectionModel,
  "hail-model": HailModel,
  "ai-memo": AiMemo,
  privacy: Privacy,
  build: Build,
  "further-reading": FurtherReading,
};

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
