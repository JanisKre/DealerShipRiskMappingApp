import { useEffect, useMemo } from "react";
import { Polygon, Polyline, useMap } from "./leaflet-react";
import { corridorRings } from "./scenarioCorridor";
import type { Layer, LeafletEvent } from "leaflet";
import type { HailstormScenario } from "@shared/types";
import { SCENARIO_INTENSITY_DAMAGE } from "@shared/constants";

const INTENSITY_COLOR: Record<HailstormScenario["intensityLevel"], string> = {
  LOW: "#eab308",
  MEDIUM: "#f97316",
  HIGH: "#ea580c",
  EXTREME: "#dc2626",
};

interface PmMap {
  enableDraw: (shape: string, options?: Record<string, unknown>) => void;
  disableDraw: () => void;
}

interface PolylineLayer extends Layer {
  getLatLngs: () => Array<{ lat: number; lng: number }>;
}

/**
 * Draws the active hail corridor as a coloured centre line with a
 * semi-transparent geographic buffer, `widthKm` wide — the area whose sites
 * the scenario counts as affected. With `drawing=true` Geoman's line tool is
 * on; the finished line is reported to `onPath` as `pathCoordinates`.
 */
export function HailstormScenarioLayer({
  scenario,
  drawing,
  onPath,
}: Readonly<{
  scenario: HailstormScenario | null;
  drawing: boolean;
  onPath: (path: [number, number][]) => void;
}>): React.JSX.Element | null {
  const map = useMap();

  useEffect(() => {
    const pm = (map as unknown as { pm?: PmMap }).pm;
    if (!pm) return undefined;

    function handleCreate(e: LeafletEvent): void {
      const layer = e.target
        ? (e as unknown as { layer: PolylineLayer }).layer
        : undefined;
      if (!layer) return;
      const path = layer
        .getLatLngs()
        .map((p) => [p.lng, p.lat] as [number, number]);
      layer.remove(); // the drawn line goes; the layer renders from the store
      if (path.length >= 2) onPath(path);
    }

    if (drawing) {
      map.on("pm:create", handleCreate);
      pm.enableDraw("Line", { finishOn: "dblclick" });
    }

    return () => {
      map.off("pm:create", handleCreate);
      pm.disableDraw();
    };
  }, [drawing, map, onPath]);

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
