import L from "leaflet";
import { CircleMarker, Marker, Tooltip } from "react-leaflet";
import { useTranslation } from "react-i18next";
import type { AnalyzedDealership, Peril } from "@shared/types";
import { perilLabel, perilColor } from "@renderer/lib/perilLabel";

/** Fixed radius for the peril ring — deliberately not score-scaled: a tiny
 * circle at a low score was practically invisible on the aerial image. */
const RING_RADIUS_PX = 26;

/**
 * Border weight/fill for a score (0..100) — reused by `OverlayLegend` so the
 * legend shows exactly what's on the map (instead of an independent CSS
 * gradient estimate that would look different from the actual rings).
 */
export function perilRingStyleForScore(score: number): {
  weight: number;
  fillOpacity: number;
} {
  return {
    weight: 3 + (score / 100) * 6,
    fillOpacity: 0.3 + (score / 100) * 0.45,
  };
}

/** Numeric badge next to the ring, so the value never depends on the circle/background. */
function scoreBadgeIcon(score: number, color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};color:#fff;font:700 11px/1 system-ui,sans-serif;padding:2px 6px;border-radius:9999px;box-shadow:0 1px 4px rgba(0,0,0,.5);border:1.5px solid rgba(255,255,255,.85);white-space:nowrap;">${Math.round(score)}</div>`,
    iconSize: undefined,
    // To the right of the ring, roughly vertically centered — this way it overlaps
    // neither the ring nor the risk marker pin that rises above the point.
    iconAnchor: [-RING_RADIUS_PX - 8, 8],
  });
}

/**
 * Multi-peril overlay: a colored ring per location for the selected peril,
 * plus a numeric badge with the score (0..100) — a plain color/opacity circle
 * was hard to read against the aerial background, and an alpha ramp already
 * looks "fully saturated" to the eye above ~50% opacity, which is why the
 * number is the reliable source. The ring remains as a rough pattern for
 * quickly scanning the portfolio (thin/pale = low, thick/saturated = high).
 * Toggleable via the layer control in `MapPage`. Color per peril from the
 * central palette.
 */
export function MultiPerilOverlay({
  dealerships,
  peril,
}: Readonly<{
  dealerships: AnalyzedDealership[];
  peril: Peril;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const color = perilColor(peril);

  return (
    <>
      {dealerships.map((d) => {
        const score = d.risk?.perils.find((p) => p.peril === peril)?.score;
        if (score == null) return null;
        // Border weight 3–9px and fill 0.3–0.75 carry the score; the ring
        // itself always stays clearly visible (border opacity stays constantly high).
        const { weight, fillOpacity } = perilRingStyleForScore(score);
        return (
          <CircleMarker
            key={d.id}
            center={[d.lat, d.lon]}
            radius={RING_RADIUS_PX}
            pathOptions={{
              color,
              weight,
              opacity: 0.95,
              fillColor: color,
              fillOpacity,
            }}
          >
            <Tooltip>
              <div className="space-y-0.5">
                <strong>{d.name}</strong>
                <div>
                  {perilLabel(peril)}: {score.toFixed(0)}/100
                </div>
                {peril === "hail" && d.hailZone != null && (
                  <div className="text-xs text-muted-foreground">
                    {t("map.multiPerilOverlay.hailZoneTooltip", {
                      zone: d.hailZone,
                      tier: d.hailRiskTier,
                    })}
                  </div>
                )}
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
      {dealerships.map((d) => {
        const score = d.risk?.perils.find((p) => p.peril === peril)?.score;
        if (score == null) return null;
        return (
          <Marker
            key={`${d.id}-badge`}
            position={[d.lat, d.lon]}
            icon={scoreBadgeIcon(score, color)}
            interactive={false}
          />
        );
      })}
    </>
  );
}
