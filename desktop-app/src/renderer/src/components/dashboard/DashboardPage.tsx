import { exportLocale } from "@renderer/lib/format";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  ClipboardCheck,
  Download,
  GitCompare,
  ArrowDown,
  ArrowUp,
  GripVertical,
  History,
  LayoutGrid,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  RotateCcw,
  Save,
  Sparkles,
  Settings2,
  TriangleAlert,
  X,
} from "lucide-react";
import { notify } from "@renderer/lib/notify";
import type { AccumulationCluster, AnalyzedDealership } from "@shared/types";
import { EmptyState } from "@renderer/components/common/EmptyState";
import { Alert, AlertTitle } from "@renderer/components/ui/alert";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
import { AI_SETTINGS_PATH } from "@renderer/components/ai/LlmSetupNotice";
import { useLlmReady } from "@renderer/lib/useLlmReady";
import { usePortfolioImport } from "@renderer/components/upload/PortfolioImportDialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import {
  ComparisonView,
  useSaveSnapshot,
} from "@renderer/components/dashboard/ComparisonView";
import {
  AccumulationClusterTable,
  largestAccumulations,
} from "@renderer/components/dashboard/AccumulationClusterTable";
import { DashboardAssistant } from "@renderer/components/dashboard/DashboardAssistant";
import { DealershipDetailDialog } from "@renderer/components/dashboard/DealershipDetailDialog";
import { DealershipTable } from "@renderer/components/dashboard/DealershipTable";
import { AsIfHistoryPanel } from "@renderer/components/dashboard/AsIfHistoryPanel";
import { HailZoneDistribution } from "@renderer/components/dashboard/HailZoneDistribution";
import { InsightsPanel } from "@renderer/components/dashboard/InsightsPanel";
import { ChangeReportPanel } from "@renderer/components/dashboard/ChangeReportPanel";
import { ModelVersionBanner } from "@renderer/components/dashboard/ModelVersionBanner";
import { PortfolioFilterBar } from "@renderer/components/dashboard/PortfolioFilterBar";
import { SummaryCards } from "@renderer/components/dashboard/SummaryCards";
import { TopLocationsChart } from "@renderer/components/dashboard/TopLocationsChart";
import { useAppStore } from "@renderer/store/appStore";
import { useMapStore } from "@renderer/store/mapStore";
import { useFilteredDealerships } from "@renderer/lib/useFilteredDealerships";
import { useReviewRun } from "./useReviewRun";
import { DataCompletenessBanner } from "./DataCompletenessBanner";
import { ealCoverage } from "@shared/estimates";
import { useStockCount } from "./useStockCount";
import { A2uiSurfaceView } from "./a2ui/A2uiSurfaceView";
import type { A2uiSurface } from "@shared/a2ui";
import { dropComponent, shiftComponent } from "@shared/a2ui-layout";
import {
  DashboardTabPanel,
  DashboardTabs,
  DashboardTabsRoot,
} from "./a2ui/DashboardTabs";
import {
  rememberedDashboardId,
  useDashboardStore,
} from "@renderer/store/dashboardStore";
import {
  DEFAULT_TILE_ORDER,
  TILE_DEFINITIONS,
  applyDashboardCommand,
  type DashboardTileId,
  moveDashboardTile,
  tileSpans,
  parseDashboardCommand,
  parseTileLayout,
  serializeTileLayout,
} from "./dashboardTiles";

// v3: hail-focused layout. Bumped so stored v2 layouts (PML, coverage,
// seasonal tiles) do not carry over.
const TILE_STORAGE_KEY = "dealership-risk-dashboard-tiles-v3";

/** Stored layout; hidden tiles stay hidden (see `parseTileLayout`). */
function readTileOrder(): DashboardTileId[] {
  try {
    return parseTileLayout(window.localStorage.getItem(TILE_STORAGE_KEY));
  } catch {
    return DEFAULT_TILE_ORDER;
  }
}

