import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, AlertTriangle, MapPin } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { effectiveVehicleCount } from "@shared/risk-math";
import { alertIdSet, generateAlerts } from "@shared/analytics";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { eur, num } from "@renderer/lib/format";
import { riskColor } from "@renderer/lib/riskColor";

const columnHelper = createColumnHelper<AnalyzedDealership>();

/** Purely numeric columns are right-aligned with tabular-nums. */
const NUMERIC_COLUMNS = new Set([
  "wind",
  "hail",
  "flood",
  "vehicles",
  "exposure",
  "eal",
]);

function perilScore(d: AnalyzedDealership, name: string): number {
  return d.risk?.perils.find((p) => p.peril === name)?.score ?? 0;
}

/**
 * Sortable and filterable portfolio table (@tanstack/react-table).
 * Clicking a row opens the detail dialog (via `onSelect`).
 */
export function DealershipTable({
  dealerships,
  onSelect,
  onShowOnMap,
  highlightIds,
}: {
  dealerships: AnalyzedDealership[];
  onSelect: (d: AnalyzedDealership) => void;
  /** Opens the location on the map (icon button per row). */
  onShowOnMap?: (d: AnalyzedDealership) => void;
  highlightIds?: string[] | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "score", desc: true },
  ]);
  const [filter, setFilter] = useState("");
  const [showAdditionalScores, setShowAdditionalScores] = useState(false);

  const alertIds = useMemo(
    () => alertIdSet(generateAlerts(dealerships)),
    [dealerships],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: t("ui.name"),
        cell: (info) => (
          <span className="flex items-center gap-1.5 font-medium">
            {alertIds.has(info.row.original.id) && (
              <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
            )}
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor((d) => d.risk?.overallScore ?? 0, {
        id: "score",
        header: t("dashboard.detailDialog.hailScoreLabel"),
        cell: (info) => (
          <Badge
            style={{
              backgroundColor: riskColor(info.getValue()),
              color: "white",
            }}
          >
            {info.getValue().toFixed(0)}
          </Badge>
        ),
      }),
      ...(showAdditionalScores
        ? [
            columnHelper.accessor((d) => perilScore(d, "wind"), {
              id: "wind",
              header: t("dashboard.detailDialog.ealPeril.wind"),
              cell: (info) => info.getValue().toFixed(0),
            }),
            columnHelper.accessor((d) => perilScore(d, "flood"), {
              id: "flood",
              header: t("dashboard.detailDialog.ealPeril.flood"),
              cell: (info) => info.getValue().toFixed(0),
            }),
          ]
        : []),
      columnHelper.accessor((d) => effectiveVehicleCount(d.detection), {
        id: "vehicles",
        header: t("common.vehicles"),
        cell: (info) => num(info.getValue()),
      }),
      columnHelper.accessor((d) => d.risk?.exposureEur ?? 0, {
        id: "exposure",
        header: t("dashboard.totalExposure"),
        cell: (info) => eur(info.getValue()),
      }),
      columnHelper.accessor((d) => d.risk?.eal ?? 0, {
        id: "eal",
        header: t("dashboard.totalEal"),
        cell: (info) => eur(info.getValue()),
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) =>
          onShowOnMap ? (
            <button
              type="button"
              title={t("ui.showOnMap")}
              aria-label={t("ui.showOnMap")}
              className="text-muted-foreground hover:text-primary"
              onClick={(e) => {
                e.stopPropagation();
                onShowOnMap(info.row.original);
              }}
            >
              <MapPin className="size-4" />
            </button>
          ) : null,
      }),
    ],
    [alertIds, onShowOnMap, showAdditionalScores, t],
  );

  const table = useReactTable({
    data: dealerships,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const highlight = highlightIds ? new Set(highlightIds) : null;

  return (
    <div className="space-y-3">
      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("ui.filterLocations")}
        className="max-w-xs"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowAdditionalScores((visible) => !visible)}
      >
        {showAdditionalScores
          ? t("dashboard.detailDialog.hideAdditionalScores")
          : t("dashboard.detailDialog.showAdditionalScores")}
      </Button>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const numeric = NUMERIC_COLUMNS.has(header.column.id);
                  return (
                    <TableHead
                      key={header.id}
                      className={numeric ? "text-right" : ""}
                    >
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          className={`inline-flex items-center gap-1 hover:text-foreground ${
                            numeric ? "flex-row-reverse" : ""
                          }`}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {header.column.getCanSort() && (
                            <ArrowUpDown className="size-3" />
                          )}
                        </button>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => onSelect(row.original)}
                className={`cursor-pointer ${
                  highlight?.has(row.original.id)
                    ? "bg-primary/10"
                    : "even:bg-muted/30"
                }`}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={
                      NUMERIC_COLUMNS.has(cell.column.id)
                        ? "text-right tabular-nums"
                        : ""
                    }
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-center text-muted-foreground"
                >
                  {t("ui.noMatches")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
