import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Loader2, Pencil, RefreshCw, Sparkles } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { Button } from "@renderer/components/ui/button";
import { useAppStore } from "@renderer/store/appStore";
import {
  isReviewCurrent,
  nextInReview,
  recommendedActions,
  reviewReasons,
  type ReviewReason,
} from "../reviewQueue";

/** A review run: the queue snapshot taken when it started. */
export interface ReviewRun {
  ids: string[];
  /** Optional AI notes per location (an AI-ordered run only). */
  notes?: Record<string, string>;
  /** Called after the last open location; the page closes the dialog. */
  onFinish: () => void;
  /**
   * Pauses the run while the boundary of `id` is corrected on the map; the
   * map offers to come back, and the run resumes at that location.
   */
  onPause?: (id: string) => void;
}

/** Inputs, text areas and editable fields keep their own keys. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/**
 * Review run: where the underwriter stands in the queue, why this location
 * is in it, and one action that records the check and moves on. When the
 * boundary is the open point, that action confirms it as well. Enter
 * triggers it unless focus is on another control.
 */
export function ReviewStrip({
  d,
  run,
  onNavigate,
  onSkip,
  onCorrectBoundary,
}: Readonly<{
  d: AnalyzedDealership;
  run: ReviewRun;
  onNavigate: (id: string) => void;
  onSkip: () => void;
  /** Leaves for the map editor; the run waits there. */
  onCorrectBoundary?: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const parameters = useAppStore((s) => s.parameters);
  const markReviewed = useAppStore((s) => s.markReviewed);
  const confirmBoundary = useAppStore((s) => s.confirmBoundary);
  const reanalyze = useAppStore((s) => s.reanalyzeDealership);
  const reanalyzing = useAppStore((s) => s.analyzingIds.includes(d.id));
  const [busy, setBusy] = useState(false);
  const reasons = reviewReasons(t, d, dealerships, parameters);
  const actions = recommendedActions(reasons);
  const aiNote = run.notes?.[d.id];
  const byId = new Map(dealerships.map((x) => [x.id, x]));
  const open = (id: string): boolean => {
    const x = byId.get(id);
    return x != null && !isReviewCurrent(x);
  };
  const remaining = run.ids.filter(open).length;
  const done = isReviewCurrent(d);
  const confirmsBoundary = reasons.includes("boundary");

  async function complete(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (!done) {
        if (confirmsBoundary) await confirmBoundary(d.id);
        await markReviewed(d.id);
      }
      const latest = new Map(
        useAppStore.getState().dealerships.map((x) => [x.id, x]),
      );
      const next = nextInReview(run.ids, d.id, (id) => {
        const x = latest.get(id);
        return x != null && !isReviewCurrent(x);
      });
      if (next) onNavigate(next);
      else run.onFinish();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  const completeRef = useRef(complete);
  completeRef.current = complete;

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Enter" || event.repeat) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      const target = event.target;
      if (
        isTypingTarget(target) ||
        (target instanceof HTMLElement &&
          target.closest("button, a, [role=menuitem], [role=tab]"))
      )
        return;
      event.preventDefault();
      void completeRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {t("review.position", {
            position: run.ids.indexOf(d.id) + 1,
            total: run.ids.length,
          })}
          <span className="font-normal text-muted-foreground">
            {" · "}
            {t("review.remaining", { count: remaining })}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {done
            ? t("review.alreadyReviewed")
            : reasons
                .map((r: ReviewReason) => t(`review.reason.${r}`))
                .join(" · ")}
        </div>
        {!done && actions.length > 0 && (
          <div className="text-xs">
            {t("review.recommendation")}{" "}
            {actions.map((a) => t(`review.action.${a}`)).join(" · ")}
          </div>
        )}
        {!done && aiNote && (
          <div className="flex items-start gap-1 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 size-3 shrink-0" />
            <span>{aiNote}</span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={onSkip}
        >
          {t("review.skip")}
        </Button>
        {actions.includes("reanalyze") && !done && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={reanalyzing}
            onClick={() => void reanalyze(d.id)}
          >
            {reanalyzing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {t("review.reanalyze")}
          </Button>
        )}
        {confirmsBoundary && !done && onCorrectBoundary && d.boundary && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={onCorrectBoundary}
          >
            <Pencil className="size-3.5" />
            {t("review.correctBoundary")}
          </Button>
        )}
        <Button
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs"
          disabled={busy}
          onClick={() => void complete()}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          {done
            ? t("review.next")
            : confirmsBoundary
              ? t("review.confirmBoundaryAndNext")
              : t("review.reviewedAndNext")}
          <kbd className="rounded border border-primary-foreground/40 px-1 text-[10px] leading-4">
            ↵
          </kbd>
        </Button>
      </div>
    </div>
  );
}