export function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dealerships = useAppStore((s) => s.dealerships);
  const nlQueryMatchedIds = useAppStore((s) => s.nlQueryMatchedIds);
  const select = useAppStore((s) => s.select);
  const setFilters = useAppStore((s) => s.setFilters);
  const focusDealerships = useAppStore((s) => s.focusDealerships);
  // Opened only by an explicit row/card click (`onSelect` below) — never
  // derived from the shared `selectedId`, which other actions (e.g. adding
  // a single address) set for the map's fly-to behavior and would otherwise
  // pop this dialog open the moment the Dashboard mounts. Only the id is
  // kept so edits made in the dialog (notes, website, …) show up live.
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useMemo(
    () => dealerships.find((d) => d.id === detailId) ?? null,
    [dealerships, detailId],
  );
  const [tileOrder, setTileOrder] = useState<DashboardTileId[]>(readTileOrder);
  const [draggedTile, setDraggedTile] = useState<DashboardTileId | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const llmReady = useLlmReady();
  // The empty state's "Portfolio importieren" opens the file picker and the
  // shared import dialog; afterwards the map shows the analysis running.
  const importInputRef = useRef<HTMLInputElement>(null);
  const { startImport, dialog: importDialog } = usePortfolioImport(
    () => void navigate("/"),
  );
  // The table's sorted, searched order: the dialog's arrows follow it.
  const [tableOrder, setTableOrder] = useState<string[] | undefined>();
  const onTableOrder = useCallback((ids: string[]) => setTableOrder(ids), []);
  const aiDashboard = useDashboardStore((s) => s.active);
  const building = useDashboardStore((s) => s.building);
  const arrange = useDashboardStore((s) => s.arrange);
  // A different dashboard starts at its top, not where the last one was.
  const scrollRef = useRef<HTMLDivElement>(null);
  const aiDashboardId = aiDashboard?.id ?? null;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [aiDashboardId]);
  /** Sentence start put into the assistant's composer. */
  const [chatDraft, setChatDraft] = useState<
    { text: string; key: number } | undefined
  >(undefined);
  function openAssistantWith(text: string): void {
    // Without an AI provider a prefilled prompt leads nowhere: the
    // dashboard is built by the model.
    if (llmReady === false) {
      notify.info(t("a2ui.needsAi"), {
        description: t("a2ui.needsAiHint"),
        action: {
          label: t("aiSetup.openSettings"),
          onClick: () => navigate(AI_SETTINGS_PATH),
        },
      });
      return;
    }
    setAssistantOpen(true);
    setChatDraft({ text, key: Date.now() });
  }

  // Saved AI dashboards, and the one shown last time.
  useEffect(() => {
    const store = useDashboardStore.getState();
    void store.loadList().catch(() => undefined);
    const remembered = rememberedDashboardId();
    if (!store.active && remembered)
      void store.open(remembered).catch(() => undefined);
  }, []);
  const reviewRun = useReviewRun({
    openLocation: (id) => {
      setDetailId(id);
      select(id);
    },
    closeDialog: () => {
      setDetailId(null);
      select(null);
    },
  });

  const filtered = useFilteredDealerships(dealerships);
  const analyzedCount = useMemo(
    () => dealerships.filter((d) => d.risk).length,
    [dealerships],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        TILE_STORAGE_KEY,
        serializeTileLayout(tileOrder),
      );
    } catch {
      // Storage unavailable: the layout lasts for this visit only.
    }
  }, [tileOrder]);
  const parameters = useAppStore((s) => s.parameters);
  // No accumulations: the KPI already says "none", so the empty tile is left
  // out instead of repeating it.
  const hasAccumulations = useMemo(
    () => largestAccumulations(filtered, parameters).length > 0,
    [filtered, parameters],
  );
  const visibleTiles = tileOrder.filter(
    (id) => id !== "clusters" || hasAccumulations,
  );
  const spans = tileSpans(visibleTiles);

  const tileLabels = useMemo(
    () => new Map(TILE_DEFINITIONS.map((tile) => [tile.id, t(tile.labelKey)])),
    [t],
  );

  function showOnMap(d: AnalyzedDealership): void {
    select(d.id);
    navigate("/map");
  }

  function showAccumulationOnMap(cluster: AccumulationCluster): void {
    setFilters({ clusterId: cluster.clusterId });
    showLocationsOnMap(cluster.memberIds);
  }

  function showLocationsOnMap(ids: string[]): void {
    useMapStore.getState().setLayers({ accumulationClusters: true });
    focusDealerships(
      ids,
      useAppStore.getState().parameters.accumulationRadiusKm,
    );
    navigate("/map");
  }

  function toggleTile(id: DashboardTileId, checked: boolean): void {
    setTileOrder((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((tile) => tile !== id);
    });
  }

  function resetTiles(): void {
    setTileOrder(DEFAULT_TILE_ORDER);
  }

  function moveTile(target: DashboardTileId): void {
    if (!draggedTile || draggedTile === target) return;
    setTileOrder((current) => moveDashboardTile(current, draggedTile, target));
    setDraggedTile(null);
  }

  /** Stores a rearranged AI dashboard; null means the move is not allowed. */
  function arrangeSurface(next: A2uiSurface | null): void {
    if (!next) {
      notify.info(t("a2ui.moveRefused"), {
        description: t("a2ui.moveRefusedHint"),
      });
      return;
    }
    if (next === aiDashboard?.surface) return;
    void arrange(next).catch(() => notify.error(t("a2ui.arrangeFailed")));
  }

  /**
   * Moves a tile one place among the visible tiles: the keyboard and
   * single-click way to reorder, next to drag and drop (WCAG 2.1.1, 2.5.7).
   */
  function shiftTile(id: DashboardTileId, step: -1 | 1): void {
    const neighbour = visibleTiles[visibleTiles.indexOf(id) + step];
    if (!neighbour) return;
    setTileOrder((current) => moveDashboardTile(current, id, neighbour));
  }

  function handleDashboardCommand(prompt: string): string | null {
    const command = parseDashboardCommand(prompt);
    if (!command) return null;
    if (command.action === "reset") {
      resetTiles();
      return t("dashboard.commandReset");
    }
    const changed = command.ids.filter((id) =>
      command.action === "show"
        ? !tileOrder.includes(id)
        : tileOrder.includes(id),
    );
    setTileOrder((current) => applyDashboardCommand(current, command));
    const labels = command.ids.map((id) => tileLabels.get(id) ?? id).join(", ");
    // "Hinzugefügt" for a tile that was already there would be wrong.
    if (changed.length === 0)
      return t(
        command.action === "show"
          ? "dashboard.commandAlreadyShown"
          : "dashboard.commandAlreadyHidden",
        { tiles: labels },
      );
    return t(
      command.action === "show"
        ? "dashboard.commandAdded"
        : "dashboard.commandRemoved",
      { tiles: labels },
    );
  }

  if (dealerships.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <input
          ref={importInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void startImport(file);
          }}
        />
        <EmptyState
          icon={BarChart3}
          title={t("ui.noAnalysis")}
          description={t("ui.importDescription")}
          action={
            <Button onClick={() => importInputRef.current?.click()}>
              {t("ui.importPortfolio")}
            </Button>
          }
        />
        {importDialog}
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0">
      <DashboardTabsRoot>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b px-4 py-3 sm:px-6 lg:px-8">
            {/* The portfolio name is in the app header's switcher; this row
              only adds the analysis state and the page actions. */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">
                  {filtered.length !== dealerships.length
                    ? t("ui.locationsFiltered", {
                        filtered: filtered.length,
                        total: dealerships.length,
                      })
                    : analyzedCount < dealerships.length
                      ? t("ui.locationsPartlyAnalyzed", {
                          analyzed: analyzedCount,
                          total: dealerships.length,
                          pending: dealerships.length - analyzedCount,
                        })
                      : t("ui.locationsAnalyzed", {
                          count: dealerships.length,
                        })}
                </p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {/* The page's main action while points are open. */}
                <Button
                  variant={
                    (reviewRun.openCount ?? 0) > 0 ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => reviewRun.start()}
                  disabled={reviewRun.openCount === 0}
                >
                  <ClipboardCheck />
                  {reviewRun.openCount == null
                    ? t("review.start")
                    : t("review.startCount", { count: reviewRun.openCount })}
                </Button>
                {llmReady && (reviewRun.openCount ?? 0) > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void reviewRun.startWithAiOrder()}
                    disabled={reviewRun.planning}
                    title={t("review.aiOrderHint")}
                  >
                    {reviewRun.planning ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Sparkles />
                    )}
                    {t("review.aiOrder")}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAssistantOpen((open) => !open)}
                  aria-pressed={assistantOpen}
                >
                  <MessageSquare /> {t("dashboard.openAssistant")}
                </Button>
                {/* With the assistant open the page is narrower: fold. */}
                <Actions compact={assistantOpen} />
              </div>
            </div>
            <div className="mt-3">
              <DashboardTabs
                onNew={() => openAssistantWith(t("a2ui.newDraft"))}
                onChange={() => openAssistantWith(t("a2ui.changeDraft"))}
                trailing={
                  aiDashboard ? undefined : (
                    <TileMenu
                      tileOrder={tileOrder}
                      tileLabels={tileLabels}
                      onToggle={toggleTile}
                      onReset={resetTiles}
                    />
                  )
                }
              />
            </div>
          </header>

          {/* Not a <main>: the app shell already provides the page's main
            landmark, and landmarks must not nest. */}
          <div
            ref={scrollRef}
            className="@container min-h-0 flex-1 overflow-y-auto"
          >
            <DashboardTabPanel className="mt-0 space-y-5 p-4 sm:p-6 lg:p-8">
              <ModelVersionBanner dealerships={dealerships} />
              <DataCompletenessBanner
                dealerships={dealerships}
                openReviews={reviewRun.openCount}
                onReview={() => reviewRun.start()}
              />
              <PortfolioFilterBar dealerships={dealerships} />
              {building && (
                <Alert variant="info" busy>
                  <AlertTitle>
                    {aiDashboard ? t("a2ui.updating") : t("a2ui.building")}
                  </AlertTitle>
                </Alert>
              )}
              {aiDashboard ? (
                <section
                  aria-label={aiDashboard.name}
                  className={
                    building
                      ? "space-y-4 opacity-60 transition-opacity"
                      : "space-y-4 transition-opacity"
                  }
                >
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    <Sparkles className="mr-1 inline size-3.5 text-primary" />
                    {requestLine(t, aiDashboard.prompt)}
                  </p>
                  <A2uiSurfaceView
                    surface={aiDashboard.surface}
                    dealerships={filtered}
                    onOpenLocation={(id) => {
                      setDetailId(id);
                      select(id);
                    }}
                    onMove={
                      building
                        ? undefined
                        : (dragged, target) =>
                            arrangeSurface(
                              dropComponent(
                                aiDashboard.surface,
                                dragged,
                                target,
                              ),
                            )
                    }
                    onShift={
                      building
                        ? undefined
                        : (id, step) =>
                            arrangeSurface(
                              shiftComponent(aiDashboard.surface, id, step),
                            )
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("a2ui.provenance")}
                  </p>
                </section>
              ) : visibleTiles.length === 0 ? (
                <EmptyState
                  icon={LayoutGrid}
                  title={t("dashboard.noTilesTitle")}
                  description={t("dashboard.noTilesDescription")}
                  action={
                    <Button onClick={resetTiles}>
                      {t("dashboard.resetTiles")}
                    </Button>
                  }
                />
              ) : (
                // Tiles in a row share its height, so a short tile next to a
                // tall one leaves no gap below it.
                <div className="grid grid-cols-1 gap-x-4 gap-y-6 @3xl:grid-cols-2 @5xl:grid-cols-3">
                  {visibleTiles.map((id, index) => (
                    <DashboardTile
                      key={id}
                      id={id}
                      span={spans.get(id) ?? ""}
                      label={tileLabels.get(id) ?? id}
                      dragged={draggedTile === id}
                      onDragStart={() => setDraggedTile(id)}
                      onDragEnd={() => setDraggedTile(null)}
                      onDrop={() => moveTile(id)}
                      onShift={(step) => shiftTile(id, step)}
                      first={index === 0}
                      last={index === visibleTiles.length - 1}
                      onRemove={() => toggleTile(id, false)}
                      t={t}
                    >
                      {renderTile(id, {
                        filtered,
                        dealerships,
                        onSelect: (d: AnalyzedDealership) => setDetailId(d.id),
                        onShowOnMap: showOnMap,
                        onShowAccumulation: showAccumulationOnMap,
                        onShowLocations: showLocationsOnMap,
                        onTableOrder,
                        highlightIds: nlQueryMatchedIds,
                      })}
                    </DashboardTile>
                  ))}
                </div>
              )}
            </DashboardTabPanel>
          </div>
        </div>
      </DashboardTabsRoot>

      {/* Beside the tiles only from 1280 px; narrower windows overlay it, so
          the table keeps its key columns. */}
      {assistantOpen && (
        <div className="absolute inset-y-0 right-0 z-30 flex w-96 max-w-full border-l bg-background shadow-2xl xl:static xl:shrink-0 xl:shadow-none">
          <DashboardAssistant
            draft={chatDraft}
            onClose={() => setAssistantOpen(false)}
            onDashboardCommand={
              aiDashboard ? undefined : handleDashboardCommand
            }
            onOpenLocation={(id) => setDetailId(id)}
          />
        </div>
      )}

      <DealershipDetailDialog
        dealership={detail}
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailId(null);
            select(null);
            reviewRun.stop();
          }
        }}
        onNavigate={(id) => {
          setDetailId(id);
          select(id);
        }}
        order={tableOrder}
        review={reviewRun.review}
      />
      {/* Stays mounted when the import fills the empty portfolio. */}
      {importDialog}
    </div>
  );
}

