import { useTranslation } from "react-i18next";
import { Badge } from "@renderer/components/ui/badge";
import { hailZoneColor, hailZoneTextColor } from "@renderer/lib/riskColor";

/**
 * Hail zone as a traffic-light badge ("Zone 3"); "≈" marks a zone estimated
 * from weather data. Used everywhere a zone is shown so the format and the
 * text contrast stay the same across tiles, tables and the detail dialog.
 */
export function HailZoneBadge({
  zone,
  estimated = false,
}: Readonly<{ zone: number; estimated?: boolean }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Badge
      className="shrink-0 whitespace-nowrap"
      style={{
        backgroundColor: hailZoneColor(zone),
        color: hailZoneTextColor(zone),
      }}
      title={
        estimated
          ? t("dashboard.hailZoneEstimated")
          : t("dashboard.hailZoneLabel", { zone })
      }
    >
      {t("dashboard.zoneShort", { zone: `${estimated ? "≈" : ""}${zone}` })}
    </Badge>
  );
}
