import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, Loader2 } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { useAppStore } from "@renderer/store/appStore";
import { useDashboardStore } from "@renderer/store/dashboardStore";
import { EmptyState } from "@renderer/components/common/EmptyState";
import { Button } from "@renderer/components/ui/button";
import { DashboardRenderer } from "@renderer/components/dashboard/DashboardRenderer";
import { DashboardSidebar } from "@renderer/components/dashboard/DashboardSidebar";
import { DealershipDetailDialog } from "@renderer/components/dashboard/DealershipDetailDialog";

/**
 * AI dashboard page (route `/ai-dashboard`): the persisted dashboard
 * history on the left, the active dashboard on the right. A prompt from
 * the omnibox generates a {@link DashboardSpec} via the LLM; the
 * {@link DashboardRenderer} binds all numbers deterministically from the
 * portfolio. A spinner runs during generation; an empty state shows when
 * there is no active spec.
 */
export function AiDashboardPage(): React.JSX.Element {
  const navigate = useNavigate();
  const dealerships = useAppStore((s) => s.dealerships);
  const loadList = useDashboardStore((s) => s.loadList);
  const activeSpec = useDashboardStore((s) => s.activeSpec);
  const activeName = useDashboardStore((s) => s.activeName);
  const generating = useDashboardStore((s) => s.generating);
  const error = useDashboardStore((s) => s.error);
  const [detail, setDetail] = useState<AnalyzedDealership | null>(null);

  // Load the persisted dashboard list on mount.
  useEffect(() => {
    void loadList();
  }, [loadList]);

  return (
    <div className="flex h-full">
      <DashboardSidebar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {renderMain()}
      </div>

      <DealershipDetailDialog
        dealership={detail}
        open={detail !== null}
        onOpenChange={(o) => {
          if (!o) setDetail(null);
        }}
      />
    </div>
  );

  function renderMain(): React.JSX.Element {
    if (generating) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Generating dashboard…
          </p>
        </div>
      );
    }

    if (activeSpec) {
      return (
        <div className="space-y-6 p-8">
          <div>
            <h2 className="text-2xl font-semibold">{activeSpec.title || activeName}</h2>
            {error && (
              <p className="mt-1 text-sm text-destructive">Error: {error}</p>
            )}
          </div>
          <DashboardRenderer
            spec={activeSpec}
            dealerships={dealerships}
            onSelect={setDetail}
          />
        </div>
      );
    }

    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={LayoutDashboard}
          title="No AI dashboard yet"
          description={`Describe what you want to see at the bottom of the home page in "Dashboard" mode — the AI will assemble a matching dashboard from it.`}
          action={<Button onClick={() => navigate("/")}>Go to Home Page</Button>}
        />
      </div>
    );
  }
}
