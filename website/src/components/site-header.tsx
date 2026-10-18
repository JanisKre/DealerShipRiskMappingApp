import { GithubIcon } from "@/components/github-icon";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { REPO_URL } from "@/lib/site";

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#download", label: "Download" },
  { href: "#docs", label: "Docs" },
];

export function SiteHeader(): React.JSX.Element {
  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2 font-semibold">
          <Logo className="size-7" />
          <span className="hidden sm:inline">Dealership Risk Mapping</span>
        </a>
        <nav className="text-muted-foreground flex items-center gap-4 text-sm sm:gap-6">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="hover:text-foreground transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" asChild>
            <a href={REPO_URL} aria-label="GitHub repository">
              <GithubIcon className="size-4" />
            </a>
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
