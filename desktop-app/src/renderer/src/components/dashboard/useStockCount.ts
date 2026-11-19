import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { notify } from "@renderer/lib/notify";
import { useAppStore } from "@renderer/store/appStore";
import { stockCountCandidates } from "./stockCount";

/**
 * Counts the stock over time (archived images) for the locations with the
 * highest hail EAL that have no such count yet, one after another, with a
 * progress toast that can stop the run between locations.
 */
export function useStockCount(): {
  running: boolean;
  /** False when the detection model is missing: the action is unavailable. */
  available: boolean | null;
  start: () => void;
} {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const stopRef = useRef(false);
  // Known up front, so the button can be disabled with its reason instead
  // of looking available and only answering with a toast (UW-26).
  useEffect(() => {
    let cancelled = false;
    void window.api
      .modelStatus()
      .then((status) => {
        if (!cancelled) setAvailable(status.available);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(): Promise<void> {
    const status = await window.api.modelStatus().catch(() => null);
    if (!status?.available) {
      notify.info(t("dashboard.stockCount.needsModel"), {
        action: {
          label: t("map.page.setupDetection"),
          onClick: () => void navigate("/settings?section=data"),
        },
      });
      return;
    }
    const ids = stockCountCandidates(useAppStore.getState().dealerships);
    if (ids.length === 0) {
      notify.info(t("dashboard.stockCount.nothing"));
      return;
    }
    stopRef.current = false;
    setRunning(true);
    const toastId = notify.progress(
      t("dashboard.stockCount.progress", { done: 0, total: ids.length }),
      {
        action: {
          label: t("dashboard.stockCount.stop"),
          onClick: () => {
            stopRef.current = true;
          },
        },
      },
    );
    try {
      const { counted, failed } = await useAppStore
        .getState()
        .countVehicleTimelines(
          ids,
          (done, total) =>
            notify.progress(
              t("dashboard.stockCount.progress", { done, total }),
              {
                id: toastId,
              },
            ),
          () => stopRef.current,
        );
      notify.success(
        t("dashboard.stockCount.done", { count: counted, failed }),
        { id: toastId, description: t("dashboard.stockCount.doneHint") },
      );
    } catch (error) {
      notify.error(t("dashboard.stockCount.failed"), {
        id: toastId,
        cause: error,
      });
    } finally {
      setRunning(false);
    }
  }

  return {
    running,
    available,
    start: () => {
      if (!running) void run();
    },
  };
}
