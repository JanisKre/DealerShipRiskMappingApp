import L from "leaflet";
import { hailZoneColor, hailZoneTextColor } from "@renderer/lib/riskColor";

/** Grey of a location whose hail zone is not known yet. */
const PENDING_COLOR = "#6b7280";

/**
 * A location pin: a teardrop in the hail-zone colour (1..6) with the zone
 * printed in it, readable on every zone colour. `zone` null/undefined is a
 * grey pending pin. `selected` adds the app's focus ring and a pulse; new
 * business carries a "+" badge. Styles: `.risk-marker` in globals.css.
 */
export function riskMarkerIcon(
  zone: number | undefined | null,
  selected = false,
  business: "existing" | "new" = "existing",
): L.DivIcon {
  const color = zone != null ? hailZoneColor(zone) : PENDING_COLOR;
  const text = zone != null ? hailZoneTextColor(zone) : "#ffffff";
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
    html: `<div class="${classes}" style="--marker-color:${color};--marker-text:${text}">${label}${badge}</div>`,
  });
}

/** Diameter of a cluster badge for `count` locations. */
export function clusterSize(count: number): number {
  return count < 10 ? 32 : count < 100 ? 38 : 46;
}

/**
 * A group of locations: a round card badge with the count; the ring shows
 * the highest hail zone inside (grey while none is known).
 */
export function clusterIcon(
  count: number,
  maxZone: number | null,
  label: string,
): L.DivIcon {
  const size = clusterSize(count);
  const color = maxZone != null ? hailZoneColor(maxZone) : PENDING_COLOR;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="cluster-icon" style="width:${size}px;height:${size}px;--cluster-color:${color}" role="img" aria-label="${label}"><span>${count}</span></div>`,
  });
}
