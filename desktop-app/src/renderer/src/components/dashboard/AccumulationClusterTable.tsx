import { useMemo } from "react";
import type { AnalyzedDealership } from "@shared/types";
import { computeAccumulationClusters } from "@shared/risk-math";
import { ACCUMULATION_RADIUS_KM } from "@shared/constants";
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
import { riskColor, riskLevel, riskLevelLabel } from "@renderer/lib/riskColor";
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
  const activeClusterId = useAppStore((s) => s.filters.clusterId);
  const setFilters = useAppStore((s) => s.setFilters);

  const clusters = useMemo(() => {
    const withCoords = dealerships.filter(
      (d) => d.lat != null && d.lon != null,
    );
    return computeAccumulationClusters(withCoords, ACCUMULATION_RADIUS_KM).filter(
      (c) => c.count > 1,
    );
  }, [dealerships]);

  if (clusters.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Accumulation Clusters</CardTitle>
        <CardDescription>
          {clusters.length} clusters with ≥ 2 locations within a radius of{" "}
          {ACCUMULATION_RADIUS_KM} km, sorted by Nat Cat KPI (exposure ×
          modeled event loss).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cluster ID</TableHead>
              <TableHead className="text-right">Locations</TableHead>
              <TableHead className="text-right">Vehicles</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Hail Level</TableHead>
              <TableHead className="text-right">Nat Cat KPI</TableHead>
              <TableHead>Sales Partner</TableHead>
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
                      {riskLevelLabel(level)} · {c.maxHailScore.toFixed(0)}
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
