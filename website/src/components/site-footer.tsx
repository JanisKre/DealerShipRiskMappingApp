import { Logo } from "@/components/logo";
import { RELEASES_URL, REPO_URL, repoFile } from "@/lib/site";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "#features", label: "Features" },
      { href: "#download", label: "Download" },
      { href: RELEASES_URL, label: "Releases" },
      { href: repoFile("CHANGELOG.md"), label: "Changelog" },
    ],
  },
  {
    title: "Docs",
    links: [
      { href: "#quick-start", label: "Quick start" },
      { href: repoFile("ARCHITECTURE.md"), label: "Architecture" },
      { href: repoFile("docs/risk-model.md"), label: "Risk model" },
      { href: repoFile("CONTRIBUTING.md"), label: "Contributing" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: REPO_URL, label: "GitHub" },
      { href: `${REPO_URL}/issues`, label: "Issues" },
      { href: repoFile("PRIVACY.md"), label: "Privacy" },
      { href: repoFile("SECURITY.md"), label: "Security" },
    ],
  },
];

export function SiteFooter(): React.JSX.Element {
  return (
    <footer>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            <Logo className="size-7" />
            Dealership Risk Mapping
          </div>
          <p className="text-muted-foreground max-w-xs text-sm">
            Local hail-risk screening for car dealership portfolios. Free and
            open source under GPL-3.0-or-later.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h3 className="mb-3 text-sm font-semibold">{col.title}</h3>
            <ul className="text-muted-foreground space-y-2 text-sm">
              {col.links.map((link) => (
                <li key={link.label}>
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
          <span>
            Map data © OpenStreetMap contributors · Screening estimates only
          </span>
        </div>
      </div>
    </footer>
  );
}
