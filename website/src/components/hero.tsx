import {
  ArrowRight,
  BookOpen,
  Car,
  CloudHail,
  Download,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  MapPinned,
} from "lucide-react";
import { GithubIcon } from "@/components/github-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DOWNLOADS, detectPlatform, REPO_URL } from "@/lib/site";

const PIPELINE = [
  {
    icon: FileSpreadsheet,
    title: "Import portfolio",
    detail: "CSV or single entry, geocoded via Nominatim",
  },
  {
    icon: MapPinned,
    title: "Detect lot boundaries",
    detail: "ALKIS → OSM → building footprints, with confidence",
  },
  {
    icon: Car,
    title: "Count vehicles",
    detail: "YOLOv26 on aerial imagery, reviewable per site",
  },
  {
    icon: CloudHail,
    title: "Score hail & EAL",
    detail: "Hail zone, provider or CAPE proxy → expected annual loss",
  },
  {
    icon: LayoutDashboard,
    title: "Map & dashboard",
    detail: "KPIs, charts, filters, portfolio comparison",
  },
  {
    icon: FileText,
    title: "Memo & export",
    detail: "AI underwriting memo, PDF, Excel, CSV",
  },
];

export function Hero(): React.JSX.Element {
  const platform = detectPlatform(navigator.userAgent);
  const primary = DOWNLOADS.find((d) => d.platform === platform);

  return (
    <section id="top" className="relative overflow-hidden border-b">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)] opacity-60"
      />
      <div
        aria-hidden
        className="bg-primary/20 pointer-events-none absolute -top-40 left-1/2 h-80 w-[48rem] max-w-full -translate-x-1/2 rounded-full blur-3xl"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[1.25fr_1fr]">
        <div className="flex flex-col items-start gap-6">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="bg-background/60">
              Open source · GPL-3.0
            </Badge>
            <Badge variant="outline" className="bg-background/60">
              macOS · Windows
            </Badge>
            <Badge variant="secondary">Work in progress</Badge>
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Hail risk for every dealership lot,{" "}
            <span className="text-primary">on your own machine.</span>
          </h1>

          <p className="text-muted-foreground max-w-xl text-lg text-pretty">
            Dealership Risk Mapping is a desktop app that screens car dealership
            portfolios for hail exposure. It finds each lot, counts the vehicles
            on aerial imagery and estimates the expected annual hail loss —
            locally, without accounts or telemetry.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <a href={primary ? primary.href : "#download"}>
                <Download />
                {primary
                  ? `Download for ${primary.os}${primary.os === "macOS" ? ` (${primary.label})` : ""}`
                  : "Download"}
              </a>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#docs">
                <BookOpen />
                Read the docs
              </a>
            </Button>
            <Button size="lg" variant="ghost" asChild>
              <a href={REPO_URL}>
                <GithubIcon className="size-4" />
                GitHub
              </a>
            </Button>
          </div>

          {primary && (
            <a
              href="#download"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
            >
              Other platforms and install notes <ArrowRight className="size-3.5" />
            </a>
          )}
        </div>

        <PipelineWindow />
      </div>
    </section>
  );
}

function PipelineWindow(): React.JSX.Element {
  return (
    <div className="bg-card/80 rounded-xl border shadow-xl backdrop-blur">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <span className="text-muted-foreground ml-2 text-xs">
          One portfolio, six steps
        </span>
      </div>
      <ol className="relative p-4 sm:p-5">
        {PIPELINE.map((step, i) => (
          <li key={step.title} className="relative flex gap-4 pb-5 last:pb-0">
            {i < PIPELINE.length - 1 && (
              <span
                aria-hidden
                className="bg-border absolute top-9 bottom-0 left-[17px] w-px"
              />
            )}
            <span className="bg-accent text-accent-foreground relative flex size-9 shrink-0 items-center justify-center rounded-lg">
              <step.icon className="size-4" />
            </span>
            <div className="min-w-0 pt-0.5">
              <div className="text-sm font-medium">{step.title}</div>
              <div className="text-muted-foreground text-sm">{step.detail}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
