import type { Peril } from "@shared/types";

/** Display names of the perils (central for charts/tables/overlays). */
export const PERIL_LABELS: Record<Peril, string> = {
  wind: "Storm",
  lightning: "Lightning",
  snow: "Snow",
  flood: "Flood",
  hail: "Hail",
  heat: "Heat",
};

export function perilLabel(p: Peril): string {
  return PERIL_LABELS[p];
}

/** Strong, easily distinguishable color per peril (for multi-peril overlays/charts). */
export const PERIL_COLORS: Record<Peril, string> = {
  wind: "#0ea5e9", // sky
  lightning: "#a855f7", // violet
  snow: "#64748b", // slate
  flood: "#2563eb", // blue
  hail: "#f97316", // orange
  heat: "#dc2626", // red
};

export function perilColor(p: Peril): string {
  return PERIL_COLORS[p];
}
