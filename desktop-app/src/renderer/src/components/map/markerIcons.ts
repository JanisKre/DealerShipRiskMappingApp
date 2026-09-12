import L from "leaflet";
import { riskColor } from "@renderer/lib/riskColor";

/**
 * Returns a risk-colored teardrop marker icon.
 * `score` null/undefined -> gray pending pin.
 * `selected` -> additional pulse ring (CSS class `marker-selected`).
 */
export function riskMarkerIcon(
  score: number | undefined | null,
  selected = false,
): L.DivIcon {
  const color = score != null ? riskColor(score) : "#6b7280";
  const label =
    score != null
      ? `<span class="marker-label">${Math.round(score)}</span>`
      : "";
  const selectedClass = selected ? " marker-selected" : "";

  return L.divIcon({
    className: "",
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
    tooltipAnchor: [14, -18],
    html: `<div class="risk-marker${selectedClass}" style="--marker-color:${color}">${label}</div>`,
  });
}
