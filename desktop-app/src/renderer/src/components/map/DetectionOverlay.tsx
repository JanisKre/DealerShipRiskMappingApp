import { CircleMarker } from "react-leaflet";
import type { AnalyzedDealership } from "@shared/types";

/** Color per vehicle class. */
const CLASS_COLOR: Record<string, string> = {
  car: "#2563eb",
  van: "#16a34a",
  truck: "#f59e0b",
  bus: "#dc2626",
};

/**
 * Draws detected vehicles as small dots at their georeferenced center
 * (box `lat`/`lon`). Boxes without a geo-reference are skipped.
 */
export function DetectionOverlay({
  dealerships,
}: Readonly<{ dealerships: AnalyzedDealership[] }>): React.JSX.Element {
  return (
    <>
      {dealerships.flatMap((d) =>
        (d.detection?.boxes ?? [])
          .filter((b) => b.lat != null && b.lon != null)
          .map((b, i) => (
            <CircleMarker
              key={`${d.id}-${i}`}
              center={[b.lat as number, b.lon as number]}
              radius={2.5}
              pathOptions={{
                color: CLASS_COLOR[b.classLabel ?? "car"] ?? "#2563eb",
                weight: 1,
                fillOpacity: 0.8,
              }}
            />
          )),
      )}
    </>
  );
}
