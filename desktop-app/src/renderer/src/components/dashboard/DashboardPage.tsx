import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  Download,
  GripVertical,
  LayoutGrid,
  Loader2,
  MessageSquare,
  RotateCcw,
  Save,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { AccumulationCluster, AnalyzedDealership } from "@shared/types";
import { EmptyState } from "@renderer/components/common/EmptyState";
import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { ComparisonView } from "@renderer/components/dashboard/ComparisonView";
import { AccumulationClusterTable } from "@renderer/components/dashboard/AccumulationClusterTable";
import { DashboardAssistant } from "@renderer/components/dashboard/DashboardAssistant";
import { DealershipDetailDialog } from "@renderer/components/dashboard/DealershipDetailDialog";
import { DealershipTable } from "@renderer/components/dashboard/DealershipTable";
import { HailZoneDistribution } from "@renderer/components/dashboard/HailZoneDistribution";
import { InsightsPanel } from "@renderer/components/dashboard/InsightsPanel";
import { ModelVersionBanner } from "@renderer/components/dashboard/ModelVersionBanner";
import { PortfolioFilterBar } from "@renderer/components/dashboard/PortfolioFilterBar";
import { SummaryCards } from "@renderer/components/dashboard/SummaryCards";
import { TopLocationsChart } from "@renderer/components/dashboard/TopLocationsChart";
import { useAppStore } from "@renderer/store/appStore";
import { useMapStore } from "@renderer/store/mapStore";
import { useFilteredDealerships } from "@renderer/lib/useFilteredDealerships";
import {
  DEFAULT_TILE_ORDER,
  TILE_DEFINITIONS,
  applyDashboardCommand,
  type DashboardTileId,
  moveDashboardTile,
  parseDashboardCommand,
} from "./dashboardTiles";

// v3: hail-focused layout. Bumped so stored v2 layouts (PML, coverage,
// seasonal tiles) do not carry over.
const TILE_STORAGE_KEY = "dealership-risk-dashboard-tiles-v3";

function readTileOrder(): DashboardTileId[] {
  if (typeof window === "undefined") return DEFAULT_TILE_ORDER;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(TILE_STORAGE_KEY) ?? "null",
    ) as unknown;
    if (!Array.isArray(stored)) return DEFAULT_TILE_ORDER;
    const known = new Set<DashboardTileId>(DEFAULT_TILE_ORDER);
    const valid = stored.filter(
      (id): id is DashboardTileId =>
        typeof id === "string" && known.has(id as DashboardTileId),
    );
    return [
      ...new Set(valid),
      ...DEFAULT_TILE_ORDER.filter((id) => !valid.includes(id)),
    ];
  } catch {
    return DEFAULT_TILE_ORDER;
  }
}

