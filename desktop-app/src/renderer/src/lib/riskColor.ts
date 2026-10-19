/** Traffic-light color scale for risk scores (0 = green, 100 = red). */
export function riskColor(score: number): string {
  if (score < 25) return "#16a34a"; // green
  if (score < 50) return "#eab308"; // yellow
  if (score < 75) return "#f97316"; // orange
  return "#dc2626"; // red
}

/** One distinct color per hail zone (1 = green … 6 = dark red). */
const HAIL_ZONE_COLORS = [
  "#16a34a", // 1
  "#84cc16", // 2
  "#eab308", // 3
  "#f97316", // 4
  "#dc2626", // 5
  "#7f1d1d", // 6
] as const;

export function hailZoneColor(zone: number): string {
  const index = Math.min(6, Math.max(1, Math.round(zone))) - 1;
  return HAIL_ZONE_COLORS[index];
}

/** Discrete risk level per score (analogous to RiskLevel in the original). */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";

export function riskLevel(score: number): RiskLevel {
  if (score >= 75) return "EXTREME";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

/** Hex color per risk level (bolder palette for charts/badges). */
export function riskLevelColor(level: RiskLevel): string {
  switch (level) {
    case "EXTREME":
      return "#dc2626";
    case "HIGH":
      return "#f97316";
    case "MEDIUM":
      return "#eab308";
    default:
      return "#16a34a";
  }
}

/** Tailwind badge variant per risk level (bg + text). */
export function riskLevelBadgeClass(level: RiskLevel): string {
  switch (level) {
    case "EXTREME":
      return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200";
    case "HIGH":
      return "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200";
    case "MEDIUM":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200";
    default:
      return "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200";
  }
}

/** Display label per risk level. */
export function riskLevelLabel(level: RiskLevel): string {
  switch (level) {
    case "EXTREME":
      return "Extreme";
    case "HIGH":
      return "High";
    case "MEDIUM":
      return "Medium";
    default:
      return "Low";
  }
}
