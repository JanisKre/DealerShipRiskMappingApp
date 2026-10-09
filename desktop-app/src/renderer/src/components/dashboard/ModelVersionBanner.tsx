import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { RISK_MODEL_VERSION } from "@shared/constants";
import type { AnalyzedDealership } from "@shared/types";
import { Button } from "@renderer/components/ui/button";
import { useAppStore } from "@renderer/store/appStore";

/**
 * Shown when locations were scored with an older risk model (e.g. the
 * multi-peril EAL before screening-0.4.0). Recalculating reuses the
 * parameter rescore path, so boundaries and vehicle counts are kept.
 */
export function ModelVersionBanner({
  dealerships,
}: Readonly<{ dealerships: AnalyzedDealership[] }>): React.JSX.Element | null {
  const { t } = useTranslation();
  const updating = useAppStore((s) => s.parametersUpdating);
  const updateParameters = useAppStore((s) => s.updateParameters);
  const outdated = countOutdated(dealerships);
  if (outdated === 0) return null;

  async function recalculate(): Promise<void> {
    // updateParameters logs and swallows rescoring errors, so check the
    // result instead of relying on a rejection.
    await updateParameters({});
    const remaining = countOutdated(useAppStore.getState().dealerships);
    if (remaining === 0) toast.success(t("dashboard.modelVersion.done"));
    else toast.error(t("dashboard.modelVersion.failed", { count: remaining }));
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
      <span className="min-w-0 flex-1">
        {t("dashboard.modelVersion.outdated", {
          count: outdated,
          version: RISK_MODEL_VERSION,
        })}
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void recalculate()}
        disabled={updating}
      >
        {updating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {t("dashboard.modelVersion.recalculate")}
      </Button>
    </div>
  );
}

function countOutdated(dealerships: AnalyzedDealership[]): number {
  return dealerships.filter(
    (d) => d.risk && d.risk.modelVersion !== RISK_MODEL_VERSION,
  ).length;
}
