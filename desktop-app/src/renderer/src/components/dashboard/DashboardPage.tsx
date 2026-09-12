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
import type { AnalyzedDealership } from "@shared/types";
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
import { CoverageCard } from "@renderer/components/dashboard/CoverageCard";
import { DashboardAssistant } from "@renderer/components/dashboard/DashboardAssistant";
import { DealershipDetailDialog } from "@renderer/components/dashboard/DealershipDetailDialog";
import { DealershipTable } from "@renderer/components/dashboard/DealershipTable";
import { InsightsPanel } from "@renderer/components/dashboard/InsightsPanel";
import { PmlCard } from "@renderer/components/dashboard/PmlCard";
import { PortfolioFilterBar } from "@renderer/components/dashboard/PortfolioFilterBar";
import { RiskChart } from "@renderer/components/dashboard/RiskChart";
import { SeasonalProfile } from "@renderer/components/dashboard/SeasonalProfile";
import { SummaryCards } from "@renderer/components/dashboard/SummaryCards";
import { useAppStore } from "@renderer/store/appStore";
import { useFilteredDealerships } from "@renderer/lib/useFilteredDealerships";
import {
  DEFAULT_TILE_ORDER,
  TILE_DEFINITIONS,
  applyDashboardCommand,
  type DashboardTileId,
  moveDashboardTile,
  parseDashboardCommand,
} from "./dashboardTiles";

const TILE_STORAGE_KEY = "dealership-risk-dashboard-tiles-v2";

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
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const [detail, setDetail] = useState<AnalyzedDealership | null>(null);
  const [tileOrder, setTileOrder] = useState<DashboardTileId[]>(readTileOrder);
  const [draggedTile, setDraggedTile] = useState<DashboardTileId | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const filtered = useFilteredDealerships(dealerships);

  useEffect(() => {
    window.localStorage.setItem(TILE_STORAGE_KEY, JSON.stringify(tileOrder));
  }, [tileOrder]);

  useEffect(() => {
    if (!selectedId) return;
    const match = dealerships.find((d) => d.id === selectedId);
    if (match) setDetail(match);
  }, [selectedId, dealerships]);

  const tileLabels = useMemo(
    () => new Map(TILE_DEFINITIONS.map((tile) => [tile.id, t(tile.labelKey)])),
    [t],
  );

  function showOnMap(d: AnalyzedDealership): void {
    select(d.id);
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
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {tileOrder.map((id) => (
                  <DashboardTile
                    key={id}
                    id={id}
                    label={tileLabels.get(id) ?? id}
                    dragged={draggedTile === id}
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
        <div className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md shadow-2xl md:static md:w-96 md:max-w-none md:shadow-none">
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
    highlightIds: string[] | null;
  },
): React.JSX.Element {
  switch (id) {
    case "summary":
      return <SummaryCards dealerships={props.filtered} />;
    case "risk":
      return <RiskChart dealerships={props.filtered} />;
    case "pml":
      return <PmlCard dealerships={props.filtered} />;
    case "insights":
      return (
        <InsightsPanel dealerships={props.filtered} onSelect={props.onSelect} />
      );
    case "coverage":
      return <CoverageCard dealerships={props.filtered} />;
    case "seasonal":
      return <SeasonalProfile dealerships={props.filtered} />;
    case "clusters":
      return <AccumulationClusterTable dealerships={props.dealerships} />;
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

function tileSpan(id: DashboardTileId): string {
  if (
    id === "summary" ||
    id === "seasonal" ||
    id === "clusters" ||
    id === "table"
  ) {
    return "lg:col-span-2 xl:col-span-3";
  }
  if (id === "risk") return "lg:col-span-2 xl:col-span-2";
  return "lg:col-span-1 xl:col-span-1";
}

function DashboardTile({
  id,
  label,
  dragged,
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
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onRemove: () => void;
  t: (key: string) => string;
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <section
      className={`group relative min-w-0 ${tileSpan(id)} ${dragged ? "opacity-50" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      aria-label={label}
    >
      <div className="pointer-events-none absolute right-2 top-2 z-20 flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
          <DropdownMenuItem onClick={exportFile}>.drm File</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
