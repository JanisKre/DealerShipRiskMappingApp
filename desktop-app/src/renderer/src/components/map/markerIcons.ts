import L from "leaflet";
import { hailZoneColor } from "@renderer/lib/riskColor";

/**
 * Returns a risk-colored teardrop marker icon.
 * `zone` null/undefined -> gray pending pin.
 * `selected` -> additional pulse ring (CSS class `marker-selected`).
 * The pin is colored by hail zone (1..6), which is also printed in it.
 * `business` -> existing business is a filled pin, new business a white pin
 * with a thick risk-colored outline and a "+" badge (CSS class
 * `marker-new-business`), so the two read apart without giving up the risk
 * color.
 */
export function riskMarkerIcon(
  zone: number | undefined | null,
  selected = false,
  business: "existing" | "new" = "existing",
): L.DivIcon {
  const color = zone != null ? hailZoneColor(zone) : "#6b7280";
  const label =
    zone != null ? `<span class="marker-label">Z${zone}</span>` : "";
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
