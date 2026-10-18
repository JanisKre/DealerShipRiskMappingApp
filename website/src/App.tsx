import { Docs } from "@/components/docs";
import { Download } from "@/components/download";
import { Features } from "@/components/features";
import { Hero } from "@/components/hero";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export function App(): React.JSX.Element {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <Features />
        <Download />
        <Docs />
      </main>
      <SiteFooter />
    </div>
  );
}
