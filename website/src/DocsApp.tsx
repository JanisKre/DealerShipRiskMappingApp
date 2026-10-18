import { Docs } from "@/components/docs";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export function DocsApp(): React.JSX.Element {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader page="docs" />
      <main className="flex-1 border-b">
        <Docs />
      </main>
      <SiteFooter page="docs" />
    </div>
  );
}
