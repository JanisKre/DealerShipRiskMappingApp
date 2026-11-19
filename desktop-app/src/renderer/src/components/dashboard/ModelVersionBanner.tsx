import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw } from "lucide-react";
import { notify } from "@renderer/lib/notify";
import { RISK_MODEL_VERSION } from "@shared/constants";
import type { AnalyzedDealership } from "@shared/types";
import { Alert, AlertActions, AlertTitle } from "@renderer/components/ui/alert";
import { Button } from "@renderer/components/ui/button";
import { useAppStore } from "@renderer/store/appStore";

/**
 * Shown when locations were scored with an older risk model (e.g. the
 * multi-peril scores before screening-0.5.0). Recalculating reuses the
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
    if (remaining === 0) notify.success(t("dashboard.modelVersion.done"));
    else notify.error(t("dashboard.modelVersion.failed", { count: remaining }));
  }

  return (
    <Alert variant="warning">
      <AlertTitle>
        {t("dashboard.modelVersion.outdated", {
          count: outdated,
          version: RISK_MODEL_VERSION,
        })}
      </AlertTitle>
      <AlertActions>
        <Button
          size="xs"
          onClick={() => void recalculate()}
          disabled={updating}
        >
          {updating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t("dashboard.modelVersion.recalculate")}
        </Button>
      </AlertActions>
    </Alert>
  );
}

function countOutdated(dealerships: AnalyzedDealership[]): number {
  return dealerships.filter(
    (d) => d.risk && d.risk.modelVersion !== RISK_MODEL_VERSION,
  ).length;
}
