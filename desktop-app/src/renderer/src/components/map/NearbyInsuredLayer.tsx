import { Circle, CircleMarker, Tooltip } from "react-leaflet";
import type { AnalyzedDealership } from "@shared/types";
import { nearbyInsured } from "@shared/risk-math";
import { eur } from "@renderer/lib/format";

/**
 * Accumulation layer for a single location (underwriting view): draws the
 * distance-threshold ring around the selected subject and highlights the
 * already-insured neighbors within the ring. Nothing is drawn without a
 * selection or without coordinates.
 */
export function NearbyInsuredLayer({
  subject,
  dealerships,
  radiusKm,
}: Readonly<{
  subject: AnalyzedDealership | null;
  dealerships: AnalyzedDealership[];
  radiusKm: number;
}>): React.JSX.Element | null {
  if (!subject) return null;

  const neighbors = nearbyInsured(subject, dealerships, radiusKm);

  return (
    <>
      {/* Distance-threshold ring around the subject. */}
      <Circle
        center={[subject.lat, subject.lon]}
        radius={radiusKm * 1000}
        pathOptions={{
          color: "#0ea5e9",
          weight: 1.5,
          dashArray: "6 6",
          fillColor: "#0ea5e9",
          fillOpacity: 0.05,
        }}
      />

      {/* Insured neighbors within the radius. */}
      {neighbors.map(({ dealership: d, distanceKm }) => (
        <CircleMarker
          key={d.id}
          center={[d.lat, d.lon]}
          radius={9}
          pathOptions={{
            color: "#0284c7",
            weight: 2,
            fillColor: "#38bdf8",
            fillOpacity: 0.7,
          }}
        >
          <Tooltip>
            <div className="space-y-0.5">
              <strong>{d.name}</strong>
              <div>Insured · {distanceKm.toFixed(1)} km</div>
              <div>Exposure: {eur(d.risk?.exposureEur)}</div>
            </div>
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}
