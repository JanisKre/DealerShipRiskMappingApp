import { GithubIcon } from "@/components/github-icon";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { type Page, REPO_URL, sitePath } from "@/lib/site";
import { cn } from "@/lib/utils";

export function SiteHeader({ page }: { page: Page }): React.JSX.Element {
  const nav = [
    { href: sitePath(page, "home", "#features"), label: "Features", active: false },
    { href: sitePath(page, "home", "#download"), label: "Download", active: false },
    { href: sitePath(page, "docs"), label: "Docs", active: page !== "home" },
  ];

  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
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
              key={item.label}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "hover:text-foreground transition-colors",
                item.active && "text-foreground font-medium",
              )}
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
