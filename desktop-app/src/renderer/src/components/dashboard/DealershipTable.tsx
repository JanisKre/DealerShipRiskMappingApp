import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  constructSortFn,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
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
import { HintButton } from "@renderer/components/ui/hint-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";
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
import { EstimateMark } from "./EstimateMark";
import { estimateReasons } from "./estimates";
import { HailZoneBadge } from "./HailZoneBadge";
import { matchesLocationSearch } from "./tableSearch";
import { TileInfo } from "./TileInfo";

/**
 * Sorting and pagination. The search box filters the rows before they reach
 * the table: it searches name and address only (see `matchesLocationSearch`).
 */
const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

/** Names sort like a phone book: "bhg Autohandel" between "Autohaus" and "BMW". */
const nameCollator = new Intl.Collator("de", { sensitivity: "base" });
const sortByName = constructSortFn({
  sort: (a: string, b: string) => nameCollator.compare(a, b),
});

const columnHelper = createColumnHelper<typeof features, AnalyzedDealership>();

/** Purely numeric columns are right-aligned with tabular-nums. */
const NUMERIC_COLUMNS = new Set(["vehicles", "exposure", "eal"]);
/**
 * Dropped as the dashboard gets narrower (assistant open, small window), so
 * name, zone and hail EAL always stay in view: vehicles go first, then
 * exposure.
 */
const NARROW_HIDDEN: Record<string, string> = {
  vehicles: "hidden @5xl:table-cell",
  exposure: "hidden @4xl:table-cell",
};

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
  onOrderChange,
  highlightIds,
}: {
  dealerships: AnalyzedDealership[];
  onSelect: (d: AnalyzedDealership) => void;
  /** Opens the location on the map (icon button per row). */
  onShowOnMap?: (d: AnalyzedDealership) => void;
  /** Ids in the table's sorted and searched order (detail dialog arrows). */
  onOrderChange?: (ids: string[]) => void;
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
  const searched = useMemo(
    () => dealerships.filter((d) => matchesLocationSearch(d, filter)),
    [dealerships, filter],
  );

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("name", {
          header: t("ui.name"),
          sortFn: sortByName,
          // The name is the row's keyboard target: Tab reaches it, Enter
          // opens the details (the whole row stays clickable).
          cell: (info) => (
            <span className="flex items-center gap-1.5 font-medium">
              {alertIds.has(info.row.original.id) && (
                <Tooltip delayDuration={150}>
                  <TooltipTrigger asChild>
                    <AlertTriangle
                      role="img"
                      aria-label={t("dashboard.table.alertIcon")}
                      className="size-3.5 shrink-0 text-warning-foreground"
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("dashboard.table.alertIcon")}
                  </TooltipContent>
                </Tooltip>
              )}
              <button
                type="button"
                className="rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-label={t("dashboard.table.openDetails", {
                  name: info.getValue(),
                })}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(info.row.original);
                }}
              >
                {info.getValue()}
              </button>
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
          cell: (info) =>
            info.row.original.risk ? (
              <Estimated d={info.row.original}>
                {num(info.getValue())}
              </Estimated>
            ) : (
              "–"
            ),
        }),
        columnHelper.accessor((d) => d.risk?.exposureEur ?? 0, {
          id: "exposure",
          header: t("dashboard.totalExposure"),
          cell: (info) =>
            info.row.original.risk ? (
              <Estimated d={info.row.original}>
                {eur(info.getValue())}
              </Estimated>
            ) : (
              "–"
            ),
        }),
        columnHelper.accessor((d) => d.risk?.eal ?? 0, {
          id: "eal",
          header: t("dashboard.hailEal"),
          cell: (info) =>
            info.row.original.risk ? (
              <Estimated d={info.row.original}>
                {eur(info.getValue())}
              </Estimated>
            ) : (
              "–"
            ),
        }),
        columnHelper.display({
          id: "actions",
          header: "",
          cell: (info) =>
            onShowOnMap ? (
              <HintButton
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-primary"
                aria-label={t("ui.showOnMap")}
                side="left"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowOnMap(info.row.original);
                }}
              >
                <MapPin className="size-4" />
              </HintButton>
            ) : null,
        }),
      ]),
    [alertIds, onSelect, onShowOnMap, t],
  );

  const table = useTable({
    features,
    data: searched,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    autoResetPageIndex: false,
  });
  const matching = searched.length;
  const orderKey = table
    .getSortedRowModel()
    .rows.map((row) => row.original.id)
    .join("\n");
  useEffect(() => {
    onOrderChange?.(orderKey ? orderKey.split("\n") : []);
  }, [orderKey, onOrderChange]);
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
          <TileInfo topic="table" label={t("dashboard.tiles.table")} />
        </CardTitle>
        <CardDescription>{t("dashboard.table.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          type="search"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            // A new search starts on the first page.
            setPagination((p) => ({ ...p, pageIndex: 0 }));
          }}
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
                    const sorted = header.column.getIsSorted();
                    const canSort = header.column.getCanSort();
                    const SortIcon =
                      sorted === "asc"
                        ? ArrowUp
                        : sorted === "desc"
                          ? ArrowDown
                          : ArrowUpDown;
                    return (
                      <TableHead
                        key={header.id}
                        className={`${numeric ? "text-right" : ""} ${
                          NARROW_HIDDEN[header.column.id] ?? ""
                        }`}
                        aria-sort={
                          !canSort
                            ? undefined
                            : sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                                ? "descending"
                                : "none"
                        }
                      >
                        {header.isPlaceholder || !canSort ? null : (
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                              numeric ? "flex-row-reverse" : ""
                            } ${sorted ? "text-foreground" : ""}`}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                            <SortIcon
                              aria-hidden
                              className={`size-3 ${sorted ? "" : "opacity-50"}`}
                            />
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
                      } ${NARROW_HIDDEN[cell.column.id] ?? ""}`}
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
              <HintButton
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                aria-label={t("dashboard.table.previousPage")}
              >
                <ChevronLeft className="size-4" />
              </HintButton>
              <span className="tabular-nums">
                {t("dashboard.table.page", {
                  page: pagination.pageIndex + 1,
                  pages: pageCount,
                })}
              </span>
              <HintButton
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                aria-label={t("dashboard.table.nextPage")}
              >
                <ChevronRight className="size-4" />
              </HintButton>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const PAGE_SIZES = [25, 50, 100];

/** A figure with the "≈" mark when it is an estimate. */
function Estimated({
  d,
  children,
}: Readonly<{
  d: AnalyzedDealership;
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <>
      <EstimateMark reasons={estimateReasons(d)} />
      {children}
    </>
  );
}

/** Not analysed yet: no figure to show, rather than a misleading "0 €". */
function PendingLabel(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span className="text-xs text-muted-foreground">
      {t("dashboard.table.pending")}
    </span>
  );
}
