import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { dealershipHailZone } from "@shared/risk-math";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { eur, pct } from "@renderer/lib/format";
import { HailZoneBadge } from "./HailZoneBadge";
import { TileInfo } from "./TileInfo";

const TOP_N = 10;

/**
 * Top locations by hail EAL as a ranked bar list. The EAL (EUR) separates
 * locations that tie on hail zone, which the old 0–100 score ranking could
 * not. Clicking a row opens the detail dialog; the pin opens the map.
 */
export function TopLocationsChart({
  dealerships,
  onSelect,
  onShowOnMap,
}: Readonly<{
  dealerships: AnalyzedDealership[];
  onSelect: (d: AnalyzedDealership) => void;
  onShowOnMap: (d: AnalyzedDealership) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const totalEal = dealerships.reduce((a, d) => a + (d.risk?.eal ?? 0), 0);
  const top = useMemo(
    () =>
      dealerships
        .filter((d) => (d.risk?.eal ?? 0) > 0)
        .sort((a, b) => (b.risk?.eal ?? 0) - (a.risk?.eal ?? 0))
        .slice(0, TOP_N),
    [dealerships],
  );
  const max = top[0]?.risk?.eal ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          {t("dashboard.topLocations.title")}
          <TileInfo topic="topLocations" />
        </CardTitle>
        <CardDescription>
          {t("dashboard.topLocations.description", { count: TOP_N })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("dashboard.topLocations.empty")}
          </p>
        ) : (
          <ol className="space-y-1">
            {top.map((d, index) => {
              const eal = d.risk?.eal ?? 0;
              const zone = dealershipHailZone(d);
              return (
                <li key={d.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onSelect(d)}
                    className="grid min-w-0 flex-1 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    title={
                      totalEal > 0
                        ? t("dashboard.topLocations.share", {
                            share: pct(eal / totalEal),
                          })
                        : undefined
                    }
                  >
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{d.name}</span>
                      {zone && (
                        <HailZoneBadge
                          zone={zone.zone}
                          estimated={zone.source === "estimated"}
                        />
                      )}
                    </span>
                    <span className="text-right font-medium tabular-nums">
                      {eur(eal)}
                    </span>
                    <span />
                    <span className="col-span-2 mt-1 h-1.5 rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${max > 0 ? (eal / max) * 100 : 0}%` }}
                      />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onShowOnMap(d)}
                    title={t("ui.showOnMap")}
                    aria-label={`${t("ui.showOnMap")}: ${d.name}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                  >
                    <MapPin className="size-4" />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
