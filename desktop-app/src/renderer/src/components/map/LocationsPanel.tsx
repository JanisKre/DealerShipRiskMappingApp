import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Loader2,
  MapPin,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  ShieldOff,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { AnalyzedDealership } from "@shared/types";
import {
  dealershipHailZone,
  haversineKm,
  nearbyInsured,
} from "@shared/risk-math";
import { ACCUMULATION_RADIUS_KM, SAMPLE_DATASETS_URL } from "@shared/constants";
import { Button } from "@renderer/components/ui/button";
import { Checkbox } from "@renderer/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
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
import { useFilteredDealerships } from "@renderer/lib/useFilteredDealerships";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";
import { cn } from "@renderer/lib/utils";
import { hailZoneColor } from "@renderer/lib/riskColor";
import { eur, num } from "@renderer/lib/format";
import { businessType, useAppStore } from "@renderer/store/appStore";
import { searchBias } from "@renderer/lib/searchBias";
import { Link } from "react-router-dom";
import { useDealerDirectoryStore } from "@renderer/store/dealerDirectoryStore";
import {
  PlaceApproximateNote,
  PlacePortfolioBadge,
  PlaceSourceTag,
} from "./PlaceSourceTag";
import { allRowsSelected } from "./mapSelection";
import type { PlaceSuggestion } from "@shared/ipc-schema";
import { nameForPlace } from "@renderer/lib/placeName";

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

