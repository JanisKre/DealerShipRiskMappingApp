import { useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import {
  riskLevelColor,
  riskLevelLabel,
  type RiskLevel,
} from "@renderer/lib/riskColor";
import { sourceColor } from "./BoundaryLayer";
import type { BoundarySource } from "@shared/types";

const RISK_LEVELS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "EXTREME"];

const SOURCES: Array<{ source: BoundarySource; label: string }> = [
  { source: "alkis", label: "ALKIS" },
  { source: "osm", label: "OSM" },
  { source: "overture", label: "Overture" },
  { source: "synthetic", label: "Puffer" },
  { source: "manual", label: "Manuell" },
];

const VEHICLE_CLASSES: Array<{ color: string; label: string }> = [
  { color: "#2563eb", label: "PKW" },
  { color: "#16a34a", label: "Transporter" },
  { color: "#f59e0b", label: "LKW" },
  { color: "#dc2626", label: "Bus" },
];

/** Karten-Legende: Risiko-Skala, Grenzquellen und Fahrzeugklassen — einklappbar. */
export function MapLegend(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="glass w-60 rounded-lg border shadow-lg">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold"
        aria-expanded={open}
      >
        <Info className="size-4" />
        Legende
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2.5 text-xs">
          <LegendGroup title="Risiko">
            {RISK_LEVELS.map((lvl) => (
              <LegendRow
                key={lvl}
                color={riskLevelColor(lvl)}
                label={riskLevelLabel(lvl)}
              />
            ))}
          </LegendGroup>
          <LegendGroup title="Grenzquelle">
            {SOURCES.map((s) => (
              <LegendRow
                key={s.source}
                color={sourceColor(s.source)}
                label={s.label}
                outline
              />
            ))}
          </LegendGroup>
          <LegendGroup title="Fahrzeuge">
            {VEHICLE_CLASSES.map((v) => (
              <LegendRow key={v.label} color={v.color} label={v.label} dot />
            ))}
          </LegendGroup>
        </div>
      )}
    </div>
  );
}

function LegendGroup({
  title,
  children,
}: Readonly<{ title: string; children: React.ReactNode }>): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 font-semibold text-muted-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">{children}</div>
    </div>
  );
}

function LegendRow({
  color,
  label,
  outline,
  dot,
}: Readonly<{
  color: string;
  label: string;
  outline?: boolean;
  dot?: boolean;
}>): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={dot ? "size-2 rounded-full" : "size-3 rounded-sm"}
        style={
          outline
            ? { border: `2px solid ${color}`, backgroundColor: `${color}33` }
            : { backgroundColor: color }
        }
      />
      {label}
    </div>
  );
}
