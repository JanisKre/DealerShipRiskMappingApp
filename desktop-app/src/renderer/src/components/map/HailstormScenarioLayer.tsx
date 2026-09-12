import { useEffect } from "react";
import { Polyline, useMap } from "react-leaflet";
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
 * Zeichnet den aktiven Hagel-Korridor als farbige Linie mit halbtransparentem
 * Puffer (Breite). Bei `drawing=true` aktiviert Geoman das Linien-Zeichnen; die
 * fertige Linie wird als `pathCoordinates` an `onPath` gemeldet.
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
      layer.remove(); // gezeichnete Linie entfernen — wir rendern selbst aus dem Store
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

  if (!scenario) return null;

  const positions = scenario.pathCoordinates.map(
    ([lon, lat]) => [lat, lon] as [number, number],
  );
  const color = INTENSITY_COLOR[scenario.intensityLevel];

  return (
    <>
      {/* Puffer (Korridorbreite als dicke, transparente Linie) */}
      <Polyline
        positions={positions}
        pathOptions={{
          color,
          weight: scenario.widthKm * 4,
          opacity: 0.2,
          lineCap: "round",
        }}
      />
      {/* Mittellinie */}
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
