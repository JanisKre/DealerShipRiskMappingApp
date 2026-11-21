import { useMapStore } from "@renderer/store/mapStore";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { notify } from "@renderer/lib/notify";
import type { AnalyzedDealership } from "@shared/types";
import {
  dealershipHailZone,
  haversineKm,
  nearbyInsured,
} from "@shared/risk-math";
import { SAMPLE_DATASETS_URL } from "@shared/constants";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { PortfolioFilterBar } from "@renderer/components/dashboard/PortfolioFilterBar";
import { ealSortValue } from "@shared/estimates";
import { useFilteredDealerships } from "@renderer/lib/useFilteredDealerships";
import { TooltipProvider } from "@renderer/components/ui/tooltip";
import { cn } from "@renderer/lib/utils";
import {
  businessType,
  unlocatedInputs,
  useAppStore,
} from "@renderer/store/appStore";
import { allRowsSelected, frozenOrder } from "./mapSelection";
import {
  FOCUS_RING,
  LocationRow,
  type Row,
  neighborSummaryText,
} from "./LocationRow";
import { AddLocationField } from "./AddLocationField";
import { DeleteSelectedDialog } from "./DeleteSelectedDialog";

const ADD_ADDRESS_BUTTON_ID = "locations-add-address";

interface Props {
  /** All locations with coordinates (full registry, independent of map text filters). */
  dealerships: AnalyzedDealership[];
  selectedId: string | null;
  /** IDs with an ongoing background analysis (spinner while analysing). */
  analyzingIds: string[];
  onSelect: (id: string) => void;
  onOpenDetails: (id: string) => void;
  /** Optional portfolio upload (CSV/Excel) directly from the header. */
  onUploadFile?: (file: File) => void | Promise<void>;
}

type SortKey = "eal" | "name" | "zone" | "nearby";
/** Rows rendered at first and per "show more" click. */
const PAGE = 100;
/** From this many locations on, search, sort and filter are offered. */
const TOOLS_FROM = 10;

/** Matches name or address, ignoring case and accents. */
function matchesQuery(d: AnalyzedDealership, query: string): boolean {
  const fold = (text: string): string =>
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const q = fold(query.trim());
  return !q || fold(`${d.name} ${d.address ?? ""}`).includes(q);
}

/**
 * Locations panel: lists all locations with a risk dot and relationship badges.
 * Can be embedded as a floating glass pane (`variant="float"`, default) or as a dock
 * (`variant="dock"`) in a panel.
 */
