import {
  Bot,
  Car,
  CloudHail,
  LayoutDashboard,
  MapPinned,
  ShieldCheck,
} from "lucide-react";
import { Section } from "@/components/section";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const FEATURES = [
  {
    icon: MapPinned,
    title: "Lot boundary detection",
    text: "Cadastre, OpenStreetMap or building footprints — each with a confidence score.",
  },
  {
    icon: Car,
    title: "AI vehicle counts",
    text: "A YOLOv26 model counts vehicles on aerial imagery.",
  },
  {
    icon: CloudHail,
    title: "Hail score & EAL",
    text: "Hail zone, licensed provider or CAPE proxy, plus expected annual loss.",
  },
  {
    icon: LayoutDashboard,
    title: "Map & dashboard",
    text: "KPIs, charts and the full calculation for every location.",
  },
  {
    icon: Bot,
    title: "AI underwriting memo",
    text: "Optional, with a local model, OpenAI, Claude or a custom endpoint.",
  },
  {
    icon: ShieldCheck,
    title: "Local & private",
    text: "SQLite on your machine. No accounts, no telemetry.",
  },
];

export function Features(): React.JSX.Element {
  return (
    <Section
      id="features"
      eyebrow="What it does"
      title="From address list to underwriting memo"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.title} className="hover:shadow-md">
            <CardHeader className="gap-3">
              <span className="bg-accent text-accent-foreground flex size-10 items-center justify-center rounded-lg">
                <f.icon className="size-5" />
              </span>
              <CardTitle className="text-base">{f.title}</CardTitle>
              <CardDescription className="leading-relaxed">
                {f.text}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </Section>
  );
}
