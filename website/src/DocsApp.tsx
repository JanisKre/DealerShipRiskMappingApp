import { useEffect } from "react";
import { Docs, docsTitle } from "@/components/docs";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useLang } from "@/lib/i18n";
import type { Page } from "@/lib/site";

export function DocsApp({ page }: { page: Exclude<Page, "home"> }): React.JSX.Element {
  const lang = useLang();

  // The HTML entries carry the English title; follow the chosen language.
  useEffect(() => {
    document.title = docsTitle(page, lang);
  }, [page, lang]);

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader page={page} />
      <main className="flex-1 border-b">
        <Docs page={page} />
      </main>
      <SiteFooter page={page} />
    </div>
  );
}
