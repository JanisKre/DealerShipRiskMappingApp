import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@renderer/lib/notify";
import { useAppStore } from "@renderer/store/appStore";
import {
  ensureDecisionState,
  useDecisionStore,
} from "@renderer/store/decisionStore";
import { siteRunCandidates } from "./siteQuestionsRun";

/**
 * Asks the site-question engine about every analysed location it has not
 * answered yet, one after another, with a progress toast that can stop the
 * run between locations. Each answer is saved as it arrives.
 */
export function useSiteQuestionsRun(): {
  running: boolean;
  /** The engine; null when none is set up (the action is unavailable). */
  engine: ReturnType<typeof useDecisionStore.getState>["engine"];
  local: boolean;
  start: () => void;
} {
  const { t } = useTranslation();
  const engine = useDecisionStore((s) => s.engine);
  const local = useDecisionStore((s) => s.local);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  useEffect(ensureDecisionState, []);

  async function run(): Promise<void> {
    if (!engine) return;
    const ids = siteRunCandidates(useAppStore.getState().dealerships, engine);
    if (ids.length === 0) {
      notify.info(t("siteQuestions.run.nothing"));
      return;
    }
    stopRef.current = false;
    setRunning(true);
    const progress = (done: number): string =>
      t("siteQuestions.run.progress", { done, total: ids.length });
    const toastId = notify.progress(progress(0), {
      action: {
        label: t("siteQuestions.run.stop"),
        onClick: () => {
          stopRef.current = true;
        },
      },
    });
    let answered = 0;
    let failed = 0;
    let lastError: unknown = null;
    try {
      for (const [index, id] of ids.entries()) {
        if (stopRef.current) break;
        const d = useAppStore.getState().dealerships.find((x) => x.id === id);
        if (!d) continue;
        try {
          const result = await window.api.answerSiteQuestions({
            lat: d.lat,
            lon: d.lon,
            boundary: d.boundary,
          });
          await useAppStore.getState().recordSiteAnswers(id, result.answers);
          answered++;
        } catch (error) {
          failed++;
          lastError = error;
          // A missing key or a refused request fails every location alike.
          if (failed >= 3 && answered === 0) break;
        }
        notify.progress(progress(index + 1), { id: toastId });
      }
      if (answered === 0 && lastError) {
        notify.error(t("siteQuestions.run.failed"), {
          id: toastId,
          cause: lastError,
        });
      } else {
        notify.success(
          t("siteQuestions.run.done", { count: answered, failed }),
          { id: toastId, description: t("siteQuestions.run.doneHint") },
        );
      }
    } finally {
      setRunning(false);
    }
  }

  return {
    running,
    engine,
    local,
    start: () => {
      if (!running) void run();
    },
  };
}
