import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AnalyzedDealership } from "@shared/types";
import { computeAccumulationClusters } from "@shared/risk-math";
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
import { Badge } from "@renderer/components/ui/badge";
import { eur, num } from "@renderer/lib/format";
import { riskColor, riskLevel } from "@renderer/lib/riskColor";
import { useAppStore } from "@renderer/store/appStore";

/**
 * Accumulation cluster table (annual portfolio view). Groups locations by
 * single-linkage clustering within the distance radius and shows them
 * sorted descending by Nat Cat KPI: cluster ID, count within radius, size,
 * value, hail level, KPI, partner. Clicking a row filters the dashboard
 * and map to that cluster.
 */
export function AccumulationClusterTable({
  dealerships,
}: Readonly<{
  dealerships: AnalyzedDealership[];
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const activeClusterId = useAppStore((s) => s.filters.clusterId);
  const parameters = useAppStore((s) => s.parameters);
  const setFilters = useAppStore((s) => s.setFilters);

  const clusters = useMemo(() => {
    const withCoords = dealerships.filter(
      (d) => d.lat != null && d.lon != null,
    );
    return computeAccumulationClusters(
      withCoords,
      parameters.accumulationRadiusKm,
      parameters,
    ).filter((c) => c.count > 1);
  }, [dealerships, parameters]);

  if (clusters.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("ui.accumulationClusters")}</CardTitle>
        <CardDescription>
          {t("ui.clusterDescription", {
            count: clusters.length,
            radius: parameters.accumulationRadiusKm,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("ui.clusterId")}</TableHead>
              <TableHead className="text-right">
                {t("dashboard.locations")}
              </TableHead>
              <TableHead className="text-right">
                {t("common.vehicles")}
              </TableHead>
              <TableHead className="text-right">{t("ui.value")}</TableHead>
              <TableHead>{t("ui.hailLevel")}</TableHead>
              <TableHead className="text-right">{t("ui.natCatKpi")}</TableHead>
              <TableHead>{t("ui.salesPartner")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clusters.map((c) => {
              const level = riskLevel(c.maxHailScore);
              const active = c.clusterId === activeClusterId;
              return (
                <TableRow
                  key={c.clusterId}
                  data-state={active ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() =>
                    setFilters({ clusterId: active ? null : c.clusterId })
                  }
                >
                  <TableCell className="font-mono text-xs">
                    {c.clusterId}
                  </TableCell>
                  <TableCell className="text-right">{c.count}</TableCell>
                  <TableCell className="text-right">
                    {num(c.totalVehicles)}
                  </TableCell>
                  <TableCell className="text-right">
                    {eur(c.totalExposureEur)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      style={{
                        backgroundColor: riskColor(c.maxHailScore),
                        color: "white",
                      }}
                    >
                      {t(`risk.${level}`)} · {c.maxHailScore.toFixed(0)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {eur(c.natCatKpiEur)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.dominantSalesPartner ?? "–"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
