import { useMemo } from "react";
import { Polygon, Polyline } from "./leaflet-react";
import { corridorRings } from "./scenarioCorridor";
import type { HailstormScenario } from "@shared/types";
import { SCENARIO_INTENSITY_DAMAGE } from "@shared/constants";

const INTENSITY_COLOR: Record<HailstormScenario["intensityLevel"], string> = {
  LOW: "#eab308",
  MEDIUM: "#f97316",
  HIGH: "#ea580c",
  EXTREME: "#dc2626",
};

/**
 * Draws the active hail corridor as a coloured centre line with a
 * semi-transparent geographic buffer, `widthKm` wide — the area whose sites
 * the scenario counts as affected. The line itself is drawn with the hail
 * panel's drawing mode (HailEventReplayLayer).
 */
export function HailstormScenarioLayer({
  scenario,
}: Readonly<{
  scenario: HailstormScenario | null;
}>): React.JSX.Element | null {
  const path = scenario?.pathCoordinates;
  const widthKm = scenario?.widthKm ?? 0;
  const positions = useMemo(
    () => (path ?? []).map(([lon, lat]) => [lat, lon] as [number, number]),
    [path],
  );
  const buffer = useMemo(
    () => corridorRings(path ?? [], widthKm),
    [path, widthKm],
  );

  if (!scenario) return null;
  const color = INTENSITY_COLOR[scenario.intensityLevel];

  return (
    <>
      {/* Buffer: one ring per segment and vertex, filled as their union. */}
      <Polygon
        positions={buffer}
        interactive={false}
        pathOptions={{
          stroke: false,
          fillColor: color,
          fillOpacity: 0.2,
          fillRule: "nonzero",
        }}
      />
      {/* Centre line */}
      <Polyline
        positions={positions}
        pathOptions={{ color, weight: 3, opacity: 0.9 }}
      />
    </>
  );
}

export { INTENSITY_COLOR };
export const INTENSITY_LEVELS = Object.keys(
  SCENARIO_INTENSITY_DAMAGE,
) as HailstormScenario["intensityLevel"][];
