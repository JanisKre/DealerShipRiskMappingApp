import { Logo } from "@/components/logo";
import { type Localized, useLang } from "@/lib/i18n";
import { type Page, RELEASES_URL, REPO_URL, repoFile, sitePath } from "@/lib/site";

const T: Localized<{
  tagline: string;
  product: string;
  docs: string;
  project: string;
  features: string;
  download: string;
  releases: string;
  changelog: string;
  quickStart: string;
  architecture: string;
  riskModel: string;
  contributing: string;
  issues: string;
  privacy: string;
  security: string;
  attribution: string;
}> = {
  en: {
    tagline:
      "Local hail-risk screening for car dealership portfolios. Free and open source under GPL-3.0-or-later.",
    product: "Product",
    docs: "Docs",
    project: "Project",
    features: "Features",
    download: "Download",
    releases: "Releases",
    changelog: "Changelog",
    quickStart: "Quick start",
    architecture: "Architecture",
    riskModel: "Risk model",
    contributing: "Contributing",
    issues: "Issues",
    privacy: "Privacy",
    security: "Security",
    attribution: "Map data © OpenStreetMap contributors · Screening estimates only",
  },
  de: {
    tagline:
      "Lokales Hagelrisiko-Screening für Autohaus-Portfolios. Kostenlos und Open Source unter GPL-3.0-or-later.",
    product: "Produkt",
    docs: "Doku",
    project: "Projekt",
    features: "Funktionen",
    download: "Download",
    releases: "Releases",
    changelog: "Changelog",
    quickStart: "Schnellstart",
    architecture: "Architektur",
    riskModel: "Risikomodell",
    contributing: "Mitwirken",
    issues: "Issues",
    privacy: "Datenschutz",
    security: "Sicherheit",
    attribution: "Kartendaten © OpenStreetMap-Mitwirkende · Nur Screening-Schätzungen",
  },
  fr: {
    tagline:
      "Screening local du risque de grêle pour les portefeuilles de concessions automobiles. Libre et open source sous GPL-3.0-or-later.",
    product: "Produit",
    docs: "Docs",
    project: "Projet",
    features: "Fonctions",
    download: "Télécharger",
    releases: "Versions",
    changelog: "Journal des modifications",
    quickStart: "Démarrage rapide",
    architecture: "Architecture",
    riskModel: "Modèle de risque",
    contributing: "Contribuer",
    issues: "Tickets",
    privacy: "Confidentialité",
    security: "Sécurité",
    attribution:
      "Données cartographiques © contributeurs OpenStreetMap · Estimations de screening uniquement",
  },
};

export function SiteFooter({ page }: { page: Page }): React.JSX.Element {
  const t = T[useLang()];
  const columns = [
    {
      title: t.product,
      links: [
        { href: sitePath(page, "home", "#features"), label: t.features },
        { href: sitePath(page, "home", "#download"), label: t.download },
        { href: RELEASES_URL, label: t.releases },
        { href: repoFile("CHANGELOG.md"), label: t.changelog },
      ],
    },
    {
      title: t.docs,
      links: [
        { href: sitePath(page, "quick-start"), label: t.quickStart },
        { href: repoFile("ARCHITECTURE.md"), label: t.architecture },
        { href: repoFile("docs/risk-model.md"), label: t.riskModel },
        { href: repoFile("CONTRIBUTING.md"), label: t.contributing },
      ],
    },
    {
      title: t.project,
      links: [
        { href: REPO_URL, label: "GitHub" },
        { href: `${REPO_URL}/issues`, label: t.issues },
        { href: repoFile("PRIVACY.md"), label: t.privacy },
        { href: repoFile("SECURITY.md"), label: t.security },
      ],
    },
  ];

  return (
    <footer>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            <Logo className="size-7" />
            Dealership Risk Mapping
          </div>
          <p className="text-muted-foreground max-w-xs text-sm">{t.tagline}</p>
        </div>
        {columns.map((col) => (
          <div key={col.title}>
            <h3 className="mb-3 text-sm font-semibold">{col.title}</h3>
            <ul className="text-muted-foreground space-y-2 text-sm">
              {col.links.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="hover:text-foreground transition-colors">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-xs sm:px-6">
          <span>
            © {new Date().getFullYear()}{" "}
            <a href="https://github.com/JanisKre" className="hover:text-foreground">
              Janis Kretschmann
            </a>
          </span>
          <span>{t.attribution}</span>
        </div>
      </div>
    </footer>
  );
}
