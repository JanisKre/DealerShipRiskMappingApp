import { ArrowRight, BookOpen } from "lucide-react";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DOC_TOPICS, type DocTopicId } from "@/lib/docs-topics";
import { sitePath } from "@/lib/site";

const HIGHLIGHTS: DocTopicId[] = [
  "quick-start",
  "import-format",
  "hail-model",
  "build",
];

export function DocsTeaser(): React.JSX.Element {
  const topics = DOC_TOPICS.filter((t) => HIGHLIGHTS.includes(t.id));

  return (
    <Section
      id="docs"
      eyebrow="Documentation"
      title="Up and running in minutes"
      description="A short guide covers installation, the import format, how hail risk is scored and how to build the app yourself."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {topics.map((topic) => (
          <a
            key={topic.id}
            href={sitePath("home", "docs", `#${topic.id}`)}
            className="group"
          >
            <Card className="h-full group-hover:shadow-md">
              <CardHeader className="gap-2">
                <CardTitle className="flex items-center justify-between text-base">
                  {topic.label}
                  <ArrowRight className="text-muted-foreground group-hover:text-foreground size-4 transition-transform group-hover:translate-x-0.5" />
                </CardTitle>
                <CardDescription className="leading-relaxed">
                  {topic.blurb}
                </CardDescription>
              </CardHeader>
            </Card>
          </a>
        ))}
      </div>
      <Button size="lg" variant="outline" className="mt-8" asChild>
        <a href={sitePath("home", "docs")}>
          <BookOpen />
          Open the documentation
        </a>
      </Button>
    </Section>
  );
}
