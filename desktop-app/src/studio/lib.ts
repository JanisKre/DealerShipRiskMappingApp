import { toast } from "sonner";
import { api, type Evaluation, type Status, type Threshold } from "./api";

/** The model new suggestions and the analysis tools use: the latest round, else the installed run. */
export function currentRun(status: Status): string {
  const last = status.rounds[status.rounds.length - 1];
  if (last && status.weights.includes(last.run)) return last.run;
  if (status.weights.includes("dealer-obb")) return "dealer-obb";
  return status.weights[status.weights.length - 1] ?? "";
}

/** Latest app-pipeline evaluation of a run. */
export function appEvaluation(status: Status, run: string): Evaluation | null {
  return (
    [...status.evals]
      .reverse()
      .find((e) => e.run === run && e.pipeline === "app-inferWindow") ?? null
  );
}

export function ultralyticsEvaluation(
  status: Status,
  run: string,
): Evaluation | null {
  return (
    [...status.evals]
      .reverse()
      .find((e) => e.run === run && e.pipeline === "ultralytics") ?? null
  );
}

export function bestThreshold(e: Evaluation): Threshold {
  return e.thresholds.reduce((a, t) => (t.mae < a.mae ? t : a));
}

/**
 * Default threshold for the manifest: the smallest |bias| in the flat optimum,
 * i.e. among thresholds within ¾ vehicle of the best MAE
 * (docs/detection-benchmark.md, "Model default threshold"; 0.45 for the shipped model).
 */
export function suggestedThreshold(e: Evaluation): Threshold {
  const best = bestThreshold(e).mae;
  return e.thresholds
    .filter((t) => t.mae <= best + 0.75)
    .reduce((a, t) => (Math.abs(t.bias) < Math.abs(a.bias) ? t : a));
}

/** Starts a studio step and reports the outcome as a toast. */
export async function startStep(
  step: string,
  options: Record<string, unknown>,
  onStarted: () => void,
  confirmText?: string,
): Promise<void> {
  if (confirmText && !confirm(confirmText)) return;
  try {
    await api.run(step, options);
    toast.success("Gestartet. Den Fortschritt siehst du oben rechts.");
    onStarted();
  } catch (e) {
    toast.error((e as Error).message);
  }
}
