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
import { type Localized, useLang } from "@/lib/i18n";
import { DOWNLOADS, detectPlatform, REPO_URL, sitePath } from "@/lib/site";

const PIPELINE = [
  { icon: FileSpreadsheet, key: "import" },
  { icon: MapPinned, key: "boundaries" },
  { icon: Car, key: "vehicles" },
  { icon: CloudHail, key: "hail" },
  { icon: LayoutDashboard, key: "dashboard" },
  { icon: FileText, key: "memo" },
] as const;

type Step = (typeof PIPELINE)[number]["key"];

const T: Localized<{
  badges: [string, string, string];
  titleStart: string;
  titleEnd: string;
  intro: string;
  download: string;
  downloadFor: (os: string) => string;
  docs: string;
  otherPlatforms: string;
  window: string;
  steps: Record<Step, string>;
}> = {
  en: {
    badges: ["Open source · GPL-3.0", "macOS · Windows", "Work in progress"],
    titleStart: "Hail risk for every dealership lot,",
    titleEnd: "on your own machine.",
    intro:
      "A desktop app that screens car dealership portfolios for hail exposure — locally, without accounts or telemetry.",
    download: "Download",
    downloadFor: (os) => `Download for ${os}`,
    docs: "Read the docs",
    otherPlatforms: "Other platforms and install notes",
    window: "One portfolio, six steps",
    steps: {
      import: "Import portfolio",
      boundaries: "Detect lot boundaries",
      vehicles: "Count vehicles",
      hail: "Score hail & EAL",
      dashboard: "Map & dashboard",
      memo: "Memo & export",
    },
  },
  de: {
    badges: ["Open Source · GPL-3.0", "macOS · Windows", "In Entwicklung"],
    titleStart: "Hagelrisiko für jedes Autohaus-Gelände,",
    titleEnd: "auf deinem eigenen Rechner.",
    intro:
      "Eine Desktop-App, die Autohaus-Portfolios auf ihr Hagelrisiko prüft — lokal, ohne Konto und ohne Telemetrie.",
    download: "Download",
    downloadFor: (os) => `Download für ${os}`,
    docs: "Zur Doku",
    otherPlatforms: "Andere Plattformen und Installationshinweise",
    window: "Ein Portfolio, sechs Schritte",
    steps: {
      import: "Portfolio importieren",
      boundaries: "Grundstücksgrenzen erkennen",
      vehicles: "Fahrzeuge zählen",
      hail: "Hagel & EAL bewerten",
      dashboard: "Karte & Dashboard",
      memo: "Memo & Export",
    },
  },
  fr: {
    badges: ["Open source · GPL-3.0", "macOS · Windows", "En développement"],
    titleStart: "Le risque de grêle de chaque concession,",
    titleEnd: "sur votre propre machine.",
    intro:
      "Une application de bureau qui évalue l’exposition à la grêle des portefeuilles de concessions automobiles — en local, sans compte ni télémétrie.",
    download: "Télécharger",
    downloadFor: (os) => `Télécharger pour ${os}`,
    docs: "Lire la documentation",
    otherPlatforms: "Autres plateformes et notes d’installation",
    window: "Un portefeuille, six étapes",
    steps: {
      import: "Importer le portefeuille",
      boundaries: "Détecter les limites de parcelle",
      vehicles: "Compter les véhicules",
      hail: "Évaluer la grêle & l’EAL",
      dashboard: "Carte & tableau de bord",
      memo: "Note & export",
    },
  },
};

export function Hero(): React.JSX.Element {
  const t = T[useLang()];
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
              {t.badges[0]}
            </Badge>
            <Badge variant="outline" className="bg-background/60">
              {t.badges[1]}
            </Badge>
            <Badge variant="secondary">{t.badges[2]}</Badge>
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            {t.titleStart} <span className="text-primary">{t.titleEnd}</span>
          </h1>

          <p className="text-muted-foreground max-w-xl text-lg text-pretty">
            {t.intro}
          </p>

          <div className="flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <a href={primary ? primary.href : "#download"}>
                <Download />
                {primary
                  ? t.downloadFor(
                      primary.os === "macOS" ? `${primary.os} (${primary.label})` : primary.os,
                    )
                  : t.download}
              </a>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href={sitePath("home", "docs")}>
                <BookOpen />
                {t.docs}
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
              {t.otherPlatforms} <ArrowRight className="size-3.5" />
            </a>
          )}
        </div>

        <PipelineWindow title={t.window} steps={t.steps} />
      </div>
    </section>
  );
}

function PipelineWindow({
  title,
  steps,
}: {
  title: string;
  steps: Record<Step, string>;
}): React.JSX.Element {
  return (
    <div className="bg-card/80 rounded-xl border shadow-xl backdrop-blur">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <span className="text-muted-foreground ml-2 text-xs">{title}</span>
      </div>
      <ol className="relative p-4 sm:p-5">
        {PIPELINE.map((step, i) => (
          <li key={step.key} className="relative flex gap-4 pb-4 last:pb-0">
            {i < PIPELINE.length - 1 && (
              <span
                aria-hidden
                className="bg-border absolute top-9 bottom-0 left-[17px] w-px"
              />
            )}
            <span className="bg-accent text-accent-foreground relative flex size-9 shrink-0 items-center justify-center rounded-lg">
              <step.icon className="size-4" />
            </span>
            <div className="min-w-0 pt-2 text-sm font-medium">{steps[step.key]}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
