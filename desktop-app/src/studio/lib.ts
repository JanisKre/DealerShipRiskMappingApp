import { toast } from "sonner";
import {
  api,
  ApiError,
  type Evaluation,
  type Job,
  type Status,
  type Threshold,
} from "./api";
import { askConfirm, type ConfirmOptions } from "./components/ConfirmDialog";
import i18n from "./i18n";

export const OFFLINE_EVENT = "studio:offline";

/**
 * An error in the interface language: a studio.py refusal by its code (with
 * its parameters), else the server's own text.
 */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const key = `server.${e.code}`;
    if (i18n.exists(key)) return i18n.t(key, { ...e.params, status: e.status });
  }
  return e instanceof Error ? e.message : String(e);
}

/** A job's title in the interface language (older jobs: the server's German title). */
export function jobTitle(
  job: Pick<Job, "title" | "titleKey" | "titleParams">,
): string {
  const key = `jobs.title.${job.titleKey}`;
  return job.titleKey && i18n.exists(key)
    ? i18n.t(key, job.titleParams ?? {})
    : job.title;
}

/** A stage name in the interface language (older jobs: the server's German name). */
export function stageName(
  key: string | null | undefined,
  name: string | null | undefined,
): string {
  const k = `jobs.stage.${key}`;
  return key && i18n.exists(k) ? i18n.t(k) : (name ?? "");
}

/**
 * Shows an error once: "Studio nicht erreichbar" as the page's banner (no toast
 * per failed request), "Seite neu laden" as one lasting toast with a reload
 * button, anything else as one toast per error code.
 */
export function showError(e: unknown): void {
  const code = (e as { code?: string } | null)?.code;
  const message = errorText(e);
  if (code === "offline") {
    // No toast: the page shell checks at once and shows its one banner (App.tsx).
    window.dispatchEvent(new Event(OFFLINE_EVENT));
  } else if (code === "bad_token") {
    toast.error(message, {
      id: "reload",
      duration: Infinity,
      action: {
        label: i18n.t("common.reload"),
        onClick: () => location.reload(),
      },
    });
  } else {
    toast.error(message, code ? { id: `error-${code}` } : undefined);
  }
}

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

/**
 * True when the suggested threshold is the lowest or highest one measured: the
 * real optimum may lie outside the sweep, so the value is less certain.
 */
export function atSweepEdge(e: Evaluation, t: Threshold): boolean {
  const confs = e.thresholds.map((x) => x.conf);
  return (
    confs.length > 1 &&
    (t.conf === Math.min(...confs) || t.conf === Math.max(...confs))
  );
}

/** The model new suggestions should come from: a trained run, else the start weights. */
export function suggestionSource(
  status: Status,
): { weights: string } | { base: string } | null {
  const run = currentRun(status);
  if (run) return { weights: run };
  const base = status.baseModels.includes(status.defaultBase)
    ? status.defaultBase
    : status.baseModels[0];
  return base ? { base } : null;
}

/**
 * The first missing step of a fresh setup (no sites, no tiles, no suggestions),
 * or null once labelling can start. Shared by the overview and the Labeln tab.
 */
export type SetupStep =
  | { kind: "dealers"; title: string; text: string; label: string }
  | {
      kind: "job";
      title: string;
      text: string;
      label: string;
      step: string;
      options: Record<string, unknown>;
    };

export function setupStep(status: Status): SetupStep | null {
  const t = i18n.t.bind(i18n);
  if (status.review.tiles > 0 || status.audit.tiles > 0) return null;
  if (status.sites.tiles === 0) {
    if (status.sites.sites === 0)
      return {
        kind: "dealers",
        title: t("setup.dealersTitle"),
        text: t("setup.dealersText"),
        label: t("setup.dealersLabel"),
      };
    return {
      kind: "job",
      title: t("setup.fetchTitle"),
      text: t("setup.fetchText", { count: status.sites.sites }),
      label: t("setup.fetchLabel"),
      step: "fetch",
      options: {},
    };
  }
  const source = suggestionSource(status);
  if (!source)
    return {
      kind: "job",
      title: t("setup.weightsTitle"),
      text: t("setup.weightsText", { model: status.defaultBase }),
      label: t("setup.weightsLabel"),
      step: "base-weights",
      options: { model: status.defaultBase },
    };
  return {
    kind: "job",
    title: t("setup.suggestTitle"),
    text:
      "weights" in source
        ? t("setup.suggestTextRun", {
            count: status.sites.tiles,
            model: source.weights,
          })
        : t("setup.suggestTextBase", {
            count: status.sites.tiles,
            model: source.base,
          }),
    label: t("setup.suggestLabel"),
    step: "autolabel",
    options: source,
  };
}

/** Why a round cannot start now, or null. */
export function roundBlocked(status: Status): string | null {
  if (status.job?.status === "running") return i18n.t("common.busy");
  if (!status.weights.length) return i18n.t("roundBlocked.noModel");
  if (status.finishedSites < status.minRoundSites)
    return i18n.t("roundBlocked.fewSites", {
      min: status.minRoundSites,
      finished: status.finishedSites,
    });
  return null;
}

/** Starts a studio step and reports the outcome as a toast. */
export async function startStep(
  step: string,
  options: Record<string, unknown>,
  onStarted: () => void,
  confirm?: ConfirmOptions,
): Promise<void> {
  if (confirm && !(await askConfirm(confirm))) return;
  try {
    await api.run(step, options);
    toast.success(i18n.t("common.started"));
    onStarted();
  } catch (e) {
    showError(e);
  }
}
