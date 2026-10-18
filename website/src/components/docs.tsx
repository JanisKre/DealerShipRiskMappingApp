import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { A, DOC_CONTENT } from "@/components/docs-content";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DOC_GROUPS, DOC_PAGES, type DocSlug } from "@/lib/docs-pages";
import { type Lang, type Localized, useLang } from "@/lib/i18n";
import { type Page, repoFile, sitePath } from "@/lib/site";
import { cn } from "@/lib/utils";

type DocsPage = Exclude<Page, "home">;

const T: Localized<{
  overview: string;
  nav: string;
  pager: string;
  previous: string;
  next: string;
  eyebrow: string;
  title: string;
  intro: [string, string, string];
}> = {
  en: {
    overview: "Overview",
    nav: "Documentation",
    pager: "Previous and next page",
    previous: "Previous",
    next: "Next",
    eyebrow: "Documentation",
    title: "User guide",
    intro: [
      "Everything you need for a first portfolio run. The full technical documentation lives in the ",
      "repository",
      ".",
    ],
  },
  de: {
    overview: "Übersicht",
    nav: "Dokumentation",
    pager: "Vorherige und nächste Seite",
    previous: "Zurück",
    next: "Weiter",
    eyebrow: "Dokumentation",
    title: "Benutzerhandbuch",
    intro: [
      "Alles für den ersten Portfolio-Durchlauf. Die vollständige technische Dokumentation liegt im ",
      "Repository",
      " (auf Englisch).",
    ],
  },
  fr: {
    overview: "Vue d’ensemble",
    nav: "Documentation",
    pager: "Page précédente et suivante",
    previous: "Précédent",
    next: "Suivant",
    eyebrow: "Documentation",
    title: "Guide d’utilisation",
    intro: [
      "Tout ce qu’il faut pour analyser un premier portefeuille. La documentation technique complète se trouve dans le ",
      "dépôt",
      " (en anglais).",
    ],
  },
};

/** Browser tab title for a docs page in the current language. */
export function docsTitle(page: DocsPage, lang: Lang): string {
  const current = DOC_PAGES.find((p) => p.slug === page);
  return `${current ? current.title[lang] : T[lang].nav} · Dealership Risk Mapping`;
}

export function Docs({ page }: { page: DocsPage }): React.JSX.Element {
  const lang = useLang();
  const current = DOC_PAGES.find((p) => p.slug === page);

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-[13rem_1fr] lg:gap-16">
      <aside className="hidden lg:block">
        <div className="sticky top-24">
          <DocsNav page={page} />
        </div>
      </aside>

      <details className="group bg-muted/40 rounded-lg border lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          {current ? current.title[lang] : T[lang].overview}
          <ChevronDown className="text-muted-foreground size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t px-4 py-4">
          <DocsNav page={page} />
        </div>
      </details>

      <article className="min-w-0 max-w-3xl">
        {current ? <DocArticle slug={current.slug} /> : <Overview />}
      </article>
    </div>
  );
}

function DocsNav({ page }: { page: DocsPage }): React.JSX.Element {
  const lang = useLang();
  const t = T[lang];

  return (
    <nav aria-label={t.nav} className="space-y-6 text-sm">
      <NavLink href={sitePath(page, "docs")} active={page === "docs"}>
        {t.overview}
      </NavLink>
      {DOC_GROUPS.map((group) => (
        <div key={group.id}>
          <p className="mb-2 font-semibold">{group.label[lang]}</p>
          <ul className="space-y-0.5 border-l">
            {group.pages.map((p) => (
              <li key={p.slug}>
                <NavLink href={sitePath(page, p.slug)} active={page === p.slug} indent>
                  {p.title[lang]}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NavLink({
  href,
  active,
  indent = false,
  children,
}: {
  href: string;
  active: boolean;
  indent?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-muted-foreground hover:text-foreground block py-1 transition-colors",
        indent && "-ml-px border-l border-transparent pl-4 hover:border-current",
        active && "text-foreground font-medium",
        active && indent && "border-primary hover:border-primary",
      )}
    >
      {children}
    </a>
  );
}

function Overview(): React.JSX.Element {
  const lang = useLang();
  const t = T[lang];

  return (
    <>
      <PageHeading eyebrow={t.eyebrow} title={t.title}>
        <p className="text-muted-foreground mt-4 text-lg text-pretty">
          {t.intro[0]}
          <A href={repoFile("README.md")}>{t.intro[1]}</A>
          {t.intro[2]}
        </p>
      </PageHeading>
      <div className="space-y-12">
        {DOC_GROUPS.map((group) => (
          <section key={group.id}>
            <h2 className="mb-4 text-xl font-semibold tracking-tight">
              {group.label[lang]}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {group.pages.map((p) => (
                <a key={p.slug} href={sitePath("docs", p.slug)} className="group">
                  <Card className="h-full group-hover:shadow-md">
                    <CardHeader className="gap-2">
                      <CardTitle className="flex items-center justify-between text-base">
                        {p.title[lang]}
                        <ArrowRight className="text-muted-foreground group-hover:text-foreground size-4 transition-transform group-hover:translate-x-0.5" />
                      </CardTitle>
                      <CardDescription className="leading-relaxed">
                        {p.blurb[lang]}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function PageHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mb-10 border-b pb-8">
      <p className="text-primary mb-2 text-sm font-semibold tracking-wide uppercase">
        {eyebrow}
      </p>
      <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
        {title}
      </h1>
      {children}
    </div>
  );
}

function DocArticle({ slug }: { slug: DocSlug }): React.JSX.Element {
  const lang = useLang();
  const t = T[lang];
  const index = DOC_PAGES.findIndex((p) => p.slug === slug);
  const page = DOC_PAGES[index];
  const prev = DOC_PAGES[index - 1];
  const next = DOC_PAGES[index + 1];

  return (
    <>
      <PageHeading eyebrow={page.group[lang]} title={page.title[lang]} />
      <div className="space-y-4 leading-relaxed">
        {DOC_CONTENT[slug][lang]}
      </div>

      <nav
        aria-label={t.pager}
        className="mt-16 grid gap-4 border-t pt-6 text-sm sm:grid-cols-2"
      >
        {prev ? (
          <a href={sitePath(slug, prev.slug)} className="group">
            <span className="text-muted-foreground flex items-center gap-1">
              <ArrowLeft className="size-3.5" /> {t.previous}
            </span>
            <span className="group-hover:text-primary font-medium">{prev.title[lang]}</span>
          </a>
        ) : (
          <span />
        )}
        {next && (
          <a href={sitePath(slug, next.slug)} className="group sm:text-right">
            <span className="text-muted-foreground flex items-center gap-1 sm:justify-end">
              {t.next} <ArrowRight className="size-3.5" />
            </span>
            <span className="group-hover:text-primary font-medium">{next.title[lang]}</span>
          </a>
        )}
      </nav>
    </>
  );
}
