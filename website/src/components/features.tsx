import {
  Bot,
  Car,
  CloudHail,
  HardDrive,
  Languages,
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
    text: "Fallback chain from ALKIS cadastre to OpenStreetMap, building footprints and a synthetic circle — each with a confidence score. Correct any polygon by hand.",
  },
  {
    icon: Car,
    title: "AI vehicle counts",
    text: "A YOLOv26 model counts vehicles on aerial imagery tiles. Edited boundaries are rescored immediately; counts can be reviewed per site.",
  },
  {
    icon: CloudHail,
    title: "Hail score & EAL",
    text: "Hail score from GDV hail zones, a licensed provider or an Open-Meteo CAPE proxy, plus expected annual loss and hailstorm scenarios.",
  },
  {
    icon: LayoutDashboard,
    title: "Map & dashboard",
    text: "KPIs, charts, a sortable table, per-location detail with the full calculation, and portfolio comparison.",
  },
  {
    icon: Bot,
    title: "AI underwriting memo",
    text: "Memos, executive summaries and portfolio chat with a local model (Ollama, LM Studio, llama.cpp), OpenAI, Claude or a custom endpoint. Off unless you set it up.",
  },
  {
    icon: HardDrive,
    title: "Local & offline-friendly",
    text: "SQLite database and API cache on your machine. Export to PDF, Excel, CSV or a portable .drm portfolio file.",
  },
  {
    icon: ShieldCheck,
    title: "Hardened by design",
    text: "Sandboxed renderer, Zod-validated IPC, API keys encrypted in the OS keychain. No accounts, no telemetry.",
  },
  {
    icon: Languages,
    title: "German, English, French",
    text: "The interface is available in German, English and French and can be switched at any time.",
  },
];

export function Features(): React.JSX.Element {
  return (
    <Section
      id="features"
      eyebrow="What it does"
      title="From address list to underwriting memo"
      description="Built for underwriters and risk engineers who need a fast, explainable first look at a dealership portfolio's hail exposure."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
