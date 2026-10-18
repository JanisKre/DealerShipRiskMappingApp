import { GithubIcon } from "@/components/github-icon";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { type Localized, useLang } from "@/lib/i18n";
import { type Page, REPO_URL, sitePath } from "@/lib/site";
import { cn } from "@/lib/utils";

const T: Localized<{ features: string; download: string; docs: string; repo: string }> = {
  en: { features: "Features", download: "Download", docs: "Docs", repo: "GitHub repository" },
  de: { features: "Funktionen", download: "Download", docs: "Doku", repo: "GitHub-Repository" },
  fr: { features: "Fonctions", download: "Télécharger", docs: "Docs", repo: "Dépôt GitHub" },
};

export function SiteHeader({ page }: { page: Page }): React.JSX.Element {
  const t = T[useLang()];
  const nav = [
    // Features is the first item to go when the header gets tight on phones.
    { href: sitePath(page, "home", "#features"), label: t.features, active: false, wide: true },
    { href: sitePath(page, "home", "#download"), label: t.download, active: false, wide: false },
    { href: sitePath(page, "docs"), label: t.docs, active: page !== "home", wide: false },
  ];

  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <a
          href={sitePath(page, "home")}
          className="flex items-center gap-2 font-semibold"
        >
          <Logo className="size-7" />
          <span className="hidden sm:inline">Dealership Risk Mapping</span>
        </a>
        <nav className="text-muted-foreground flex items-center gap-4 text-sm sm:gap-6">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "hover:text-foreground transition-colors",
                item.wide && "hidden sm:inline",
                item.active && "text-foreground font-medium",
              )}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center sm:gap-1">
          <LanguageSwitcher />
          <Button variant="ghost" size="icon" asChild>
            <a href={REPO_URL} aria-label={t.repo}>
              <GithubIcon className="size-4" />
            </a>
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
