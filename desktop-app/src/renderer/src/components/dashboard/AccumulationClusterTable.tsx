import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, MapPin, X } from "lucide-react";
import type { AccumulationCluster, AnalyzedDealership } from "@shared/types";
import {
  computeAccumulationClusters,
  dealershipHailZone,
  effectiveVehicleCount,
} from "@shared/risk-math";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { eur, num, pct } from "@renderer/lib/format";
import { useAppStore } from "@renderer/store/appStore";
import { HailZoneBadge } from "./HailZoneBadge";
import { TileInfo } from "./TileInfo";

/** Accumulations shown before "show all". */
const INITIAL_ROWS = 10;

/**
 * "Largest accumulations": locations chained within the accumulation radius
 * (single linkage), largest exposure first. Each row expands into its member
 * locations; "Map" filters the portfolio to the accumulation and fits the map
 * to its members. The loss scenario (exposure × medium scenario damage)
 * replaces the former PML tile.
 */
export function AccumulationClusterTable({
  dealerships,
  onSelect,
  onShowOnMap,
}: Readonly<{
  dealerships: AnalyzedDealership[];
  onSelect: (d: AnalyzedDealership) => void;
  onShowOnMap: (cluster: AccumulationCluster) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const activeClusterId = useAppStore((s) => s.filters.clusterId);
  const parameters = useAppStore((s) => s.parameters);
  const setFilters = useAppStore((s) => s.setFilters);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const byId = useMemo(
    () => new Map(dealerships.map((d) => [d.id, d])),
    [dealerships],
  );
  const clusters = useMemo(() => {
    const located = dealerships.filter((d) => d.lat != null && d.lon != null);
    return computeAccumulationClusters(
      located,
      parameters.accumulationRadiusKm,
      parameters,
    )
      .filter((c) => c.count > 1)
      .sort((a, b) => b.totalExposureEur - a.totalExposureEur);
  }, [dealerships, parameters]);

  const radius = parameters.accumulationRadiusKm;
  const visible = showAll ? clusters : clusters.slice(0, INITIAL_ROWS);

  function members(c: AccumulationCluster): AnalyzedDealership[] {
    return c.memberIds
      .map((id) => byId.get(id))
      .filter((d): d is AnalyzedDealership => d != null)
      .sort((a, b) => (b.risk?.exposureEur ?? 0) - (a.risk?.exposureEur ?? 0));
  }

  function toggle(id: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          {t("dashboard.accumulations.title")}
          <TileInfo
            topic="accumulations"
            values={{
              radius,
              scenario: pct(parameters.scenarioDamageMedium),
            }}
          />
        </CardTitle>
        <CardDescription>
          {clusters.length > 0
            ? t("dashboard.accumulations.description", {
                count: clusters.length,
                radius,
              })
            : t("dashboard.accumulations.empty", { radius })}
        </CardDescription>
        {activeClusterId && (
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters({ clusterId: null })}
            >
              <X /> {t("dashboard.accumulations.clearFilter")}
            </Button>
          </div>
        )}
      </CardHeader>
      {clusters.length > 0 && (
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>{t("dashboard.accumulations.name")}</TableHead>
                <TableHead className="text-right">
                  {t("dashboard.locations")}
                </TableHead>
                <TableHead className="text-right">
                  {t("common.vehicles")}
                </TableHead>
                <TableHead className="text-right">
                  {t("dashboard.totalExposure")}
                </TableHead>
                <TableHead className="text-right">
                  {t("dashboard.hailEal")}
                </TableHead>
                <TableHead>{t("dashboard.accumulations.maxZone")}</TableHead>
                <TableHead className="text-right">
                  {t("dashboard.accumulations.scenario", {
                    share: pct(parameters.scenarioDamageMedium),
                  })}
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((c, index) => {
                const list = members(c);
                const open = expanded.has(c.clusterId);
                const active = c.clusterId === activeClusterId;
                const zones = list
                  .map((d) => dealershipHailZone(d)?.zone ?? 0)
                  .filter((z) => z > 0);
                const maxZone = zones.length ? Math.max(...zones) : 0;
                return (
                  <Fragment key={c.clusterId}>
                    <TableRow
                      data-state={active ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => toggle(c.clusterId)}
                      aria-expanded={open}
                    >
                      <TableCell>
                        <ChevronRight
                          className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className="mr-2 text-muted-foreground tabular-nums">
                          {index + 1}.
                        </span>
                        {list[0]?.name ?? c.clusterId}
                        {c.count > 1 && (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            {t("dashboard.accumulations.more", {
                              count: c.count - 1,
                            })}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(c.totalVehicles)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {eur(c.totalExposureEur)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {eur(c.totalEalEur)}
                      </TableCell>
                      <TableCell>
                        {maxZone > 0 ? <HailZoneBadge zone={maxZone} /> : "–"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {eur(c.natCatKpiEur)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            onShowOnMap(c);
                          }}
                        >
                          <MapPin /> {t("dashboard.accumulations.showOnMap")}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {open &&
                      list.map((d) => {
                        const zone = dealershipHailZone(d);
                        return (
                          <TableRow
                            key={`${c.clusterId}-${d.id}`}
                            className="cursor-pointer bg-muted/30 text-muted-foreground"
                            onClick={() => onSelect(d)}
                          >
                            <TableCell />
                            <TableCell className="pl-8">
                              <span className="text-foreground">{d.name}</span>
                              {d.address && (
                                <span className="block truncate text-xs">
                                  {d.address}
                                </span>
                              )}
                            </TableCell>
                            <TableCell />
                            <TableCell className="text-right tabular-nums">
                              {num(effectiveVehicleCount(d.detection))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {eur(d.risk?.exposureEur)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {eur(d.risk?.eal)}
                            </TableCell>
                            <TableCell>
                              {zone ? (
                                <HailZoneBadge
                                  zone={zone.zone}
                                  estimated={zone.source === "estimated"}
                                />
                              ) : (
                                "–"
                              )}
                            </TableCell>
                            <TableCell />
                            <TableCell />
                          </TableRow>
                        );
                      })}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
          {clusters.length > INITIAL_ROWS && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAll((value) => !value)}
              >
                {showAll
                  ? t("dashboard.showLess")
                  : t("dashboard.showAll", { count: clusters.length })}
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
