import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { BarChart3, Download, Loader2, Save } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@renderer/components/ui/tabs";
import { AiDashboardPage } from "@renderer/components/dashboard/AiDashboardPage";
import { toast } from "sonner";
import type { AnalyzedDealership } from "@shared/types";
import { EmptyState } from "@renderer/components/common/EmptyState";
import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { ComparisonView } from "@renderer/components/dashboard/ComparisonView";
import { AccumulationClusterTable } from "@renderer/components/dashboard/AccumulationClusterTable";
import { CoverageCard } from "@renderer/components/dashboard/CoverageCard";
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

export function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dealerships = useAppStore((s) => s.dealerships);
  const sessionName = useAppStore((s) => s.sessionName);
  const nlQueryMatchedIds = useAppStore((s) => s.nlQueryMatchedIds);
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const [detail, setDetail] = useState<AnalyzedDealership | null>(null);

  // Apply active portfolio filters (sub-portfolio/partner/group/cluster).
  const filtered = useFilteredDealerships(dealerships);

  // Open the detail dialog for the selection passed in from the map.
  useEffect(() => {
    if (!selectedId) return;
    const match = dealerships.find((d) => d.id === selectedId);
    if (match) setDetail(match);
  }, [selectedId, dealerships]);

  function showOnMap(d: AnalyzedDealership): void {
    select(d.id);
    navigate("/map");
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
    <Tabs defaultValue="ki" className="flex h-full flex-col">
      <div className="shrink-0 border-b px-8 pt-6">
        <div className="flex items-center justify-between pb-3">
          <div>
            <h2 className="text-2xl font-semibold">{sessionName}</h2>
            <p className="text-sm text-muted-foreground">
              {filtered.length === dealerships.length
                ? t("ui.locationsAnalyzed", { count: dealerships.length })
                : t("ui.locationsFiltered", {
                    filtered: filtered.length,
                    total: dealerships.length,
                  })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <TabsList>
              <TabsTrigger value="analyse">{t("ui.analysis")}</TabsTrigger>
              <TabsTrigger value="ki">{t("nav.aiDashboard")}</TabsTrigger>
            </TabsList>
            <Actions />
          </div>
        </div>
      </div>

      <TabsContent value="analyse" className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-8">
          <PortfolioFilterBar dealerships={dealerships} />

          <SummaryCards dealerships={filtered} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RiskChart dealerships={filtered} />
            </div>
            <PmlCard dealerships={filtered} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <InsightsPanel dealerships={filtered} onSelect={setDetail} />
            <CoverageCard dealerships={filtered} />
          </div>

          <SeasonalProfile dealerships={filtered} />

          <AccumulationClusterTable dealerships={dealerships} />

          <DealershipTable
            dealerships={filtered}
            onSelect={setDetail}
            onShowOnMap={showOnMap}
            highlightIds={nlQueryMatchedIds}
          />
        </div>
      </TabsContent>

      <TabsContent value="ki" className="flex-1 overflow-hidden">
        <AiDashboardPage />
      </TabsContent>

      <DealershipDetailDialog
        dealership={detail}
        open={detail !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDetail(null);
            select(null);
          }
        }}
      />
    </Tabs>
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

  return (
    <div className="flex gap-2">
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
