import L from "leaflet";
import { riskColor } from "@renderer/lib/riskColor";

/**
 * Returns a risk-colored teardrop marker icon.
 * `score` null/undefined -> gray pending pin.
 * `selected` -> additional pulse ring (CSS class `marker-selected`).
 * `business` -> existing business is a filled pin, new business a hollow
 * one outlined in the risk color (CSS class `marker-new-business`), so the
 * two read apart without giving up the risk color.
 */
export function riskMarkerIcon(
  score: number | undefined | null,
  selected = false,
  business: "existing" | "new" = "existing",
): L.DivIcon {
  const color = score != null ? riskColor(score) : "#6b7280";
  const label =
    score != null
      ? `<span class="marker-label">${Math.round(score)}</span>`
      : "";
  const classes = [
    "risk-marker",
    selected ? "marker-selected" : "",
    business === "new" ? "marker-new-business" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return L.divIcon({
    className: "",
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
    tooltipAnchor: [14, -18],
    html: `<div class="${classes}" style="--marker-color:${color}">${label}</div>`,
  });
}
