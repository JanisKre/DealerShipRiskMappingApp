import { AlertTriangle, ExternalLink } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { Section } from "@/components/section";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { repoFile } from "@/lib/site";

const TOC = [
  { id: "quick-start", label: "Quick start" },
  { id: "import-format", label: "Import format" },
  { id: "detection-model", label: "Detection model" },
  { id: "hail-model", label: "How hail risk is scored" },
  { id: "ai-memo", label: "AI memo" },
  { id: "privacy", label: "Privacy & data" },
  { id: "build", label: "Build from source" },
  { id: "further-reading", label: "Further reading" },
];

const QUICK_START = [
  {
    title: "Install",
    text: (
      <>
        Download the installer for your platform from the{" "}
        <A href="#download">download section</A> and follow the notes for
        unsigned builds.
      </>
    ),
  },
  {
    title: "Install the detection model",
    text: "On first launch a wizard offers to download the vehicle detection model. You can skip it; the app then uses an area-based estimate.",
  },
  {
    title: "Import your portfolio",
    text: "Load a CSV, TSV or Excel file, or add single locations by address. Addresses without coordinates are geocoded.",
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

export function Docs(): React.JSX.Element {
  return (
    <Section
      id="docs"
      eyebrow="Documentation"
      title="Getting started"
      description="Everything you need for a first portfolio run. The full technical documentation lives in the repository."
    >
      <div className="grid gap-10 lg:grid-cols-[13rem_1fr] lg:gap-16">
        <nav aria-label="Documentation" className="hidden lg:block">
          <ul className="sticky top-24 space-y-1 border-l text-sm">
            {TOC.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="text-muted-foreground hover:text-foreground hover:border-foreground -ml-px block border-l border-transparent py-1 pl-4 transition-colors"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 max-w-3xl space-y-14">
          <DocSection id="quick-start" title="Quick start">
            <ol className="space-y-5">
              {QUICK_START.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                    {i + 1}
                  </span>
                  <div>
                    <h4 className="font-medium">{step.title}</h4>
                    <p className="text-muted-foreground mt-1">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </DocSection>

          <DocSection id="import-format" title="Import format">
            <p>
              CSV, TSV (comma, semicolon or tab, detected automatically) and
              XLSX files are supported. Column names are matched
              case-insensitively, and German headers such as{" "}
              <Code>Autohaus</Code>, <Code>Adresse</Code> or <Code>PLZ</Code>{" "}
              work too.
            </p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5">
              <li>
                <Code>name</Code> and <Code>address</Code> (or{" "}
                <Code>street</Code>, <Code>postcode</Code>, <Code>city</Code>)
                identify each location.
              </li>
              <li>
                <Code>lat</Code> / <Code>lon</Code> are optional; empty values
                are geocoded.
              </li>
              <li>
                <Code>value</Code> is the insured value in EUR. Optional:
                business type, sales partner, subportfolio, group, limit and
                deductible.
              </li>
            </ul>
            <CodeBlock code={SAMPLE_CSV} plain />
          </DocSection>

          <DocSection id="detection-model" title="Detection model">
            <p>
              Vehicles are counted with a YOLOv26s model fine-tuned on aerial
              imagery (~36 MB, AGPL-3.0). It is not bundled with the source
              code. The app installs it on first launch; for a source build,
              place it at:
            </p>
            <CodeBlock
              code="desktop-app/resources/models/yolov26s_aerial_vehicles.onnx"
              plain
            />
            <p className="text-muted-foreground">
              Without the model the app still runs, but vehicle counts come from
              an area-based heuristic and are flagged as such.
            </p>
          </DocSection>

          <DocSection id="hail-model" title="How hail risk is scored">
            <p>
              The app assesses <strong>hail only</strong>. The hail score (0–100)
              comes from, in this order: a licensed provider you configure, the
              GDV hail zone of the postcode, or a weather-based proxy from
              Open-Meteo convective energy (CAPE).
            </p>
            <p>The expected annual loss per location is:</p>
            <CodeBlock
              code="EAL = N × λ_z × (p_S·S_S + p_M·S_M + p_L·S_L)"
              plain
            />
            <p className="text-muted-foreground">
              <Code>N</Code> is the reviewed or detected vehicle count,{" "}
              <Code>λ_z</Code> the damaging hail events per year in zone{" "}
              <Code>z</Code>, and <Code>p</Code> / <Code>S</Code> the share and
              per-vehicle loss of small, medium and large events. Every result
              stores its inputs, sources, confidence and limitations, so each
              number can be traced in the location details.
            </p>
            <Card className="border-chart-4/40 bg-chart-4/5">
              <CardContent className="flex gap-3 p-4 text-sm">
                <AlertTriangle className="text-chart-4 mt-0.5 size-5 shrink-0" />
                <p>
                  Results are <strong>screening estimates</strong>, not an
                  engineering, legal or insurance decision. The default
                  frequency and severity parameters are uncalibrated
                  placeholders, and the CAPE proxy reflects a recent 92-day
                  window rather than a hail climatology. See{" "}
                  <A href={repoFile("docs/risk-model.md")}>the risk model</A>{" "}
                  for sources and limitations.
                </p>
              </CardContent>
            </Card>
          </DocSection>

          <DocSection id="ai-memo" title="AI memo">
            <p>
              Underwriting memos, executive summaries and portfolio chat are
              optional. Choose a provider in the settings: a local runtime
              (Ollama, LM Studio, llama.cpp), OpenAI, Claude, or a custom
              endpoint. API keys are encrypted with the operating system's
              keychain and never stored in plain text. Nothing is sent to an AI
              provider unless you configure one and request a memo.
            </p>
          </DocSection>

          <DocSection id="privacy" title="Privacy & data">
            <p>
              There are no accounts, no analytics and no telemetry; the
              maintainer receives none of your data. Portfolios, results and
              settings live in a local SQLite database.
            </p>
            <p className="text-muted-foreground">
              To run an analysis, the app contacts third-party services for
              geocoding (Nominatim, Photon), map data (Overpass, Overture Maps),
              aerial imagery (Esri, state orthophoto services) and weather
              (Open-Meteo). These requests contain addresses or coordinates.
              Do not import confidential customer data unless you may share it
              with these services. Details: <A href={repoFile("PRIVACY.md")}>privacy policy</A>.
            </p>
          </DocSection>

          <DocSection id="build" title="Build from source">
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
          </DocSection>

          <DocSection id="further-reading" title="Further reading">
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
          </DocSection>
        </div>
      </div>
    </Section>
  );
}

function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section id={id} className="space-y-4 leading-relaxed">
      <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      <Separator />
      {children}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <code className="bg-muted rounded px-1.5 py-0.5 text-[0.85em]">
      {children}
    </code>
  );
}

function A({
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
