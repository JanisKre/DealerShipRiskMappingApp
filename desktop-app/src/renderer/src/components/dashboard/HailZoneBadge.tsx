import { useTranslation } from "react-i18next";
import { Badge } from "@renderer/components/ui/badge";
import { hailZoneColor } from "@renderer/lib/riskColor";

/** Hail zone as a traffic-light badge; "≈" marks a zone estimated from weather data. */
export function HailZoneBadge({
  zone,
  estimated = false,
}: Readonly<{ zone: number; estimated?: boolean }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Badge
      className="shrink-0 whitespace-nowrap"
      style={{ backgroundColor: hailZoneColor(zone), color: "white" }}
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