/** "Erstellt aus „…“", plus the latest change when there was one. */
function requestLine(t: TFunction, prompt: string): string {
  const requests = prompt.split("\n").filter((line) => line.trim());
  const first = requests[0] ?? "";
  const last = requests[requests.length - 1] ?? "";
  return requests.length > 1
    ? t("a2ui.builtFromChanged", { first, last })
    : t("a2ui.builtFrom", { prompt: first });
}

function renderTile(
  id: DashboardTileId,
  props: {
    filtered: AnalyzedDealership[];
    dealerships: AnalyzedDealership[];
    onSelect: (d: AnalyzedDealership) => void;
    onShowOnMap: (d: AnalyzedDealership) => void;
    onShowAccumulation: (cluster: AccumulationCluster) => void;
    onShowLocations: (ids: string[]) => void;
    onTableOrder: (ids: string[]) => void;
    highlightIds: string[] | null;
  },
): React.JSX.Element {
  switch (id) {
    case "summary":
      return <SummaryCards dealerships={props.filtered} />;
    case "clusters":
      return (
        <AccumulationClusterTable
          dealerships={props.filtered}
          onSelect={props.onSelect}
          onShowOnMap={props.onShowAccumulation}
        />
      );
    case "asIf":
      return (
        <AsIfHistoryPanel
          dealerships={props.filtered}
          onSelect={props.onSelect}
        />
      );
    case "zones":
      return <HailZoneDistribution dealerships={props.filtered} />;
    case "topLocations":
      return (
        <TopLocationsChart
          dealerships={props.filtered}
          onSelect={props.onSelect}
          onShowOnMap={props.onShowOnMap}
        />
      );
    case "insights":
      return (
        <InsightsPanel
          dealerships={props.filtered}
          onSelect={props.onSelect}
          onShowAccumulation={props.onShowLocations}
        />
      );
    case "changes":
      return (
        <ChangeReportPanel
          dealerships={props.filtered}
          onSelect={props.onSelect}
        />
      );
    case "table":
      return (
        <DealershipTable
          dealerships={props.filtered}
          onSelect={props.onSelect}
          onShowOnMap={props.onShowOnMap}
          onOrderChange={props.onTableOrder}
          highlightIds={props.highlightIds}
        />
      );
  }
}

