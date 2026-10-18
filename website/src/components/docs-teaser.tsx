import { ArrowRight, BookOpen } from "lucide-react";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DOC_PAGES, type DocSlug } from "@/lib/docs-pages";
import { type Localized, useLang } from "@/lib/i18n";
import { sitePath } from "@/lib/site";

const HIGHLIGHTS: DocSlug[] = [
  "installation",
  "quick-start",
  "hail-model",
  "build",
];

const T: Localized<{ eyebrow: string; title: string; open: string }> = {
  en: {
    eyebrow: "Documentation",
    title: "Up and running in minutes",
    open: "Open the documentation",
  },
  de: {
    eyebrow: "Dokumentation",
    title: "In wenigen Minuten startklar",
    open: "Zur Dokumentation",
  },
  fr: {
    eyebrow: "Documentation",
    title: "Opérationnel en quelques minutes",
    open: "Ouvrir la documentation",
  },
};

export function DocsTeaser(): React.JSX.Element {
  const lang = useLang();
  const t = T[lang];
  const pages = DOC_PAGES.filter((p) => HIGHLIGHTS.includes(p.slug));

  return (
    <Section id="docs" eyebrow={t.eyebrow} title={t.title}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {pages.map((page) => (
          <a
            key={page.slug}
            href={sitePath("home", page.slug)}
            className="group"
          >
            <Card className="h-full group-hover:shadow-md">
              <CardHeader className="gap-2">
                <CardTitle className="flex items-center justify-between text-base">
                  {page.title[lang]}
                  <ArrowRight className="text-muted-foreground group-hover:text-foreground size-4 transition-transform group-hover:translate-x-0.5" />
                </CardTitle>
                <CardDescription className="leading-relaxed">
                  {page.blurb[lang]}
                </CardDescription>
              </CardHeader>
            </Card>
          </a>
        ))}
      </div>
      <Button size="lg" variant="outline" className="mt-8" asChild>
        <a href={sitePath("home", "docs")}>
          <BookOpen />
          {t.open}
        </a>
      </Button>
    </Section>
  );
}
