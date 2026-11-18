import { etaRangeMinutes } from "@renderer/lib/analysisEta";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Filter,
  Info,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  ScanEye,
  ScanSearch,
  Square,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { usePausedReview } from "@renderer/components/dashboard/reviewRunStore";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Progress } from "@renderer/components/ui/progress";
import { cn } from "@renderer/lib/utils";
import { unanalyzedInputs, useAppStore } from "@renderer/store/appStore";
import { useMapStore } from "@renderer/store/mapStore";
import type { DetectionEditDraft } from "./DetectionOverlay";

/**
 * Shared look of the status notices at the top of the map: opaque (they
 * stack over imagery and each other) and compact. Body text stays muted;
 * a warning only colours the icon and the border.
 */
export const NOTICE_CLASS =
  "flex w-full max-w-[28rem] items-start gap-2.5 rounded-lg border bg-card px-3 py-2 text-sm shadow-lg";

export function DismissButton({
  label,
  onClick,
}: Readonly<{ label: string; onClick: () => void }>): React.JSX.Element {
  return (
    <HintButton
      type="button"
      variant="ghost"
      size="icon"
      className="-mr-1.5 -mt-0.5 size-6 text-muted-foreground"
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
    <div className={NOTICE_CLASS}>
      <ScanSearch className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="truncate font-medium" title={dealership.name}>
          {dealership.name}
        </div>
        <p className="text-xs leading-snug text-muted-foreground">
          {t("map.page.detectionReviewSummary", {
            machine: dealership.detection?.vehicleCount ?? 0,
            added: draft.manualVehiclePoints.length,
            removed: draft.manualVehicleRemovedPoints.length,
            total: draft.manualVehicleCount,
          })}
        </p>
      </div>
    </div>
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
          <div key={`edit-${id}`} className={NOTICE_CLASS}>
            <Save className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="line-clamp-2 break-words font-medium">
                {t("map.page.boundaryEditedPrompt", {
                  name: dealership.name,
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
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
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
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
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => void revertBoundaryToDefault(id)}
                  disabled={!hasDefault || busy}
                >
                  <RotateCcw className="size-3" />
                  {t("map.page.revertBoundaryDefault")}
                </Button>
              </div>
              {detectionUpdateErrors[id] && (
                <p className="text-xs text-destructive">
                  {detectionUpdateErrors[id]}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Name of a location for the notices, also while its analysis failed. */
function useLocationName(): (id: string) => string {
  const dealerships = useAppStore((s) => s.dealerships);
  const failedInputs = useAppStore((s) => s.failedInputs);
  return (id) =>
    dealerships.find((d) => d.id === id)?.name ?? failedInputs[id]?.name ?? id;
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
    <div className={NOTICE_CLASS}>
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Announced politely to screen readers as the count moves. */}
        <div
          role="status"
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
        >
          <span className="whitespace-nowrap font-medium tabular-nums">
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
          <p className="truncate text-xs text-muted-foreground">
            {analyzingNames.join(" · ")}
          </p>
        )}
        <Progress
          value={(progress.done / progress.total) * 100}
          className="h-1"
          aria-label={t("map.page.analyzingProgress", {
            done: progress.done,
            total: progress.total,
          })}
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 text-xs"
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
    </div>
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
    <div role="alert" className={cn(NOTICE_CLASS, "border-destructive/40")}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-medium">
          {t("map.page.analysisErrors", { count: failedIds.length })}
        </div>
        <p className="line-clamp-2 break-words text-xs text-muted-foreground">
          {failedIds.map(nameOf).join(" · ")}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => void retryFailedAnalyses()}
        >
          <RefreshCw className="size-3" />
          {t("map.page.retryAnalysis")}
        </Button>
      </div>
      <DismissButton label={t("map.page.dismissHint")} onClick={onDismiss} />
    </div>
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
  const discardPendingAnalysis = useAppStore((s) => s.discardPendingAnalysis);
  if (analyzing || dismissed || unanalyzedCount === 0 || errorCount > 0)
    return null;
  return (
    <div role="status" className={NOTICE_CLASS}>
      <RefreshCw className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-medium">
          {t("map.page.resumeTitle", { count: unanalyzedCount })}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("map.page.resumeDetail")}
        </p>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            onClick={() => void resumeAnalysis()}
          >
            {t("map.page.resumeAction")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              discardPendingAnalysis();
              onDismiss();
            }}
          >
            {t("map.page.resumeDiscard")}
          </Button>
        </div>
      </div>
    </div>
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
    <div className={NOTICE_CLASS}>
      <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-medium">{t("review.pausedTitle")}</div>
        <p className="text-xs leading-snug text-muted-foreground">
          {t("review.pausedHint")}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          onClick={() => navigate("/dashboard")}
        >
          <ArrowRight className="size-3" />
          {t("review.resume")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => usePausedReview.getState().clear()}
        >
          {t("review.endRun")}
        </Button>
      </div>
    </div>
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
    <div className={NOTICE_CLASS}>
      <Pencil className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-medium">{t("map.page.editingTitle")}</div>
        <p className="text-xs leading-snug text-muted-foreground">
          {t("map.page.editingHint")}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        className="h-7 shrink-0 text-xs"
        onClick={() => setEditing(false)}
      >
        <Check className="size-3" />
        {t("map.page.editingDone")}
      </Button>
    </div>
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
    <div className={cn(NOTICE_CLASS, "border-warning/40")}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="font-medium">
          {t("map.page.boundaryWarning", { count })}
        </div>
        {fallbackCount > 0 && (
          <p className="text-xs leading-snug text-muted-foreground">
            {t("map.page.fallbackBoundaries", { count: fallbackCount })}
          </p>
        )}
        {target ? (
          <>
            <p
              className="line-clamp-3 break-words text-xs leading-snug text-muted-foreground"
              title={target.name}
            >
              {t("map.page.boundaryReviewQuestion", {
                name: target.name,
                position,
                count,
              })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onConfirm(target.id)}
              >
                <Check className="size-3" />
                {t("map.page.boundaryConfirm")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => onCorrect(target)}
              >
                <Pencil className="size-3" />
                {t("map.page.boundaryCorrect")}
              </Button>
              {count > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={onNext}
                >
                  {t("map.page.boundaryNext")}
                  <ArrowRight className="size-3" />
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-xs leading-snug text-muted-foreground">
              {t("map.page.boundaryWarningHint")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                onClick={onNext}
              >
                {t("map.page.boundaryStartReview")}
                <ArrowRight className="size-3" />
              </Button>
              {fallbackCount > 0 && !fallbackFilterActive && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={onShowFallback}
                >
                  <Filter className="size-3" />
                  {t("map.page.showFallbackBoundaries")}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
      <DismissButton label={t("map.page.dismissHint")} onClick={onDismiss} />
    </div>
  );
}

/** Vehicle counts that are only estimated because no model is installed. */
export function DetectionModelHint({
  count,
  total,
  onDismiss,
}: Readonly<{
  count: number;
  total: number;
  onDismiss: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className={cn(NOTICE_CLASS, "border-warning/40")}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-medium">
          {t("map.page.detectionWarning", { count, total })}
        </div>
        <p className="text-xs leading-snug text-muted-foreground">
          {t("map.page.detectionWarningHint")}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => navigate("/settings?section=data")}
        >
          <ScanEye className="size-3" />
          {t("map.page.setupDetection")}
        </Button>
      </div>
      <DismissButton label={t("map.page.dismissHint")} onClick={onDismiss} />
    </div>
  );
}

/** The cluster layer is on but empty: say why, so it is not read as a bug. */
export function NoClustersHint({
  radiusKm,
  onDismiss,
}: Readonly<{ radiusKm: number; onDismiss: () => void }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={NOTICE_CLASS}>
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
        {t("map.page.noClustersInfo", { radius: radiusKm })}
      </p>
      <DismissButton label={t("map.page.dismissHint")} onClick={onDismiss} />
    </div>
  );
}
