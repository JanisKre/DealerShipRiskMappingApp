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
import { dealershipHailZone, effectiveVehicleCount } from "@shared/risk-math";
import { alertIdSet, generateAlerts } from "@shared/analytics";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
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
import { useAppStore } from "@renderer/store/appStore";
import { HailZoneBadge } from "./HailZoneBadge";
import { TileInfo } from "./TileInfo";

const columnHelper = createColumnHelper<AnalyzedDealership>();

/** Purely numeric columns are right-aligned with tabular-nums. */
const NUMERIC_COLUMNS = new Set(["vehicles", "exposure", "eal"]);
/** Dropped on narrow screens so exposure and hail EAL stay in view. */
const NARROW_HIDDEN = "hidden @2xl:table-cell";
const HIDDEN_WHEN_NARROW = new Set(["vehicles"]);

/**
 * Sortable and searchable portfolio table (@tanstack/react-table) as a
 * dashboard tile. The search only narrows this table; the portfolio filters
 * above the tiles apply to every tile. Clicking a row opens the detail
 * dialog (via `onSelect`).
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
    { id: "eal", desc: true },
  ]);
  const [filter, setFilter] = useState("");
  const parameters = useAppStore((s) => s.parameters);

  const alertIds = useMemo(
    () => alertIdSet(generateAlerts(dealerships, parameters)),
    [dealerships, parameters],
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
      columnHelper.accessor((d) => dealershipHailZone(d)?.zone ?? 0, {
        id: "zone",
        header: t("dashboard.hailZone"),
        cell: (info) => {
          const zone = info.getValue();
          if (zone === 0) return "–";
          const estimated =
            dealershipHailZone(info.row.original)?.source === "estimated";
          return <HailZoneBadge zone={zone} estimated={estimated} />;
        },
      }),
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
        header: t("dashboard.hailEal"),
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
    [alertIds, onShowOnMap, t],
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          {t("dashboard.tiles.table")}
          <TileInfo topic="table" />
        </CardTitle>
        <CardDescription>{t("dashboard.table.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("dashboard.table.search")}
          aria-label={t("dashboard.table.search")}
          className="max-w-xs"
        />
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
                        className={`${numeric ? "text-right" : ""} ${
                          HIDDEN_WHEN_NARROW.has(header.column.id)
                            ? NARROW_HIDDEN
                            : ""
                        }`}
                        aria-sort={
                          header.column.getIsSorted() === "asc"
                            ? "ascending"
                            : header.column.getIsSorted() === "desc"
                              ? "descending"
                              : "none"
                        }
                      >
                        {header.isPlaceholder ? null : (
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 hover:text-foreground ${
                              numeric ? "flex-row-reverse" : ""
                            }`}
                            onClick={header.column.getToggleSortingHandler()}
                            title={
                              header.column.getIsSorted() === "asc"
                                ? t("dashboard.sortAscending")
                                : header.column.getIsSorted() === "desc"
                                  ? t("dashboard.sortDescending")
                                  : t("dashboard.sortNone")
                            }
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
                      className={`${
                        NUMERIC_COLUMNS.has(cell.column.id)
                          ? "text-right tabular-nums"
                          : ""
                      } ${
                        HIDDEN_WHEN_NARROW.has(cell.column.id)
                          ? NARROW_HIDDEN
                          : ""
                      }`}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
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
      </CardContent>
    </Card>
  );
}
