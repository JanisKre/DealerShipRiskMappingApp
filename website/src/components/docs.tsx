import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { A, DOC_CONTENT } from "@/components/docs-content";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DOC_GROUPS, DOC_PAGES, type DocSlug } from "@/lib/docs-pages";
import { type Page, repoFile, sitePath } from "@/lib/site";
import { cn } from "@/lib/utils";

type DocsPage = Exclude<Page, "home">;

export function Docs({ page }: { page: DocsPage }): React.JSX.Element {
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
          {current ? current.title : "Overview"}
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
  return (
    <nav aria-label="Documentation" className="space-y-6 text-sm">
      <NavLink href={sitePath(page, "docs")} active={page === "docs"}>
        Overview
      </NavLink>
      {DOC_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-2 font-semibold">{group.label}</p>
          <ul className="space-y-0.5 border-l">
            {group.pages.map((p) => (
              <li key={p.slug}>
                <NavLink href={sitePath(page, p.slug)} active={page === p.slug} indent>
                  {p.title}
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
  return (
    <>
      <PageHeading eyebrow="Documentation" title="User guide">
        <p className="text-muted-foreground mt-4 text-lg text-pretty">
          Everything you need for a first portfolio run. The full technical
          documentation lives in the{" "}
          <A href={repoFile("README.md")}>repository</A>.
        </p>
      </PageHeading>
      <div className="space-y-12">
        {DOC_GROUPS.map((group) => (
          <section key={group.label}>
            <h2 className="mb-4 text-xl font-semibold tracking-tight">{group.label}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {group.pages.map((p) => (
                <a key={p.slug} href={sitePath("docs", p.slug)} className="group">
                  <Card className="h-full group-hover:shadow-md">
                    <CardHeader className="gap-2">
                      <CardTitle className="flex items-center justify-between text-base">
                        {p.title}
                        <ArrowRight className="text-muted-foreground group-hover:text-foreground size-4 transition-transform group-hover:translate-x-0.5" />
                      </CardTitle>
                      <CardDescription className="leading-relaxed">
                        {p.blurb}
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
  const index = DOC_PAGES.findIndex((p) => p.slug === slug);
  const page = DOC_PAGES[index];
  const prev = DOC_PAGES[index - 1];
  const next = DOC_PAGES[index + 1];
  const Content = DOC_CONTENT[slug];

  return (
    <>
      <PageHeading eyebrow={page.group} title={page.title} />
      <div className="space-y-4 leading-relaxed">
        <Content />
      </div>

      <nav
        aria-label="Previous and next page"
        className="mt-16 grid gap-4 border-t pt-6 text-sm sm:grid-cols-2"
      >
        {prev ? (
          <a href={sitePath(slug, prev.slug)} className="group">
            <span className="text-muted-foreground flex items-center gap-1">
              <ArrowLeft className="size-3.5" /> Previous
            </span>
            <span className="group-hover:text-primary font-medium">{prev.title}</span>
          </a>
        ) : (
          <span />
        )}
        {next && (
          <a href={sitePath(slug, next.slug)} className="group sm:text-right">
            <span className="text-muted-foreground flex items-center gap-1 sm:justify-end">
              Next <ArrowRight className="size-3.5" />
            </span>
            <span className="group-hover:text-primary font-medium">{next.title}</span>
          </a>
        )}
      </nav>
    </>
  );
}
