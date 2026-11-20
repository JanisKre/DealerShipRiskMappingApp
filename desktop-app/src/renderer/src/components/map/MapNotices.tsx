import { etaRangeMinutes } from "@renderer/lib/analysisEta";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Filter,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  ScanEye,
  ScanSearch,
  Square,
  Undo2,
  X,
} from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { usePausedReview } from "@renderer/components/dashboard/reviewRunStore";
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@renderer/components/ui/alert";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Progress } from "@renderer/components/ui/progress";
import { unanalyzedInputs, useAppStore } from "@renderer/store/appStore";
import { useMapStore } from "@renderer/store/mapStore";
import type { DetectionEditDraft } from "./DetectionOverlay";

/**
 * The status notices at the top of the map are the app's `Alert`, floating
 * over the imagery: this only limits their width.
 */
const MAP_NOTICE = "max-w-[28rem]";

export function DismissButton({
  label,
  onClick,
}: Readonly<{ label: string; onClick: () => void }>): React.JSX.Element {
  return (
    <HintButton
      type="button"
      variant="ghost"
      size="icon"
      className="-mr-1.5 -mt-1 size-6 text-muted-foreground"
      onClick={onClick}
      aria-label={label}
    >
      <X className="size-3.5" />
    </HintButton>
  );
}

/** Remaining-time estimate for a batch analysis, as a coarse range. */
export function remainingLabel(
  t: TFunction,
  progress: { done: number; total: number; startedAt: number },
): string {
  // The first results include warm-up (model load, cold caches); wait for a
  // few before extrapolating.
  const range = etaRangeMinutes(
    progress.done,
    progress.total,
    Date.now() - progress.startedAt,
  );
  if (!range) return t("map.page.analyzingEstimating");
  const duration = (minutes: number): string =>
    minutes < 60
      ? t("map.page.durationMinutes", { minutes })
      : t("map.page.durationHours", {
          hours: Math.floor(minutes / 60),
          minutes: minutes % 60,
        });
  const time = t("map.page.durationRange", {
    low: duration(range[0]),
    high: duration(range[1]),
  });
  return t("map.page.analyzingRemaining", { time });
}

/** The vehicle review in progress: machine count, added, removed, total. */
export function DetectionReviewNotice({
  dealership,
  draft,
}: Readonly<{
  dealership: AnalyzedDealership;
  draft: DetectionEditDraft;
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Alert floating variant="info" icon={ScanSearch} className={MAP_NOTICE}>
      <AlertTitle className="truncate" title={dealership.name}>
        {dealership.name}
      </AlertTitle>
      <AlertDescription>
        {t("map.page.detectionReviewSummary", {
          machine: dealership.detection?.vehicleCount ?? 0,
          added: draft.manualVehiclePoints.length,
          removed: draft.manualVehicleRemovedPoints.length,
          total: draft.manualVehicleCount,
        })}
      </AlertDescription>
    </Alert>
  );
}

/** One prompt per edited boundary: save (and recount), undo, revert. */
export function BoundaryEditNotices(): React.JSX.Element {
  const { t } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const boundaryEditIds = useAppStore((s) => s.boundaryEditIds);
  const boundaryHistory = useAppStore((s) => s.boundaryHistory);
  const detectionUpdateIds = useAppStore((s) => s.detectionUpdateIds);
  const detectionUpdateErrors = useAppStore((s) => s.detectionUpdateErrors);
  const saveBoundaryEdit = useAppStore((s) => s.saveBoundaryEdit);
  const undoBoundaryEdit = useAppStore((s) => s.undoBoundaryEdit);
  const revertBoundaryToDefault = useAppStore((s) => s.revertBoundaryToDefault);
  return (
    <>
      {boundaryEditIds.map((id) => {
        const dealership = dealerships.find((d) => d.id === id);
        if (!dealership) return null;
        const hasHistory = (boundaryHistory[id]?.length ?? 0) > 0;
        const hasDefault = dealership.boundaryBeforeManualEdit != null;
        const busy = detectionUpdateIds.includes(id);
        return (
          <Alert
            key={`edit-${id}`}
            floating
            variant="info"
            icon={Save}
            className={MAP_NOTICE}
          >
            <AlertTitle className="line-clamp-2 break-words">
              {t("map.page.boundaryEditedPrompt", {
                name: dealership.name,
              })}
            </AlertTitle>
            <AlertActions>
              <Button
                type="button"
                size="xs"
                onClick={() => void saveBoundaryEdit(id)}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Save className="size-3" />
                )}
                {t("map.page.saveBoundaryEdit")}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => void undoBoundaryEdit(id)}
                disabled={!hasHistory || busy}
                title={t("map.page.undoBoundaryEditShortcut")}
                aria-keyshortcuts="Control+Z Meta+Z"
              >
                <Undo2 className="size-3" />
                {t("map.page.undoBoundaryEdit")}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => void revertBoundaryToDefault(id)}
                disabled={!hasDefault || busy}
              >
                <RotateCcw className="size-3" />
                {t("map.page.revertBoundaryDefault")}
              </Button>
            </AlertActions>
            {detectionUpdateErrors[id] && (
              <p role="alert" className="text-xs text-destructive">
                {detectionUpdateErrors[id]}
              </p>
            )}
          </Alert>
        );
      })}
    </>
  );
}

