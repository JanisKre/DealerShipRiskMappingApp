import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, RefreshCw, ScanEye } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { ealCoverage } from "@shared/estimates";
import { isAreaEstimatedDetection } from "@shared/risk-math";
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@renderer/components/ui/alert";
import { Button } from "@renderer/components/ui/button";
import { useModelAvailable } from "@renderer/lib/useModelAvailable";
import { useAppStore } from "@renderer/store/appStore";

/**
 * How complete the figures below are, before anyone reads them: the hail
 * EAL sums only the locations with a vehicle count, so a portfolio with
 * estimated counts or open boundaries shows a provisional total. Names the
 * gap and the step that closes it (re-analyse, set up detection, review).
 */
export function DataCompletenessBanner({
  dealerships,
  openReviews,
  onReview,
}: Readonly<{
  dealerships: AnalyzedDealership[];
  /** Open review points of the review run, null while counting. */
  openReviews: number | null;
  onReview: () => void;
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const modelAvailable = useModelAvailable();
  const analyzing = useAppStore((s) => s.analyzing);
  const reanalyze = useAppStore((s) => s.reanalyzeDealerships);
  const { withBasis, analyzed } = ealCoverage(dealerships);
  const estimatedIds = dealerships
    .filter((d) => isAreaEstimatedDetection(d.detection))
    .map((d) => d.id);
  const missing = analyzed - withBasis;
  if (analyzed === 0 || (missing === 0 && !openReviews)) return null;
  return (
    <Alert variant="warning">
      <AlertTitle>
        {missing > 0
          ? t("dashboard.completeness.provisional", {
              count: missing,
              total: analyzed,
            })
          : t("dashboard.completeness.reviewsOpen", {
              count: openReviews ?? 0,
            })}
      </AlertTitle>
      <AlertDescription>
        {missing > 0
          ? t("dashboard.completeness.provisionalHint")
          : t("dashboard.completeness.reviewsOpenHint")}
      </AlertDescription>
      <AlertActions>
        {estimatedIds.length > 0 &&
          (modelAvailable ? (
            <Button
              size="xs"
              disabled={analyzing}
              onClick={() => void reanalyze(estimatedIds)}
            >
              <RefreshCw />
              {t("map.page.reanalyzeEstimated", {
                count: estimatedIds.length,
              })}
            </Button>
          ) : (
            <Button
              size="xs"
              variant="outline"
              onClick={() => navigate("/settings?section=data")}
            >
              <ScanEye />
              {t("map.page.setupDetection")}
            </Button>
          ))}
        {(openReviews ?? 0) > 0 && (
          <Button size="xs" variant="outline" onClick={onReview}>
            <ClipboardCheck />
            {t("review.startCount", { count: openReviews })}
          </Button>
        )}
      </AlertActions>
    </Alert>
  );
}
