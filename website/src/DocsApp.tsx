import { Docs } from "@/components/docs";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { Page } from "@/lib/site";

export function DocsApp({ page }: { page: Exclude<Page, "home"> }): React.JSX.Element {
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
