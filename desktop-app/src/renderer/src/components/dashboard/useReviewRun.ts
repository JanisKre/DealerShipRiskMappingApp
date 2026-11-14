import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "@renderer/store/appStore";
import type { ReviewRun } from "./DealershipDetailDialog";
import {
  REVIEW_PLAN_MAX_ITEMS,
  mergeReviewOrder,
  type ReviewPlan,
} from "@shared/review-plan";
import { buildReviewQueue, reviewPlanItems } from "./reviewQueue";
import { usePausedReview } from "./reviewRunStore";

/**
 * Starts and ends a review run for a page that hosts the detail dialog:
 * `start` snapshots the queue and opens its first location, `review` goes
 * to the dialog, and the run ends when the dialog closes or the last open
 * point is done. `openCount` feeds the button label (null while a batch
 * analysis is still changing the results).
 */
export function useReviewRun({
  openLocation,
  closeDialog,
}: {
  openLocation: (id: string) => void;
  closeDialog: () => void;
}): {
  openCount: number | null;
  /**
   * Starts the run on the fixed queue, or in the order of an optional AI
   * proposal (merged into the current queue, so it always covers it).
   */
  start: (plan?: ReviewPlan) => void;
  /**
   * Asks the AI for an order and starts the run with it. When the AI fails,
   * the run starts in the fixed order and a toast says so.
   */
  startWithAiOrder: () => Promise<void>;
  /** True while the AI order is being requested. */
  planning: boolean;
  stop: () => void;
  review: ReviewRun | undefined;
} {
  const { t } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const parameters = useAppStore((s) => s.parameters);
  const analyzing = useAppStore((s) => s.analyzing);
  const [ids, setIds] = useState<string[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string> | undefined>();
  const [planning, setPlanning] = useState(false);

  const openCount = useMemo(
    () =>
      analyzing ? null : buildReviewQueue(t, dealerships, parameters).length,
    [t, dealerships, parameters, analyzing],
  );

  function start(plan?: ReviewPlan): void {
    const state = useAppStore.getState();
    const fixed = buildReviewQueue(t, state.dealerships, state.parameters);
    if (fixed.length === 0) {
      toast.success(t("review.empty"));
      return;
    }
    const queue = plan ? mergeReviewOrder(fixed, plan.order) : fixed;
    setIds(queue);
    setNotes(plan?.notes);
    openLocation(queue[0]);
  }

  async function startWithAiOrder(): Promise<void> {
    if (planning) return;
    const state = useAppStore.getState();
    const fixed = buildReviewQueue(t, state.dealerships, state.parameters);
    if (fixed.length < 2) {
      start();
      return;
    }
    setPlanning(true);
    try {
      const plan = await window.api.proposeReviewOrder({
        items: reviewPlanItems(
          t,
          fixed.slice(0, REVIEW_PLAN_MAX_ITEMS),
          state.dealerships,
          state.parameters,
        ),
      });
      start(plan);
    } catch (err) {
      toast.error(
        t("review.aiOrderFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      start();
    } finally {
      setPlanning(false);
    }
  }

  // Back from a boundary correction on the map: continue where it paused.
  useEffect(() => {
    const paused = usePausedReview.getState().take();
    if (!paused) return;
    setIds(paused.ids);
    setNotes(paused.notes);
    openLocation(paused.id);
    // Once on mount: the paused run is taken a single time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const review = useMemo<ReviewRun | undefined>(
    () =>
      ids
        ? {
            ids,
            notes,
            onFinish: () => {
              setIds(null);
              setNotes(undefined);
              closeDialog();
              toast.success(t("review.finished"));
            },
            onPause: (id: string) => {
              usePausedReview.getState().pause(ids, id, notes);
              setIds(null);
            },
          }
        : undefined,
    [ids, notes, closeDialog, t],
  );

  return {
    openCount,
    start,
    startWithAiOrder,
    planning,
    stop: () => {
      setIds(null);
      setNotes(undefined);
    },
    review,
  };
}