/** Name of a location for the notices, also while its analysis failed. */
function useLocationName(): (id: string) => string {
  const dealerships = useAppStore((s) => s.dealerships);
  const failedInputs = useAppStore((s) => s.failedInputs);
  // A location in its first analysis is only in the pending batch yet.
  const pendingAnalysis = useAppStore((s) => s.pendingAnalysis);
  return (id) =>
    dealerships.find((d) => d.id === id)?.name ??
    failedInputs[id]?.name ??
    pendingAnalysis.find((input) => input.id === id)?.name ??
    id;
}

/** Progress of a running batch analysis, with the stop button. */
export function AnalysisProgressNotice(): React.JSX.Element | null {
  const { t } = useTranslation();
  const analyzing = useAppStore((s) => s.analyzing);
  const progress = useAppStore((s) => s.progress);
  const analyzingIds = useAppStore((s) => s.analyzingIds);
  const cancelAnalysis = useAppStore((s) => s.cancelAnalysis);
  // Stopping waits for the locations in flight; say so right away.
  const cancelRequested = useAppStore((s) => s.analysisCancelRequested);
  const nameOf = useLocationName();
  if (!analyzing || !progress || progress.total <= 0) return null;
  const analyzingNames = analyzingIds.map(nameOf);
  return (
    <Alert
      floating
      variant="info"
      busy
      // Only the count below is announced, not the whole notice per tick.
      announce={false}
      className={MAP_NOTICE}
      aside={
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="shrink-0"
          onClick={cancelAnalysis}
          disabled={cancelRequested}
        >
          {cancelRequested ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Square className="size-3" />
          )}
          {t(
            cancelRequested
              ? "map.page.cancellingAnalysis"
              : "map.page.cancelAnalysis",
          )}
        </Button>
      }
    >
      {/* Announced politely to screen readers as the count moves. */}
      <div
        role="status"
        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
      >
        <span className="min-w-0 font-medium tabular-nums">
          {t("map.page.analyzingProgress", {
            done: progress.done,
            total: progress.total,
          })}
        </span>
        <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          {remainingLabel(t, progress)}
        </span>
      </div>
      {analyzingNames.length > 0 && (
        <AlertDescription className="truncate">
          {analyzingNames.join(" · ")}
        </AlertDescription>
      )}
      <Progress
        value={(progress.done / progress.total) * 100}
        className="h-1"
        aria-label={t("map.page.analyzingProgress", {
          done: progress.done,
          total: progress.total,
        })}
      />
    </Alert>
  );
}

/**
 * Locations whose analysis failed, with a retry. Shown on the map and on
 * the empty state: when every imported row fails, nothing reaches the map,
 * and this is the only way back.
 */
export function AnalysisErrorNotice({
  dismissed,
  onDismiss,
}: Readonly<{
  dismissed: boolean;
  onDismiss: () => void;
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const analyzing = useAppStore((s) => s.analyzing);
  const analysisErrors = useAppStore((s) => s.analysisErrors);
  const retryFailedAnalyses = useAppStore((s) => s.retryFailedAnalyses);
  const nameOf = useLocationName();
  const failedIds = Object.keys(analysisErrors);
  if (analyzing || dismissed || failedIds.length === 0) return null;
  return (
    // An error that appears after a run must be announced (WCAG 4.1.3).
    <Alert
      floating
      variant="destructive"
      className={MAP_NOTICE}
      aside={
        <DismissButton label={t("map.page.dismissHint")} onClick={onDismiss} />
      }
    >
      <AlertTitle>
        {t("map.page.analysisErrors", { count: failedIds.length })}
      </AlertTitle>
      <AlertDescription className="line-clamp-2 break-words">
        {failedIds.map(nameOf).join(" · ")}
      </AlertDescription>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => void retryFailedAnalyses()}
      >
        <RefreshCw className="size-3" />
        {t("map.page.retryAnalysis")}
      </Button>
    </Alert>
  );
}

