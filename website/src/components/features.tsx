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
import { type Localized, useLang } from "@/lib/i18n";

const FEATURES = [
  { icon: MapPinned, key: "boundaries" },
  { icon: Car, key: "vehicles" },
  { icon: CloudHail, key: "hail" },
  { icon: LayoutDashboard, key: "dashboard" },
  { icon: Bot, key: "memo" },
  { icon: ShieldCheck, key: "local" },
] as const;

type Feature = (typeof FEATURES)[number]["key"];

const T: Localized<{
  eyebrow: string;
  title: string;
  items: Record<Feature, { title: string; text: string }>;
}> = {
  en: {
    eyebrow: "What it does",
    title: "From address list to underwriting memo",
    items: {
      boundaries: {
        title: "Lot boundary detection",
        text: "Cadastre, OpenStreetMap or building footprints — each with a confidence score.",
      },
      vehicles: {
        title: "AI vehicle counts",
        text: "A YOLOv26 model counts vehicles on aerial imagery.",
      },
      hail: {
        title: "Hail score & EAL",
        text: "Hail zone, licensed provider or CAPE proxy, plus expected annual loss.",
      },
      dashboard: {
        title: "Map & dashboard",
        text: "KPIs, charts and the full calculation for every location.",
      },
      memo: {
        title: "AI underwriting memo",
        text: "Optional, with a local model, OpenAI, Claude or a custom endpoint.",
      },
      local: {
        title: "Local & private",
        text: "SQLite on your machine. No accounts, no telemetry.",
      },
    },
  },
  de: {
    eyebrow: "Was die App kann",
    title: "Von der Adressliste zum Underwriting-Memo",
    items: {
      boundaries: {
        title: "Grundstücksgrenzen",
        text: "Kataster, OpenStreetMap oder Gebäudeumrisse — jeweils mit Konfidenzwert.",
      },
      vehicles: {
        title: "KI-Fahrzeugzählung",
        text: "Ein YOLOv26-Modell zählt Fahrzeuge auf Luftbildern.",
      },
      hail: {
        title: "Hagel-Score & EAL",
        text: "Hagelzone, lizenzierter Anbieter oder CAPE-Proxy, dazu der erwartete Jahresschaden.",
      },
      dashboard: {
        title: "Karte & Dashboard",
        text: "Kennzahlen, Diagramme und die vollständige Berechnung je Standort.",
      },
      memo: {
        title: "KI-Underwriting-Memo",
        text: "Optional, mit lokalem Modell, OpenAI, Claude oder eigenem Endpunkt.",
      },
      local: {
        title: "Lokal & privat",
        text: "SQLite auf deinem Rechner. Kein Konto, keine Telemetrie.",
      },
    },
  },
  fr: {
    eyebrow: "Fonctionnalités",
    title: "De la liste d’adresses à la note de souscription",
    items: {
      boundaries: {
        title: "Limites de parcelle",
        text: "Cadastre, OpenStreetMap ou emprises de bâtiments — chacune avec un indice de confiance.",
      },
      vehicles: {
        title: "Comptage IA des véhicules",
        text: "Un modèle YOLOv26 compte les véhicules sur les images aériennes.",
      },
      hail: {
        title: "Score grêle & EAL",
        text: "Zone de grêle, fournisseur sous licence ou proxy CAPE, plus la perte annuelle attendue.",
      },
      dashboard: {
        title: "Carte & tableau de bord",
        text: "Indicateurs, graphiques et le calcul complet pour chaque site.",
      },
      memo: {
        title: "Note de souscription IA",
        text: "En option, avec un modèle local, OpenAI, Claude ou un point d’accès personnalisé.",
      },
      local: {
        title: "Local & privé",
        text: "SQLite sur votre machine. Sans compte, sans télémétrie.",
      },
    },
  },
};

export function Features(): React.JSX.Element {
  const t = T[useLang()];
  return (
    <Section id="features" eyebrow={t.eyebrow} title={t.title}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.key} className="hover:shadow-md">
            <CardHeader className="gap-3">
              <span className="bg-accent text-accent-foreground flex size-10 items-center justify-center rounded-lg">
                <f.icon className="size-5" />
              </span>
              <CardTitle className="text-base">{t.items[f.key].title}</CardTitle>
              <CardDescription className="leading-relaxed">
                {t.items[f.key].text}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </Section>
  );
}
