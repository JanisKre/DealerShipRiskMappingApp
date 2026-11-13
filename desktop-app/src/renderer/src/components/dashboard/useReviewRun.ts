import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "@renderer/store/appStore";
import type { ReviewRun } from "./DealershipDetailDialog";
import { buildReviewQueue } from "./reviewQueue";

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
  start: () => void;
  stop: () => void;
  review: ReviewRun | undefined;
} {
  const { t } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const parameters = useAppStore((s) => s.parameters);
  const analyzing = useAppStore((s) => s.analyzing);
  const [ids, setIds] = useState<string[] | null>(null);

  const openCount = useMemo(
    () =>
      analyzing ? null : buildReviewQueue(t, dealerships, parameters).length,
    [t, dealerships, parameters, analyzing],
  );

  function start(): void {
    const state = useAppStore.getState();
    const queue = buildReviewQueue(t, state.dealerships, state.parameters);
    if (queue.length === 0) {
      toast.success(t("review.empty"));
      return;
    }
    setIds(queue);
    openLocation(queue[0]);
  }

  const review = useMemo<ReviewRun | undefined>(
    () =>
      ids
        ? {
            ids,
            onFinish: () => {
              setIds(null);
              closeDialog();
              toast.success(t("review.finished"));
            },
          }
        : undefined,
    [ids, closeDialog, t],
  );

  return { openCount, start, stop: () => setIds(null), review };
}
