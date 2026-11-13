import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  MapPin,
} from "lucide-react";
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
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
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

/** Sorting, the search box (global filter) and pagination; nothing else. */
const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

const columnHelper = createColumnHelper<typeof features, AnalyzedDealership>();

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
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const parameters = useAppStore((s) => s.parameters);

  const alertIds = useMemo(
    () => alertIdSet(generateAlerts(dealerships, parameters)),
    [dealerships, parameters],
  );

  const columns = useMemo(
    () =>
      columnHelper.columns([
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
            if (!info.row.original.risk) return <PendingLabel />;
            if (zone === 0) return "–";
            const estimated =
              dealershipHailZone(info.row.original)?.source === "estimated";
            return <HailZoneBadge zone={zone} estimated={estimated} />;
          },
        }),
        columnHelper.accessor((d) => effectiveVehicleCount(d.detection), {
          id: "vehicles",
          header: t("common.vehicles"),
          cell: (info) => (info.row.original.risk ? num(info.getValue()) : "—"),
        }),
        columnHelper.accessor((d) => d.risk?.exposureEur ?? 0, {
          id: "exposure",
          header: t("dashboard.totalExposure"),
          cell: (info) => (info.row.original.risk ? eur(info.getValue()) : "—"),
        }),
        columnHelper.accessor((d) => d.risk?.eal ?? 0, {
          id: "eal",
          header: t("dashboard.hailEal"),
          cell: (info) => (info.row.original.risk ? eur(info.getValue()) : "—"),
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
      ]),
    [alertIds, onShowOnMap, t],
  );

  const table = useTable({
    features,
    data: dealerships,
    columns,
    state: { sorting, globalFilter: filter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: (value) => {
      setFilter(value as string);
      // A new search starts on the first page.
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onPaginationChange: setPagination,
    autoResetPageIndex: false,
  });
  const matching = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();
  // Fewer rows (a filter changed elsewhere) can leave the page past the end.
  if (pagination.pageIndex > 0 && pagination.pageIndex >= pageCount)
    setPagination((p) => ({ ...p, pageIndex: Math.max(0, pageCount - 1) }));

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
                  {row.getAllCells().map((cell) => (
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
        {matching > PAGE_SIZES[0] && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {t("dashboard.table.range", {
                from: pagination.pageIndex * pagination.pageSize + 1,
                to: Math.min(
                  matching,
                  (pagination.pageIndex + 1) * pagination.pageSize,
                ),
                count: matching,
              })}
            </span>
            <div className="flex items-center gap-2">
              <Select
                value={String(pagination.pageSize)}
                onValueChange={(v) =>
                  setPagination({ pageIndex: 0, pageSize: Number(v) })
                }
              >
                <SelectTrigger
                  className="h-8 w-auto gap-2 text-xs"
                  aria-label={t("dashboard.table.rowsPerPage")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {t("dashboard.table.perPage", { count: size })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                aria-label={t("dashboard.table.previousPage")}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="tabular-nums">
                {t("dashboard.table.page", {
                  page: pagination.pageIndex + 1,
                  pages: pageCount,
                })}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                aria-label={t("dashboard.table.nextPage")}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const PAGE_SIZES = [25, 50, 100];

/** Not analysed yet: no figure to show, rather than a misleading "0 €". */
function PendingLabel(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span className="text-xs text-muted-foreground">
      {t("dashboard.table.pending")}
    </span>
  );
}
