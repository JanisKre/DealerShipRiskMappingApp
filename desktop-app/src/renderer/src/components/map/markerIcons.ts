import L from "leaflet";
import { riskColor } from "@renderer/lib/riskColor";

/**
 * Returns a risk-colored teardrop marker icon.
 * `score` null/undefined -> gray pending pin.
 * `selected` -> additional pulse ring (CSS class `marker-selected`).
 * `zone` -> hail zone (1..6) printed in the pin.
 * `business` -> existing business is a filled pin, new business a white pin
 * with a thick risk-colored outline and a "+" badge (CSS class
 * `marker-new-business`), so the two read apart without giving up the risk
 * color.
 */
export function riskMarkerIcon(
  score: number | undefined | null,
  zone: number | undefined | null,
  selected = false,
  business: "existing" | "new" = "existing",
): L.DivIcon {
  const color = score != null ? riskColor(score) : "#6b7280";
  const label =
    score != null && zone != null
      ? `<span class="marker-label">Z${zone}</span>`
      : "";
  const badge =
    business === "new" ? `<span class="marker-new-badge">+</span>` : "";
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
    html: `<div class="${classes}" style="--marker-color:${color}">${label}${badge}</div>`,
  });
}