/** An import that was interrupted (app closed or crashed): resume it. */
export function ResumeAnalysisNotice({
  dismissed,
  onDismiss,
}: Readonly<{
  dismissed: boolean;
  onDismiss: () => void;
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const analyzing = useAppStore((s) => s.analyzing);
  const errorCount = useAppStore((s) => Object.keys(s.analysisErrors).length);
  const unanalyzedCount = useAppStore((s) => unanalyzedInputs(s).length);
  const resumeAnalysis = useAppStore((s) => s.resumeAnalysis);
  if (analyzing || dismissed || unanalyzedCount === 0 || errorCount > 0)
    return null;
  return (
    <Alert floating variant="info" icon={RefreshCw} className={MAP_NOTICE}>
      <AlertTitle>
        {t("map.page.resumeTitle", { count: unanalyzedCount })}
      </AlertTitle>
      <AlertDescription>{t("map.page.resumeDetail")}</AlertDescription>
      <AlertActions>
        <Button type="button" size="xs" onClick={() => void resumeAnalysis()}>
          {t("map.page.resumeAction")}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          // "Later" only closes the notice. Rows without coordinates exist
          // in the pending queue alone; clearing it deleted them.
          onClick={onDismiss}
        >
          {t("map.page.resumeDiscard")}
        </Button>
      </AlertActions>
    </Alert>
  );
}

/** A dashboard review run paused for a boundary correction on the map. */
export function PausedReviewNotice(): React.JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pausedReviewId = usePausedReview((s) => s.resumeId);
  const editing = useMapStore((s) => s.editing);
  const editCount = useAppStore((s) => s.boundaryEditIds.length);
  if (!pausedReviewId || editing || editCount > 0) return null;
  return (
    <Alert
      floating
      variant="info"
      icon={ClipboardCheck}
      className={MAP_NOTICE}
      aside={
        <div className="flex shrink-0 flex-col gap-1">
          <Button
            type="button"
            size="xs"
            onClick={() => navigate("/dashboard")}
          >
            <ArrowRight className="size-3" />
            {t("review.resume")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => usePausedReview.getState().clear()}
          >
            {t("review.endRun")}
          </Button>
        </div>
      }
    >
      <AlertTitle>{t("review.pausedTitle")}</AlertTitle>
      <AlertDescription>{t("review.pausedHint")}</AlertDescription>
    </Alert>
  );
}

/** Boundary editing is on and nothing was changed yet: how to finish. */
export function BoundaryEditingNotice(): React.JSX.Element | null {
  const { t } = useTranslation();
  const editing = useMapStore((s) => s.editing);
  const setEditing = useMapStore((s) => s.setEditing);
  const editCount = useAppStore((s) => s.boundaryEditIds.length);
  if (!editing || editCount > 0) return null;
  return (
    <Alert
      floating
      variant="info"
      icon={Pencil}
      className={MAP_NOTICE}
      aside={
        <Button
          type="button"
          size="xs"
          className="shrink-0"
          onClick={() => setEditing(false)}
        >
          <Check className="size-3" />
          {t("map.page.editingDone")}
        </Button>
      }
    >
      <AlertTitle>{t("map.page.editingTitle")}</AlertTitle>
      <AlertDescription>{t("map.page.editingHint")}</AlertDescription>
    </Alert>
  );
}