export function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dealerships = useAppStore((s) => s.dealerships);
  const sessionName = useAppStore((s) => s.sessionName);
  const nlQueryMatchedIds = useAppStore((s) => s.nlQueryMatchedIds);
  const select = useAppStore((s) => s.select);
  const setFilters = useAppStore((s) => s.setFilters);
  const focusDealerships = useAppStore((s) => s.focusDealerships);
  // Opened only by an explicit row/card click (`onSelect` below) — never
  // derived from the shared `selectedId`, which other actions (e.g. adding
  // a single address) set for the map's fly-to behavior and would otherwise
  // pop this dialog open the moment the Dashboard mounts.
  const [detail, setDetail] = useState<AnalyzedDealership | null>(null);
  const [tileOrder, setTileOrder] = useState<DashboardTileId[]>(readTileOrder);
  const [draggedTile, setDraggedTile] = useState<DashboardTileId | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const filtered = useFilteredDealerships(dealerships);

  useEffect(() => {
    window.localStorage.setItem(TILE_STORAGE_KEY, JSON.stringify(tileOrder));
  }, [tileOrder]);

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

  function handleDashboardCommand(prompt: string): string | null {
    const command = parseDashboardCommand(prompt);
    if (!command) return null;
    if (command.action === "reset") {
      resetTiles();
      return t("dashboard.commandReset");
    }
    setTileOrder((current) => applyDashboardCommand(current, command));
    const labels = command.ids.map((id) => tileLabels.get(id) ?? id).join(", ");
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
        <EmptyState
          icon={BarChart3}
          title={t("ui.noAnalysis")}
          description={t("ui.importDescription")}
          action={
            <Button onClick={() => navigate("/")}>
              {t("ui.importPortfolio")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-semibold">{sessionName}</h2>
              <p className="text-sm text-muted-foreground">
                {filtered.length === dealerships.length
                  ? t("ui.locationsAnalyzed", { count: dealerships.length })
                  : t("ui.locationsFiltered", {
                      filtered: filtered.length,
                      total: dealerships.length,
                    })}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAssistantOpen((open) => !open)}
                aria-pressed={assistantOpen}
              >
                <MessageSquare /> {t("dashboard.openAssistant")}
              </Button>
              <TileMenu
                tileOrder={tileOrder}
                tileLabels={tileLabels}
                onToggle={toggleTile}
                onReset={resetTiles}
              />
              <Actions />
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 p-4 sm:p-6 lg:p-8">
            <ModelVersionBanner dealerships={dealerships} />
            <PortfolioFilterBar dealerships={dealerships} />
            {tileOrder.length === 0 ? (
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
              <div
                className={`grid grid-cols-1 items-start gap-4 lg:grid-cols-2 ${
                  assistantOpen ? "2xl:grid-cols-2" : "xl:grid-cols-3"
                }`}
              >
                {tileOrder.map((id) => (
                  <DashboardTile
                    key={id}
                    id={id}
                    label={tileLabels.get(id) ?? id}
                    dragged={draggedTile === id}
                    compact={assistantOpen}
                    onDragStart={() => setDraggedTile(id)}
                    onDragEnd={() => setDraggedTile(null)}
                    onDrop={() => moveTile(id)}
                    onRemove={() => toggleTile(id, false)}
                    t={t}
                  >
                    {renderTile(id, {
                      filtered,
                      dealerships,
                      onSelect: setDetail,
                      onShowOnMap: showOnMap,
                      onShowAccumulation: showAccumulationOnMap,
                      onShowLocations: showLocationsOnMap,
                      highlightIds: nlQueryMatchedIds,
                    })}
                  </DashboardTile>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {assistantOpen && (
        <div className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md shadow-2xl 2xl:static 2xl:w-96 2xl:max-w-none 2xl:shadow-none">
          <DashboardAssistant
            onClose={() => setAssistantOpen(false)}
            onDashboardCommand={handleDashboardCommand}
          />
        </div>
      )}

      <DealershipDetailDialog
        dealership={detail}
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null);
            select(null);
          }
        }}
      />
    </div>
  );
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
    highlightIds: string[] | null;
  },
): React.JSX.Element {
  switch (id) {
    case "summary":
      return <SummaryCards dealerships={props.filtered} />;
    case "clusters":
      return (
        <AccumulationClusterTable
          dealerships={props.dealerships}
          onSelect={props.onSelect}
          onShowOnMap={props.onShowAccumulation}
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
    case "table":
      return (
        <DealershipTable
          dealerships={props.filtered}
          onSelect={props.onSelect}
          onShowOnMap={props.onShowOnMap}
          highlightIds={props.highlightIds}
        />
      );
  }
}

function tileSpan(id: DashboardTileId, compact: boolean): string {
  if (compact) {
    return id === "zones" || id === "topLocations"
      ? "lg:col-span-1"
      : "lg:col-span-2";
  }
  if (id === "summary" || id === "clusters" || id === "table") {
    return "lg:col-span-2 xl:col-span-3";
  }
  return "lg:col-span-1 xl:col-span-1";
}

function DashboardTile({
  id,
  label,
  dragged,
  compact,
  onDragStart,
  onDragEnd,
  onDrop,
  onRemove,
  t,
  children,
}: Readonly<{
  id: DashboardTileId;
  label: string;
  dragged: boolean;
  compact: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onRemove: () => void;
  t: (key: string) => string;
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <section
      className={`group relative min-w-0 ${tileSpan(id, compact)} ${dragged ? "opacity-50" : ""}`}
      draggable
      tabIndex={0}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      aria-label={label}
    >
      <div className="pointer-events-none invisible absolute right-2 top-2 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <span
          className="pointer-events-auto rounded-md border bg-background/95 p-1 text-muted-foreground shadow-sm"
          title={t("dashboard.dragTile")}
        >
          <GripVertical className="size-4" />
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="pointer-events-auto size-7 bg-background/95"
          onClick={onRemove}
          title={t("dashboard.removeTile")}
          aria-label={`${t("dashboard.removeTile")}: ${label}`}
        >
          <X className="size-3.5" />
        </Button>
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
        <Button variant="outline" size="sm">
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

function Actions(): React.JSX.Element {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await useAppStore.getState().saveSession();
      toast.success(t("ui.portfolioSaved"));
    } catch (err) {
      toast.error(t("ui.saveFailed", { error: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  async function exportReport(format: "csv" | "pdf" | "excel"): Promise<void> {
    try {
      const { path } = await window.api.exportReport(
        useAppStore.getState().currentSession(),
        format,
      );
      if (path) toast.success(t("ui.reportExported", { path }));
    } catch (err) {
      toast.error(t("ui.exportFailed", { error: (err as Error).message }));
    }
  }

  async function exportReadonly(): Promise<void> {
    try {
      const { path } = await window.api.exportReadonlyView(
        useAppStore.getState().currentSession(),
      );
      if (path) toast.success(t("ui.viewExported", { path }));
    } catch (err) {
      toast.error(t("ui.exportFailed", { error: (err as Error).message }));
    }
  }

  async function exportFile(): Promise<void> {
    try {
      const { path } = await window.api.exportPortfolioFile(
        useAppStore.getState().currentSession(),
      );
      if (path) toast.success(t("ui.portfolioExported", { path }));
    } catch (err) {
      toast.error(t("ui.exportFailed", { error: (err as Error).message }));
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <ComparisonView />
      <Button variant="outline" size="sm" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="animate-spin" /> : <Save />}{" "}
        {t("common.save")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Download /> {t("common.export")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