export function LocationsPanel({
  dealerships,
  selectedId,
  analyzingIds,
  onSelect,
  onOpenDetails,
  onUploadFile,
  variant = "float",
}: Readonly<Props & { variant?: "float" | "dock" }>): React.JSX.Element {
  const { t } = useTranslation();
  const batchRunning = useAppStore((s) => s.analyzing);
  // The same radius as the ring on the map (the parameter), not a fixed
  // 10 km: list and map disagreed once the parameter was changed.
  const accumulationRadiusKm = useAppStore(
    (s) => s.parameters.accumulationRadiusKm,
  );
  // Local instead of in mapStore: a pure UI flap for the row list, decoupled
  // from `locationsPanelOpen` (which only controls whether the entire dock panel in
  // WorkspacePage is collapsed to width 0 via the resizer). Otherwise a click
  // on the chevron in the header would make the entire left dock disappear.
  const [open, setOpen] = useState(true);
  const toggleOpen = (): void => setOpen((v) => !v);
  const [adding, setAdding] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const removeDealerships = useAppStore((s) => s.removeDealerships);
  const discardUnlocated = useAppStore((s) => s.discardUnlocatedInput);
  const pendingAnalysis = useAppStore((s) => s.pendingAnalysis);
  const failedInputs = useAppStore((s) => s.failedInputs);
  const analysisErrors = useAppStore((s) => s.analysisErrors);
  const allDealerships = useAppStore((s) => s.dealerships);
  // Imported rows without coordinates are not on the map until the address
  // search placed them; they are listed here so none disappears (UW-07).
  const unlocated = useMemo(
    () =>
      unlocatedInputs({
        pendingAnalysis,
        failedInputs,
        analysisErrors,
        dealerships: allDealerships,
      }),
    [pendingAnalysis, failedInputs, analysisErrors, allDealerships],
  );
  const setInsuredForDealerships = useAppStore(
    (s) => s.setInsuredForDealerships,
  );

  // Multi-select for bulk removal — purely local UI state, decoupled from
  // `selectedId` (which drives the map focus / detail subject).
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Large portfolios: search, sort, the shared portfolio filters, and rows
  // rendered in pages so a 500-row list stays quick and scannable.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("eal");
  const [showFilters, setShowFilters] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const filtersActive = useAppStore((s) =>
    Object.values(s.filters).some((v) => v != null),
  );
  const filtered = useFilteredDealerships(dealerships);
  const tools = dealerships.length >= TOOLS_FROM;
  const mixedBusiness = useMemo(() => {
    const types = new Set(dealerships.map(businessType));
    return types.size > 1;
  }, [dealerships]);
  useEffect(() => setVisible(PAGE), [query, sort, filtered]);

  function toggleSelectMode(): void {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  }

  function toggleChecked(id: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll(): void {
    // What the list shows (search and filters applied), not the whole book.
    setSelectedIds(new Set(rows.map((row) => row.d.id)));
  }

  function deselectAll(): void {
    setSelectedIds(new Set());
  }

  function confirmDelete(): void {
    const count = selectedIds.size;
    removeDealerships([...selectedIds]);
    setConfirmingDelete(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    notify.success(t("map.locationsPanel.deleteSelectedToast", { count }));
  }

  function markSelectedInsured(insured: boolean): void {
    const count = selectedIds.size;
    setInsuredForDealerships([...selectedIds], insured);
    setSelectedIds(new Set());
    notify.success(
      t(
        insured
          ? "map.locationsPanel.markInsuredToast"
          : "map.locationsPanel.markNotInsuredToast",
        { count },
      ),
    );
  }

  async function onFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.target.files?.[0];
    if (file && onUploadFile) await onUploadFile(file);
    if (uploadRef.current) uploadRef.current.value = "";
  }

  const subject = useMemo(
    () => dealerships.find((d) => d.id === selectedId) ?? null,
    [dealerships, selectedId],
  );

  // Rows with relationship info, in the chosen order ("nearby" sorts by
  // distance to the subject). The selected row keeps its place: moving it to
  // the top while the scroll position stayed made it jump out of view.
  const frozenRef = useRef<{ key: string; ids: string[] } | null>(null);
  const rows = useMemo<Row[]>(() => {
    const source = filtered.filter(
      (d) => d.id === selectedId || matchesQuery(d, query),
    );
    const built = source.map<Row>((d) => {
      const isSubject = subject != null && d.id === subject.id;
      const distanceKm =
        subject && !isSubject
          ? haversineKm(subject.lat, subject.lon, d.lat, d.lon)
          : null;
      return {
        d,
        distanceKm,
        sameGroup: !isSubject && !!subject?.group && d.group === subject.group,
        inRadius: distanceKm != null && distanceKm <= accumulationRadiusKm,
      };
    });
    const by: Record<SortKey, (a: Row, b: Row) => number> = {
      eal: (a, b) => ealSortValue(b.d) - ealSortValue(a.d),
      name: (a, b) => a.d.name.localeCompare(b.d.name),
      zone: (a, b) =>
        (dealershipHailZone(b.d)?.zone ?? 0) -
        (dealershipHailZone(a.d)?.zone ?? 0),
      // The reference location itself is at distance 0 (first row);
      // comparing it as "unknown" put it at an arbitrary place.
      nearby: (a, b) =>
        (a.d.id === subject?.id ? 0 : (a.distanceKm ?? Infinity)) -
        (b.d.id === subject?.id ? 0 : (b.distanceKm ?? Infinity)),
    };
    const order = sort === "nearby" && !subject ? "eal" : sort;
    const sorted = built.sort(
      (a, b) => by[order](a, b) || a.d.name.localeCompare(b.d.name),
    );
    // While a batch runs, results would make rows jump (a site moves up as
    // soon as it has an EAL): keep the order and append new rows (UW-04).
    // A different sort, search or filter re-sorts once.
    const key = `${sort}|${query}|${subject?.id ?? ""}`;
    const previous =
      batchRunning && frozenRef.current?.key === key
        ? frozenRef.current.ids
        : null;
    const ids = frozenOrder(
      previous,
      sorted.map((row) => row.d.id),
    );
    frozenRef.current = batchRunning ? { key, ids } : null;
    const byId = new Map(sorted.map((row) => [row.d.id, row]));
    return ids.map((id) => byId.get(id)).filter((r): r is Row => r != null);
  }, [
    filtered,
    subject,
    selectedId,
    query,
    sort,
    batchRunning,
    accumulationRadiusKm,
  ]);

  // The detail dialog pages through the locations in this order.
  const rowOrder = useMemo(() => rows.map((row) => row.d.id).join("|"), [rows]);
  useEffect(() => {
    useMapStore
      .getState()
      .setLocationsOrder(rowOrder ? rowOrder.split("|") : []);
  }, [rowOrder]);

  // A site selected elsewhere (map, chat) is scrolled into view once: the
  // page of rows grows to include it, then the row is brought into view.
  const listRef = useRef<HTMLDivElement>(null);
  const scrolledForRef = useRef<string | null>(null);
  const selectedIndex = rows.findIndex((row) => row.d.id === selectedId);
  useEffect(() => {
    if (selectedIndex >= visible)
      setVisible(Math.ceil((selectedIndex + 1) / PAGE) * PAGE);
  }, [selectedIndex, visible]);
  useEffect(() => {
    if (!selectedId || scrolledForRef.current === selectedId) return;
    const row = listRef.current?.querySelector(
      `[data-row-id="${CSS.escape(selectedId)}"]`,
    );
    if (!row) return;
    scrolledForRef.current = selectedId;
    row.scrollIntoView({ block: "nearest" });
  }, [selectedId, visible, open]);

  // Compared with what the list shows (search and filters applied).
  const allShownSelected = allRowsSelected(
    selectedIds,
    rows.map((row) => row.d.id),
  );

  // Summary: insured neighbors within the subject's accumulation radius.
  const neighborCount = useMemo(
    () =>
      subject
        ? nearbyInsured(subject, dealerships, accumulationRadiusKm).length
        : 0,
    [subject, dealerships, accumulationRadiusKm],
  );

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex min-h-0 flex-col overflow-hidden",
          variant === "dock"
            ? "h-full border-r bg-card"
            : "glass rounded-lg border shadow-lg",
          variant === "float" && open && "flex-1",
        )}
      >
        {/* Header — always visible */}
        {/* In a narrow dock the actions wrap below the title instead of
            clipping it or being clipped. */}
        {/* One line: the title truncates before the actions wrap. */}
        <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-2">
          <button
            type="button"
            onClick={toggleOpen}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap rounded-sm text-sm font-semibold",
              FOCUS_RING,
            )}
            aria-expanded={open}
            aria-label={t("map.locationsPanel.toggleAriaLabel")}
          >
            {open ? (
              <ChevronDown className="size-4 shrink-0" />
            ) : (
              <ChevronRight className="size-4 shrink-0" />
            )}
            {/* No extra pin icon: it pushed the actions onto a second row
                at the default dock width. */}
            <span className="truncate">{t("dashboard.locations")}</span>
            <span className="truncate text-muted-foreground tabular-nums">
              (
              {rows.length === dealerships.length
                ? dealerships.length
                : t("map.locationsPanel.countOf", {
                    shown: rows.length,
                    total: dealerships.length,
                  })}
              )
            </span>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {onUploadFile && (
              <>
                <input
                  ref={uploadRef}
                  type="file"
                  accept=".csv,.tsv,.txt,.xlsx"
                  className="hidden"
                  onChange={onFileChange}
                />
                <HintButton
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-6 shrink-0"
                  onClick={() => uploadRef.current?.click()}
                  aria-label={t("map.locationsPanel.importPortfolio")}
                >
                  <Paperclip className="size-3.5" />
                </HintButton>
              </>
            )}
            {dealerships.length > 0 && (
              <HintButton
                type="button"
                size="icon"
                variant="ghost"
                className={cn("size-6 shrink-0", selectMode && "bg-accent")}
                onClick={toggleSelectMode}
                aria-label={t(
                  selectMode
                    ? "map.locationsPanel.selectModeExit"
                    : "map.locationsPanel.selectModeEnter",
                )}
                aria-pressed={selectMode}
              >
                <CheckSquare className="size-3.5" />
              </HintButton>
            )}
            <HintButton
              type="button"
              size="icon"
              variant="ghost"
              id={ADD_ADDRESS_BUTTON_ID}
              className={cn("size-6 shrink-0", adding && "bg-accent")}
              onClick={() => setAdding((v) => !v)}
              aria-label={t("map.locationsPanel.addAddress")}
              aria-pressed={adding}
            >
              <Plus className="size-3.5" />
            </HintButton>
          </div>
        </div>

        {/* Add address */}
        {adding && (
          <div className="shrink-0 border-t px-2.5 py-2">
            <AddLocationField
              onDone={() => {
                setAdding(false);
                // Back to the button that opened the field, not to <body>.
                document.getElementById(ADD_ADDRESS_BUTTON_ID)?.focus();
              }}
            />
          </div>
        )}

        {open && tools && (
          <div className="shrink-0 space-y-1.5 border-t px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("map.locationsPanel.search")}
                  aria-label={t("map.locationsPanel.search")}
                  className="h-8 pl-7 text-xs"
                />
              </div>
              <HintButton
                type="button"
                size="icon"
                variant={showFilters || filtersActive ? "secondary" : "ghost"}
                className="relative size-8 shrink-0"
                onClick={() => setShowFilters((v) => !v)}
                aria-label={t("map.locationsPanel.filters")}
                aria-expanded={showFilters}
              >
                <SlidersHorizontal className="size-3.5" />
                {filtersActive && (
                  <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                )}
              </HintButton>
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger
                className="h-7 w-full min-w-0 text-xs [&>span]:truncate"
                aria-label={t("map.locationsPanel.sortLabel")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eal">
                  {t("map.locationsPanel.sort.eal")}
                </SelectItem>
                <SelectItem value="zone">
                  {t("map.locationsPanel.sort.zone")}
                </SelectItem>
                <SelectItem value="name">
                  {t("map.locationsPanel.sort.name")}
                </SelectItem>
                {subject && (
                  <SelectItem value="nearby">
                    {t("map.locationsPanel.sort.nearby", {
                      name: subject.name,
                    })}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {batchRunning && (
              <p className="text-[11px] text-muted-foreground">
                {t("map.locationsPanel.sortPaused")}
              </p>
            )}
            {showFilters && (
              <PortfolioFilterBar dealerships={dealerships} variant="panel" />
            )}
          </div>
        )}

        {open && (
          <>
            {/* Bulk-selection toolbar, or the subject's relationship summary */}
            {selectMode ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-2.5 py-1.5 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto shrink-0 p-0 text-xs"
                    onClick={allShownSelected ? deselectAll : selectAll}
                  >
                    {t(
                      allShownSelected
                        ? "map.locationsPanel.deselectAll"
                        : "map.locationsPanel.selectAll",
                    )}
                  </Button>
                  <span className="shrink-0 text-muted-foreground">
                    {t("map.locationsPanel.selectedCount", {
                      count: selectedIds.size,
                    })}
                  </span>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <HintButton
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 gap-1 px-2 text-xs"
                    disabled={selectedIds.size === 0}
                    onClick={() => markSelectedInsured(true)}
                    aria-label={t("map.locationsPanel.markInsured")}
                  >
                    <ShieldCheck className="size-3.5" />
                    {t("map.locationsPanel.insuredChip")}
                  </HintButton>
                  <HintButton
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 gap-1 px-2 text-xs"
                    disabled={selectedIds.size === 0}
                    onClick={() => markSelectedInsured(false)}
                    aria-label={t("map.locationsPanel.markNotInsured")}
                  >
                    <ShieldOff className="size-3.5" />
                    {t("map.locationsPanel.notInsuredChip")}
                  </HintButton>
                  <HintButton
                    type="button"
                    size="icon"
                    variant="destructive"
                    className="size-6 shrink-0"
                    disabled={selectedIds.size === 0}
                    onClick={() => setConfirmingDelete(true)}
                    aria-label={t("map.page.delete")}
                  >
                    <Trash2 className="size-3.5" />
                  </HintButton>
                </div>
              </div>
            ) : (
              subject && (
                <div className="shrink-0 border-t px-2.5 py-1.5 text-xs text-muted-foreground">
                  {neighborSummaryText(t, neighborCount, accumulationRadiusKm)}
                </div>
              )
            )}

            {/* List */}
            <div
              ref={listRef}
              className="min-h-0 flex-1 overflow-y-auto border-t"
            >
              {unlocated.length > 0 && (
                <ul
                  className="divide-y border-b bg-muted/30"
                  aria-label={t("map.locationsPanel.unlocatedTitle", {
                    count: unlocated.length,
                  })}
                >
                  <li className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                    {t("map.locationsPanel.unlocatedTitle", {
                      count: unlocated.length,
                    })}
                  </li>
                  {unlocated.map(({ input, error }) => (
                    <li
                      key={input.id}
                      className="flex items-start gap-2 px-2.5 py-2 text-sm"
                      data-testid="unlocated-row"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{input.name}</div>
                        {input.address && (
                          <div className="truncate text-xs text-muted-foreground">
                            {input.address}
                          </div>
                        )}
                        <div
                          className={cn(
                            "mt-0.5 text-xs",
                            error
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {error
                            ? t("map.locationsPanel.unlocatedFailed", {
                                reason: /could not be resolved/i.test(error)
                                  ? t("map.locationsPanel.unlocatedNotFound")
                                  : t("map.locationsPanel.unlocatedOther"),
                              })
                            : analyzingIds.includes(input.id)
                              ? t("map.locationsPanel.unlocatedSearching")
                              : batchRunning
                                ? t("map.locationsPanel.unlocatedWaiting")
                                : // Stopped or interrupted: nothing is
                                  // "about to" happen to this row.
                                  t("map.locationsPanel.notAnalyzed")}
                        </div>
                      </div>
                      {error && (
                        <HintButton
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7 shrink-0"
                          aria-label={t("map.locationsPanel.unlocatedDiscard")}
                          onClick={() => discardUnlocated(input.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </HintButton>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {rows.length === 0 &&
              unlocated.length > 0 ? null : rows.length === 0 ? (
                <p className="px-2.5 py-3 text-xs text-muted-foreground">
                  {dealerships.length > 0
                    ? t("map.locationsPanel.noMatches")
                    : t("map.locationsPanel.empty")}
                  {dealerships.length === 0 && (
                    <>
                      {" "}
                      <a
                        href={SAMPLE_DATASETS_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        {t("map.locationsPanel.sampleData")}
                      </a>
                    </>
                  )}
                </p>
              ) : (
                <>
                  <ul className="divide-y">
                    {rows.slice(0, visible).map((row) => (
                      <LocationRow
                        key={row.d.id}
                        row={row}
                        selected={row.d.id === selectedId}
                        analyzing={analyzingIds.includes(row.d.id)}
                        batchRunning={batchRunning}
                        showBusiness={mixedBusiness}
                        onSelect={onSelect}
                        onOpenDetails={onOpenDetails}
                        selectMode={selectMode}
                        checked={selectedIds.has(row.d.id)}
                        onToggleCheck={toggleChecked}
                      />
                    ))}
                  </ul>
                  {rows.length > visible && (
                    <button
                      type="button"
                      className={cn(
                        "w-full border-t px-2.5 py-2 text-xs font-medium text-primary hover:bg-accent/60",
                        FOCUS_RING,
                      )}
                      onClick={() => setVisible((v) => v + PAGE)}
                    >
                      {t("map.locationsPanel.showMore", {
                        count: Math.min(PAGE, rows.length - visible),
                        rest: rows.length - visible,
                      })}
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}

        <DeleteSelectedDialog
          open={confirmingDelete}
          count={selectedIds.size}
          onOpenChange={setConfirmingDelete}
          onConfirm={confirmDelete}
        />
      </div>
    </TooltipProvider>
  );
}
