import type { Peril } from "@shared/types";
import { perilColor, perilLabel } from "@renderer/lib/perilLabel";
import { riskColor } from "@renderer/lib/riskColor";
import { perilRingStyleForScore } from "./MultiPerilOverlay";

/** Sample scores for the legend — show exactly what the real rings look like at this value. */
const LEGEND_SCORES = [0, 25, 50, 75, 100];

interface Props {
  /** Active peril overlay. null = none active. */
  perilOverlay: Peril | null;
  /** Accumulation cluster layer visible? */
  showClusters: boolean;
}

/**
 * Context-dependent color scale next to the map legend.
 * - Peril overlay active → 0-100 gradient in the peril color with unit.
 * - Accumulation clusters active → risk color scale Low->Extreme (hail score of the clusters).
 * Hidden when both are inactive.
 */
export function OverlayLegend({
  perilOverlay,
  showClusters,
}: Props): React.JSX.Element | null {
  if (!perilOverlay && !showClusters) return null;

  if (perilOverlay) {
    const color = perilColor(perilOverlay);
    return (
      <div className="space-y-1.5 rounded-lg border bg-card/95 p-3 text-xs shadow-lg backdrop-blur">
        <div className="font-semibold text-muted-foreground">
          {perilLabel(perilOverlay)} – Score
        </div>
        {/* Samples instead of a gradient: a plain alpha ramp already looks "fully
            saturated" on a dark background past ~50% — these circles show exactly
            the stroke weight/fill that the real rings have at this score. */}
        <div className="flex items-end justify-between gap-1">
          {LEGEND_SCORES.map((score) => {
            const { weight, fillOpacity } = perilRingStyleForScore(score);
            return (
              <div key={score} className="flex flex-col items-center gap-1">
                <span
                  className="size-4 rounded-full"
                  style={{
                    backgroundColor: color,
                    opacity: fillOpacity,
                    border: `${weight / 2.5}px solid ${color}`,
                  }}
                />
                <span className="text-[10px] text-muted-foreground">
                  {score}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Accumulation clusters: risk color scale (hail score of the clusters)
  const STEPS = [
    { label: "Low", color: riskColor(10) },
    { label: "Medium", color: riskColor(35) },
    { label: "High", color: riskColor(60) },
    { label: "Extreme", color: riskColor(85) },
  ];

  return (
    <div className="space-y-1.5 rounded-lg border bg-card/95 p-3 text-xs shadow-lg backdrop-blur">
      <div className="font-semibold text-muted-foreground">
        Accumulation clusters
      </div>
      {STEPS.map((s) => (
        <div key={s.label} className="flex items-center gap-1.5">
          <span
            className="size-3 rounded-sm"
            style={{ backgroundColor: s.color, opacity: 0.7 }}
          />
          {s.label}
        </div>
      ))}
      <div className="mt-1 text-muted-foreground">Opacity ∝ EAL share</div>
    </div>
  );
}
