import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, MapPin, X } from "lucide-react";
import type {
  AccumulationCluster,
  AnalyzedDealership,
  RiskParameters,
} from "@shared/types";
import {
  computeAccumulationClusters,
  dealershipHailZone,
  effectiveVehicleCount,
} from "@shared/risk-math";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
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
 * Accumulations of two or more located sites, largest exposure first. Also
 * used by the dashboard to leave the tile out when there are none (the KPI
 * already says so).
 */
export function largestAccumulations(
  dealerships: AnalyzedDealership[],
  parameters: RiskParameters,
): AccumulationCluster[] {
  const located = dealerships.filter((d) => d.lat != null && d.lon != null);
  return computeAccumulationClusters(
    located,
    parameters.accumulationRadiusKm,
    parameters,
  )
    .filter((c) => c.count > 1)
    .sort((a, b) => b.totalExposureEur - a.totalExposureEur);
}

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
  const clusters = useMemo(
    () => largestAccumulations(dealerships, parameters),
    [dealerships, parameters],
  );

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
            label={t("dashboard.accumulations.title")}
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
                {/* Takes the remaining width; `max-w-0` on its cells lets long
                    names and addresses truncate instead of pushing the
                    numeric columns out of view. */}
                <TableHead className="w-full min-w-56 whitespace-normal">
                  {t("dashboard.accumulations.name")}
                </TableHead>
                {/* Secondary columns drop out on narrower tiles so the key
                    figures (exposure, EAL, zone) stay visible without
                    horizontal scrolling. */}
                <TableHead className="hidden @4xl:table-cell text-right">
                  {t("dashboard.locations")}
                </TableHead>
                <TableHead className="hidden @4xl:table-cell text-right">
                  {t("common.vehicles")}
                </TableHead>
                <TableHead className="text-right">
                  {t("dashboard.totalExposure")}
                </TableHead>
                <TableHead className="text-right">
                  {t("dashboard.hailEal")}
                </TableHead>
                <TableHead>{t("dashboard.accumulations.maxZone")}</TableHead>
                <TableHead className="hidden @7xl:table-cell text-right">
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
                // Members still waiting for analysis: the sums would read
                // as final ("0 €"), so they show "–" until all are in.
                const pending = list.some((d) => !d.risk);
                const sum = (text: string): string => (pending ? "–" : text);
                const label = list[0]?.name ?? c.clusterId;
                return (
                  <Fragment key={c.clusterId}>
                    <TableRow
                      data-state={active ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => toggle(c.clusterId)}
                    >
                      <TableCell>
                        <HintButton
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-expanded={open}
                          aria-label={t(
                            open
                              ? "dashboard.accumulations.collapse"
                              : "dashboard.accumulations.expand",
                            { name: label },
                          )}
                          side="right"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle(c.clusterId);
                          }}
                        >
                          <ChevronRight
                            className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                          />
                        </HintButton>
                      </TableCell>
                      <TableCell className="max-w-0 font-medium">
                        <span className="mr-2 text-muted-foreground tabular-nums">
                          {index + 1}.
                        </span>
                        {label}
                        {c.count > 1 && (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            {t("dashboard.accumulations.more", {
                              count: c.count - 1,
                            })}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden @4xl:table-cell text-right tabular-nums">
                        {c.count}
                      </TableCell>
                      <TableCell className="hidden @4xl:table-cell text-right tabular-nums">
                        {sum(num(c.totalVehicles))}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {sum(eur(c.totalExposureEur))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {sum(eur(c.totalEalEur))}
                      </TableCell>
                      <TableCell>
                        {maxZone > 0 && !pending ? (
                          <HailZoneBadge zone={maxZone} />
                        ) : (
                          "–"
                        )}
                      </TableCell>
                      <TableCell className="hidden @7xl:table-cell text-right tabular-nums">
                        {sum(eur(c.natCatKpiEur))}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Icon only on narrower tiles, so the figures keep
                            their room. */}
                        <HintButton
                          variant="ghost"
                          size="sm"
                          aria-label={t("dashboard.accumulations.showOnMap")}
                          side="left"
                          onClick={(event) => {
                            event.stopPropagation();
                            onShowOnMap(c);
                          }}
                        >
                          <MapPin />
                          <span className="hidden @7xl:inline">
                            {t("dashboard.accumulations.showOnMap")}
                          </span>
                        </HintButton>
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
                            <TableCell className="max-w-0 pl-8">
                              <button
                                type="button"
                                className="block rounded-sm text-left break-words text-foreground hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                aria-label={t("dashboard.table.openDetails", {
                                  name: d.name,
                                })}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onSelect(d);
                                }}
                              >
                                {d.name}
                              </button>
                              {d.address && (
                                <span
                                  className="line-clamp-2 break-words text-xs"
                                  title={d.address}
                                >
                                  {d.address}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="hidden @4xl:table-cell" />
                            <TableCell className="hidden @4xl:table-cell text-right tabular-nums">
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
                            <TableCell className="hidden @7xl:table-cell" />
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