/** Boundaries that need a check: confirm, correct, or step to the next. */
export function BoundaryReviewHint({
  count,
  fallbackCount,
  target,
  position,
  fallbackFilterActive,
  onConfirm,
  onCorrect,
  onNext,
  onShowFallback,
  onDismiss,
}: Readonly<{
  count: number;
  /** Fallback circles among them: the least reliable kind. */
  fallbackCount: number;
  /** The selected location, when it needs a check. */
  target: AnalyzedDealership | null;
  /** 1-based position of `target` in the review queue. */
  position: number;
  fallbackFilterActive: boolean;
  onConfirm: (id: string) => void;
  onCorrect: (target: AnalyzedDealership) => void;
  onNext: () => void;
  onShowFallback: () => void;
  onDismiss: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Alert
      floating
      variant="warning"
      className={MAP_NOTICE}
      aside={
        <DismissButton label={t("map.page.dismissHint")} onClick={onDismiss} />
      }
    >
      <AlertTitle>{t("map.page.boundaryWarning", { count })}</AlertTitle>
      {fallbackCount > 0 && (
        <AlertDescription>
          {t("map.page.fallbackBoundaries", { count: fallbackCount })}
        </AlertDescription>
      )}
      {target ? (
        <>
          <AlertDescription
            className="line-clamp-3 break-words"
            title={target.name}
          >
            {t("map.page.boundaryReviewQuestion", {
              name: target.name,
              position,
              count,
            })}
          </AlertDescription>
          <AlertActions>
            <Button
              type="button"
              size="xs"
              onClick={() => onConfirm(target.id)}
            >
              <Check className="size-3" />
              {t("map.page.boundaryConfirm")}
              <kbd className="ml-0.5 rounded border border-current/30 px-1 font-mono text-[10px] leading-none opacity-70">
                ↵
              </kbd>
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onCorrect(target)}
            >
              <Pencil className="size-3" />
              {t("map.page.boundaryCorrect")}
              <kbd className="ml-0.5 rounded border border-current/30 px-1 font-mono text-[10px] leading-none opacity-70">
                E
              </kbd>
            </Button>
            {count > 1 && (
              <Button type="button" size="xs" variant="ghost" onClick={onNext}>
                {t("map.page.boundaryNext")}
                <ArrowRight className="size-3" />
                <kbd className="ml-0.5 rounded border border-current/30 px-1 font-mono text-[10px] leading-none opacity-70">
                  N
                </kbd>
              </Button>
            )}
          </AlertActions>
        </>
      ) : (
        <>
          <AlertDescription>
            {t("map.page.boundaryWarningHint")}
          </AlertDescription>
          <AlertActions>
            <Button type="button" size="xs" onClick={onNext}>
              {t("map.page.boundaryStartReview")}
              <ArrowRight className="size-3" />
            </Button>
            {fallbackCount > 0 && !fallbackFilterActive && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={onShowFallback}
              >
                <Filter className="size-3" />
                {t("map.page.showFallbackBoundaries")}
              </Button>
            )}
          </AlertActions>
        </>
      )}
    </Alert>
  );
}

/** Vehicle counts that are only estimated because no model is installed. */
export function DetectionModelHint({
  count,
  total,
  modelAvailable,
  onReanalyze,
  onDismiss,
}: Readonly<{
  count: number;
  total: number;
  /** The model is installed by now: offer the re-analysis, not the setup. */
  modelAvailable: boolean;
  onReanalyze: () => void;
  onDismiss: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Alert
      floating
      variant="warning"
      className={MAP_NOTICE}
      aside={
        <DismissButton label={t("map.page.dismissHint")} onClick={onDismiss} />
      }
    >
      <AlertTitle>
        {t("map.page.detectionWarning", { count, total })}
      </AlertTitle>
      <AlertDescription>
        {t(
          modelAvailable
            ? "map.page.detectionWarningReady"
            : "map.page.detectionWarningHint",
        )}
      </AlertDescription>
      {modelAvailable ? (
        <Button type="button" size="xs" onClick={onReanalyze}>
          <RefreshCw className="size-3" />
          {t("map.page.reanalyzeEstimated", { count })}
        </Button>
      ) : (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => navigate("/settings?section=data")}
        >
          <ScanEye className="size-3" />
          {t("map.page.setupDetection")}
        </Button>
      )}
    </Alert>
  );
}

/** The cluster layer is on but empty: say why, so it is not read as a bug. */
export function NoClustersHint({
  radiusKm,
  onDismiss,
}: Readonly<{ radiusKm: number; onDismiss: () => void }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Alert
      floating
      variant="neutral"
      className={MAP_NOTICE}
      aside={
        <DismissButton label={t("map.page.dismissHint")} onClick={onDismiss} />
      }
    >
      <AlertDescription>
        {t("map.page.noClustersInfo", { radius: radiusKm })}
      </AlertDescription>
    </Alert>
  );
}