/** A row including derived relationship info relative to the selected subject. */
interface Row {
  d: AnalyzedDealership;
  /** Distance to the subject in km — null if nothing is selected or the row itself is the subject. */
  distanceKm: number | null;
  sameGroup: boolean;
  inRadius: boolean;
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
  // Local instead of in mapStore: a pure UI flap for the row list, decoupled
  // from `locationsPanelOpen` (which only controls whether the entire dock panel in
  // WorkspacePage is collapsed to width 0 via the resizer). Otherwise a click
  // on the chevron in the header would make the entire left dock disappear.
  const [open, setOpen] = useState(true);
  const toggleOpen = (): void => setOpen((v) => !v);
  const [adding, setAdding] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const removeDealerships = useAppStore((s) => s.removeDealerships);
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
    toast.success(t("map.locationsPanel.deleteSelectedToast", { count }));
  }

  function markSelectedInsured(insured: boolean): void {
    const count = selectedIds.size;
    setInsuredForDealerships([...selectedIds], insured);
    setSelectedIds(new Set());
    toast.success(
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
        inRadius: distanceKm != null && distanceKm <= ACCUMULATION_RADIUS_KM,
      };
    });
    const by: Record<SortKey, (a: Row, b: Row) => number> = {
      eal: (a, b) => (b.d.risk?.eal ?? -1) - (a.d.risk?.eal ?? -1),
      name: (a, b) => a.d.name.localeCompare(b.d.name),
      zone: (a, b) =>
        (dealershipHailZone(b.d)?.zone ?? 0) -
        (dealershipHailZone(a.d)?.zone ?? 0),
      nearby: (a, b) =>
        a.distanceKm != null && b.distanceKm != null
          ? a.distanceKm - b.distanceKm
          : 0,
    };
    const order = sort === "nearby" && !subject ? "eal" : sort;
    return built.sort(
      (a, b) => by[order](a, b) || a.d.name.localeCompare(b.d.name),
    );
  }, [filtered, subject, selectedId, query, sort]);

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
        ? nearbyInsured(subject, dealerships, ACCUMULATION_RADIUS_KM).length
        : 0,
    [subject, dealerships],
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
            <AddLocationField onDone={() => setAdding(false)} />
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
                  {neighborSummaryText(t, neighborCount)}
                </div>
              )
            )}

            {/* List */}
            <div
              ref={listRef}
              className="min-h-0 flex-1 overflow-y-auto border-t"
            >
              {rows.length === 0 ? (
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

/** Confirmation dialog for permanently removing locations (list selection or one marker). */
export function DeleteSelectedDialog({
  open,
  count,
  name,
  onOpenChange,
  onConfirm,
}: Readonly<{
  open: boolean;
  count: number;
  /** Single location by name (map context menu) instead of a count. */
  name?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {name
              ? t("map.page.deleteConfirmTitle")
              : t("map.locationsPanel.deleteSelectedConfirmTitle")}
          </DialogTitle>
          <DialogDescription>
            {name
              ? t("map.page.deleteConfirmDescription", { name })
              : t("map.locationsPanel.deleteSelectedConfirmDescription", {
                  count,
                })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            <Trash2 className="size-4" />
            {t("map.page.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Neighbor summary text (avoids nested ternaries in JSX). */
function neighborSummaryText(t: TFunction, count: number): string {
  const radius = ACCUMULATION_RADIUS_KM;
  if (count === 0)
    return t("map.locationsPanel.neighborSummary.none", { radius });
  if (count === 1)
    return t("map.locationsPanel.neighborSummary.one", { radius });
  return t("map.locationsPanel.neighborSummary.other", { count, radius });
}

/** A clickable location row with a risk dot and relationship badges. */
function LocationRow({
  row,
  selected,
  analyzing,
  batchRunning,
  showBusiness,
  onSelect,
  onOpenDetails,
  selectMode = false,
  checked = false,
  onToggleCheck,
}: Readonly<{
  row: Row;
  selected: boolean;
  /** The analysis of this location is running right now. */
  analyzing: boolean;
  /** A batch analysis is running (rows without a result are queued). */
  batchRunning: boolean;
  /** Business chips only help when the portfolio mixes both types. */
  showBusiness: boolean;
  onSelect: (id: string) => void;
  onOpenDetails: (id: string) => void;
  selectMode?: boolean;
  checked?: boolean;
  onToggleCheck?: (id: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const { d, distanceKm, sameGroup, inRadius } = row;
  const hailZone = dealershipHailZone(d)?.zone;
  const dotColor = hailZone != null ? hailZoneColor(hailZone) : "#9ca3af";

  return (
    <li
      data-row-id={d.id}
      className={cn("flex items-stretch", selected && "bg-accent")}
    >
      {selectMode && (
        <label className="flex shrink-0 items-center pl-2.5">
          <Checkbox
            checked={checked}
            onCheckedChange={() => onToggleCheck?.(d.id)}
            aria-label={t("map.locationsPanel.selectFor", { name: d.name })}
          />
        </label>
      )}
      {/* Selection button (fills the row) */}
      <button
        type="button"
        className={cn(
          "flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left text-sm hover:bg-accent/60",
          FOCUS_RING_INSET,
        )}
        onClick={() => (selectMode ? onToggleCheck?.(d.id) : onSelect(d.id))}
        aria-pressed={selectMode ? checked : selected}
      >
        {/* Decorative: the zone is read out in the row text. */}
        <span
          aria-hidden
          className="mt-1 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
        <div className="min-w-0 flex-1">
          {/* Full width for the name; the figure sits on the second line. */}
          <div className="truncate font-medium">{d.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            {analyzing ? (
              <>
                <PendingSpinner pending />
                {t("map.locationsPanel.analyzing")}
              </>
            ) : !d.risk ? (
              t(
                batchRunning
                  ? "map.locationsPanel.pending"
                  : "map.locationsPanel.notAnalyzed",
              )
            ) : (
              t("map.locationsPanel.ealValue", { value: eur(d.risk.eal) })
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-1 empty:hidden">
            {d.group && (
              <Chip>
                <Users className="size-3" />
                {d.group}
              </Chip>
            )}
            {showBusiness && d.insured && (
              <Chip>
                <ShieldCheck className="size-3" />
                {t("map.locationsPanel.insuredChip")}
              </Chip>
            )}
            {d.boundary?.source === "synthetic" && (
              <Chip warning title={t("ui.fallbackBoundaryReview")}>
                {t("ui.fallbackBoundary")}
              </Chip>
            )}
            {distanceKm != null && (
              <Chip>
                {t("map.locationsPanel.distanceChip", {
                  distance: num(distanceKm, 1),
                })}
              </Chip>
            )}
            {sameGroup && (
              <Chip accent>{t("map.locationsPanel.sameGroupChip")}</Chip>
            )}
            {inRadius && (
              <Chip accent>{t("map.locationsPanel.inRadiusChip")}</Chip>
            )}
          </div>
        </div>
      </button>
      {/* Open details (separate button, not nested) — hidden while selecting */}
      {!selectMode && (
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "shrink-0 px-1.5 text-muted-foreground hover:text-foreground",
                FOCUS_RING_INSET,
              )}
              onClick={() => onOpenDetails(d.id)}
              aria-label={t("map.locationsPanel.viewDetailsFor", {
                name: d.name,
              })}
            >
              <ChevronRight className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {t("map.locationsPanel.viewDetails")}
          </TooltipContent>
        </Tooltip>
      )}
    </li>
  );
}

/** Right side of the row: spinner while the analysis is running. */
function PendingSpinner({
  pending,
}: Readonly<{
  pending: boolean;
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!pending) return null;
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <Loader2 className="size-3.5 animate-spin" />
      </TooltipTrigger>
      <TooltipContent side="left">
        {t("map.locationsPanel.analyzing")}
      </TooltipContent>
    </Tooltip>
  );
}

/** Small info chip; `accent` highlights relationship matches. */
function Chip({
  children,
  accent,
  warning,
  title,
}: Readonly<{
  children: React.ReactNode;
  accent?: boolean;
  warning?: boolean;
  title?: string;
}>): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium",
        accent
          ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
          : warning
            ? "bg-warning/15 text-warning-foreground"
            : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Keyboard focus ring for raw buttons (spec: same as the `Button` ring). */
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
/** Inset variant for full-width rows, whose outer edge the list clips. */
const FOCUS_RING_INSET =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50";

const DEBOUNCE_MS = 300;
const MIN_CHARS = 3;

type Suggestion = PlaceSuggestion;

/**
 * Compact address input field with Photon autocomplete (keyless, like in
 * the omnibox). Selecting a suggestion adds the location directly to the portfolio;
 * the auto-selection in `addAndAnalyze` makes the map fly to it. Arrow keys
 * move through the suggestions, Enter adds the highlighted one and Escape
 * closes the field.
 */
function AddLocationField({
  onDone,
}: Readonly<{ onDone: () => void }>): React.JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  /** Query the current suggestions (or the "no matches" note) belong to. */
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  /** Photon unreachable for the current answer: local suggestions only. */
  const [onlineUnavailable, setOnlineUnavailable] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryStatus = useDealerDirectoryStore((s) => s.status);
  const directoryUpdate = useDealerDirectoryStore((s) => s.update);
  const loadDirectoryStatus = useDealerDirectoryStore((s) => s.loadStatus);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (directoryStatus === undefined) void loadDirectoryStatus();
  }, [directoryStatus, loadDirectoryStatus]);

  const trimmed = value.trim();

  // Debounced autocomplete — discards stale responses.
  useEffect(() => {
    if (trimmed.length < MIN_CHARS) {
      setSuggestions([]);
      setAnsweredFor(null);
      setError(false);
      setOnlineUnavailable(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const result = await window.api.placesAutocomplete(
          trimmed,
          searchBias(),
        );
        if (!cancelled) {
          setSuggestions(result.suggestions);
          setOnlineUnavailable(result.onlineUnavailable);
          setActive(0);
          setAnsweredFor(trimmed);
        }
      } catch (e) {
        if (!cancelled) {
          // The raw IPC message ("Error invoking remote method …") is for
          // the log, not for the user.
          console.warn("Address autocomplete failed:", e);
          setSuggestions([]);
          setAnsweredFor(null);
          setOnlineUnavailable(false);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  function pick(s: Suggestion): void {
    void useAppStore.getState().addAndAnalyze([
      {
        id: crypto.randomUUID(),
        name: nameForPlace(s, useAppStore.getState().dealerships),
        address: s.label,
        lat: s.lat,
        lon: s.lon,
      },
    ]);
    setValue("");
    setSuggestions([]);
    onDone();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onDone();
    } else if (e.key === "ArrowDown" && suggestions.length > 0) {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length > 0) {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" && suggestions.length > 0) {
      e.preventDefault();
      pick(suggestions[Math.min(active, suggestions.length - 1)]);
    }
  }

  const noMatches =
    !loading &&
    !error &&
    !onlineUnavailable &&
    answeredFor === trimmed &&
    trimmed.length >= MIN_CHARS &&
    suggestions.length === 0;

  return (
    <div>
      <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 focus-within:ring-[3px] focus-within:ring-ring/50">
        <MapPin className="size-4 shrink-0 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={value}
          placeholder={t("map.locationsPanel.addressPlaceholder")}
          className="h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t("map.locationsPanel.addAddress")}
          aria-keyshortcuts="Escape"
        />
        {loading && (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {t("map.locationsPanel.searchFailed")}
          <span className="block text-muted-foreground">
            {t("map.locationsPanel.searchFailedHint")}
          </span>
        </p>
      )}
      {onlineUnavailable && answeredFor === trimmed && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {t(
            suggestions.length > 0
              ? "places.onlineUnavailable"
              : "places.onlineUnavailableNoLocal",
          )}
        </p>
      )}
      {noMatches && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {t("ui.noMatches")}
        </p>
      )}
      {directoryStatus === null && trimmed.length >= MIN_CHARS && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("map.locationsPanel.directoryHintPrefix")}{" "}
          <Link to="/settings" className="underline underline-offset-2">
            {t("map.locationsPanel.directoryHintLink")}
          </Link>
        </p>
      )}
      {directoryUpdate?.updateAvailable && trimmed.length >= MIN_CHARS && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("places.updateAvailable", {
            release: directoryUpdate.latestRelease,
          })}{" "}
          <Link to="/settings" className="underline underline-offset-2">
            {t("places.updateLink")}
          </Link>
        </p>
      )}
      {suggestions.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-auto rounded-md border bg-popover py-1">
          {suggestions.map((s, i) => (
            <li key={`${s.lat},${s.lon},${i}`}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent",
                  FOCUS_RING_INSET,
                  i === active && "bg-accent",
                )}
                onClick={() => pick(s)}
                onMouseEnter={() => setActive(i)}
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                  <span>{s.label}</span>
                  <PlacePortfolioBadge portfolio={s.portfolio} />
                  <PlaceApproximateNote approximate={s.approximate} />
                </span>
                <PlaceSourceTag source={s.source} sources={s.sources} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