function DashboardTile({
  span,
  label,
  dragged,
  onDragStart,
  onDragEnd,
  onDrop,
  onShift,
  first,
  last,
  onRemove,
  t,
  children,
}: Readonly<{
  id: DashboardTileId;
  span: string;
  label: string;
  dragged: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  /** Moves the tile one place earlier (-1) or later (1). */
  onShift: (step: -1 | 1) => void;
  first: boolean;
  last: boolean;
  onRemove: () => void;
  t: (key: string) => string;
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <section
      className={`group relative flex min-w-0 flex-col [&>:last-child]:flex-1 ${span} ${dragged ? "opacity-50" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      aria-label={label}
    >
      {/* Sits in the gap above the tile, not inside it, so it covers
          neither the tile title nor the KPI icons. Transparent rather than
          invisible while idle: the remove button stays reachable with Tab
          and the toolbar shows as soon as it has keyboard focus. */}
      <div className="pointer-events-none absolute -top-5 right-3 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <span
          aria-hidden
          className="pointer-events-auto cursor-grab rounded-md border bg-background p-0.5 text-muted-foreground shadow-sm"
        >
          <GripVertical className="size-4" />
        </span>
        <HintButton
          type="button"
          variant="outline"
          size="icon"
          className="pointer-events-auto size-6 bg-background"
          onClick={() => onShift(-1)}
          disabled={first}
          aria-label={`${t("dashboard.moveTileEarlier")}: ${label}`}
        >
          <ArrowUp className="size-3.5" />
        </HintButton>
        <HintButton
          type="button"
          variant="outline"
          size="icon"
          className="pointer-events-auto size-6 bg-background"
          onClick={() => onShift(1)}
          disabled={last}
          aria-label={`${t("dashboard.moveTileLater")}: ${label}`}
        >
          <ArrowDown className="size-3.5" />
        </HintButton>
        <HintButton
          type="button"
          variant="outline"
          size="icon"
          className="pointer-events-auto size-6 bg-background"
          onClick={onRemove}
          aria-label={`${t("dashboard.removeTile")}: ${label}`}
        >
          <X className="size-3.5" />
        </HintButton>
      </div>
      {children}
    </section>
  );
}

function TileMenu({
  tileOrder,
  tileLabels,
  onToggle,
  onReset,
}: Readonly<{
  tileOrder: DashboardTileId[];
  tileLabels: Map<DashboardTileId, string>;
  onToggle: (id: DashboardTileId, checked: boolean) => void;
  onReset: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings2 /> {t("dashboard.manageTiles")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t("dashboard.visibleTiles")}</DropdownMenuLabel>
        {TILE_DEFINITIONS.map((tile) => (
          <DropdownMenuCheckboxItem
            key={tile.id}
            checked={tileOrder.includes(tile.id)}
            onCheckedChange={(checked) => onToggle(tile.id, checked)}
            // Keep the menu open so several tiles can be toggled in a row.
            onSelect={(event) => event.preventDefault()}
          >
            {tileLabels.get(tile.id)}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReset}>
          <RotateCcw /> {t("dashboard.resetTiles")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Compare, snapshot and export. The portfolio autosaves, so there is no
 * "Save": "Stand speichern" keeps a copy as a comparison point. From 1280 px
 * they are buttons; narrower windows (or an open assistant) fold them into
 * one "…" menu, so the header stays one row.
 */
function Actions({
  compact,
}: Readonly<{ compact: boolean }>): React.JSX.Element {
  const { t } = useTranslation();
  const [compareOpen, setCompareOpen] = useState(false);
  const snapshot = useSaveSnapshot();
  const stockCount = useStockCount();

  async function exportReport(format: "csv" | "pdf" | "excel"): Promise<void> {
    try {
      const { path } = await window.api.exportReport(
        useAppStore.getState().currentSession(),
        format,
        exportLocale(),
      );
      if (path) notify.exported("ui.reportExported", path);
    } catch (err) {
      notify.error(t("ui.exportFailed"), { cause: err });
    }
  }

  async function exportReadonly(): Promise<void> {
    try {
      const { path } = await window.api.exportReadonlyView(
        useAppStore.getState().currentSession(),
        exportLocale(),
      );
      if (path) notify.exported("ui.viewExported", path);
    } catch (err) {
      notify.error(t("ui.exportFailed"), { cause: err });
    }
  }

  async function exportFile(): Promise<void> {
    try {
      const { path } = await window.api.exportPortfolioFile(
        useAppStore.getState().currentSession(),
        exportLocale(),
      );
      if (path) notify.exported("ui.portfolioExported", path);
    } catch (err) {
      notify.error(t("ui.exportFailed"), { cause: err });
    }
  }

  const exportItems = (
    <>
      <DropdownMenuItem onClick={() => exportReport("pdf")}>
        {t("ui.pdfReport")}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => exportReport("excel")}>
        {t("ui.excelReport")}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => exportReport("csv")}>
        {t("ui.csvReport")}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={exportReadonly}>
        {t("ui.readonlyView")}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={exportFile}>
        {t("ui.portfolioFile")}
      </DropdownMenuItem>
    </>
  );

  // Rarely used actions share one menu; review and export stay buttons
  // (UX review, November 2026: six buttons in a row hid the main step).
  const moreItems = (
    <>
      <DropdownMenuItem onSelect={() => setCompareOpen(true)}>
        <GitCompare /> {t("ui.compare")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={stockCount.running || stockCount.available === false}
        onSelect={stockCount.start}
      >
        {stockCount.running ? (
          <Loader2 className="animate-spin" />
        ) : (
          <History />
        )}
        <span className="flex flex-col">
          {t("dashboard.stockCount.button")}
          <span className="text-xs text-muted-foreground">
            {stockCount.available === false
              ? t("dashboard.stockCount.needsModel")
              : t("dashboard.stockCount.hint")}
          </span>
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={snapshot.saving}
        onSelect={() => void snapshot.save()}
      >
        {snapshot.saving ? <Loader2 className="animate-spin" /> : <Save />}
        {t("ui.saveSnapshot")}
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      <div className={compact ? "hidden" : "hidden items-center gap-2 lg:flex"}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download /> {t("common.export")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <ExportPrecheck />
            {exportItems}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <HintButton
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={t("ui.moreActions")}
          >
            <MoreHorizontal />
          </HintButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {moreItems}
          <div className={compact ? "" : "lg:hidden"}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("common.export")}</DropdownMenuLabel>
            <ExportPrecheck />
            {exportItems}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <ComparisonView open={compareOpen} onOpenChange={setCompareOpen} />
    </>
  );
}

/**
 * Before a report leaves the app: what in it is still provisional. The
 * export is not blocked; the report marks the same points.
 */
function ExportPrecheck(): React.JSX.Element | null {
  const { t } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const { withBasis, analyzed } = ealCoverage(dealerships);
  const boundaries = dealerships.filter(
    (d) => d.boundary?.reviewRequired,
  ).length;
  const missing = analyzed - withBasis;
  if (missing === 0 && boundaries === 0) return null;
  return (
    <>
      <div className="flex items-start gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <span>
          {[
            missing > 0 &&
              t("dashboard.exportPrecheck.noCount", { count: missing }),
            boundaries > 0 &&
              t("dashboard.exportPrecheck.boundaries", { count: boundaries }),
          ]
            .filter(Boolean)
            .join(" · ")}
          {" – "}
          {t("dashboard.exportPrecheck.marked")}
        </span>
      </div>
      <DropdownMenuSeparator />
    </>
  );
}
