import { DEALERSHIP_HISTORY_MAX } from "@shared/constants";
import { BOUNDARY_UNDO_LIMIT } from "@shared/types";
import type {
  AnalyzedDealership,
  BoundaryEditState,
  DealershipInput,
  NlQueryDealership,
  DealershipChange,
} from "@shared/types";
import { dealershipHailZone, effectiveVehicleCount } from "@shared/risk-math";
import {
  type AppState,
  type ImportBusinessMode,
  type PortfolioFilters,
} from "./types";

/**
 * Applies the import's business classification: `file` keeps each row's
 * own value (unknown stays unknown), otherwise every row is set.
 */
export function applyBusinessClassification(
  rows: DealershipInput[],
  mode: ImportBusinessMode,
): DealershipInput[] {
  if (mode === "file") return rows;
  const insured = mode === "existing";
  return rows.map((row) => ({ ...row, insured }));
}

/** Existing business = marked insured; everything else counts as new business. */
export function businessType(d: { insured?: boolean }): "existing" | "new" {
  return d.insured === true ? "existing" : "new";
}

export function locationStatus(d: {
  risk?: unknown;
  boundary?: { reviewRequired?: boolean };
}): "analyzed" | "pending" {
  return d.risk ? "analyzed" : "pending";
}

export const EMPTY_FILTERS: PortfolioFilters = {
  business: null,
  subPortfolio: null,
  salesPartner: null,
  group: null,
  clusterId: null,
  boundarySource: null,
  hailZone: null,
  status: null,
};

/**
 * Everything still to analyse: the saved queue plus every location without
 * a result, so an analysis cut short (reload, crash) can always continue.
 */
export function unanalyzedInputs(s: {
  pendingAnalysis: DealershipInput[];
  dealerships: AnalyzedDealership[];
}): DealershipInput[] {
  // A queued input whose location already has a result is done: a session
  // saved between "result written" and "queue updated" must not count it
  // again (the resume notice then disagreed with the list, UW-07).
  const analysed = new Set(
    s.dealerships.filter((d) => d.risk).map((d) => d.id),
  );
  const byId = new Map(
    s.pendingAnalysis
      .filter((input) => !analysed.has(input.id))
      .map((input) => [input.id, input]),
  );
  for (const d of s.dealerships)
    if (!d.risk && !byId.has(d.id)) byId.set(d.id, d);
  return [...byId.values()];
}

/**
 * Imported rows that are not on the map yet because they have no
 * coordinates: waiting for (or failed at) the address search. The list
 * shows them, so no ticked import row disappears silently (UW-07).
 */
export function unlocatedInputs(s: {
  pendingAnalysis: DealershipInput[];
  dealerships: AnalyzedDealership[];
  failedInputs: Record<string, DealershipInput>;
  analysisErrors: Record<string, string>;
}): Array<{ input: DealershipInput; error?: string }> {
  const present = new Set(s.dealerships.map((d) => d.id));
  const out = new Map<string, { input: DealershipInput; error?: string }>();
  const consider = (input: DealershipInput): void => {
    if (present.has(input.id) || out.has(input.id)) return;
    if (input.lat != null && input.lon != null) return;
    out.set(input.id, { input, error: s.analysisErrors[input.id] });
  };
  for (const input of s.pendingAnalysis) consider(input);
  for (const input of Object.values(s.failedInputs)) consider(input);
  return [...out.values()];
}

/** Default name for a freshly created, not-yet-renamed portfolio. */
export const DEFAULT_PORTFOLIO_NAME = "New Portfolio";

/**
 * Undo steps and unsaved boundary edits as stored with the session, so
 * closing the app loses neither.
 */
export function boundaryEditsOf(
  s: Pick<AppState, "dealerships" | "boundaryEditIds" | "boundaryHistory">,
): { boundaryEdits?: Record<string, BoundaryEditState> } {
  const edits: Record<string, BoundaryEditState> = {};
  for (const d of s.dealerships) {
    const history = (s.boundaryHistory[d.id] ?? []).slice(-BOUNDARY_UNDO_LIMIT);
    const unsaved = s.boundaryEditIds.includes(d.id);
    if (history.length > 0 || unsaved) edits[d.id] = { history, unsaved };
  }
  return Object.keys(edits).length > 0 ? { boundaryEdits: edits } : {};
}

export function withoutKey<T>(
  values: Record<string, T>,
  key: string,
): Record<string, T> {
  if (!(key in values)) return values;
  const copy = { ...values };
  delete copy[key];
  return copy;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
/**
 * Persists a running batch after every finished location (UW-04): analysis
 * takes seconds per site, a save is milliseconds, and quitting mid-batch
 * must keep every result that was already shown. Saves never overlap; a
 * result that arrives while one runs triggers exactly one follow-up save.
 */
export function createCoalescedSaver(
  save: () => Promise<void>,
  onError: (err: unknown) => void = () => undefined,
): { request: () => void; flush: () => Promise<void> } {
  let running: Promise<void> | null = null;
  let again = false;
  const run = (): Promise<void> => {
    running = save()
      .catch(onError)
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          void run();
        }
      });
    return running;
  };
  return {
    request: () => {
      if (running) again = true;
      else void run();
    },
    flush: async () => {
      while (running) await running;
    },
  };
}

/**
 * Runs `analyzeDealership` for every input with bounded concurrency, updating
 * pins, errors and progress as results arrive. Autosave is paused during a
 * batch, so it saves the session after every result — a crash hours into a
 * large import must not lose everything already analysed.
 */
/** Appends a change-history entry, keeping the last DEALERSHIP_HISTORY_MAX. */
export function withChange(
  d: AnalyzedDealership,
  change: Omit<DealershipChange, "at">,
  at: string = new Date().toISOString(),
): AnalyzedDealership {
  return {
    ...d,
    history: [...(d.history ?? []), { at, ...change }].slice(
      -DEALERSHIP_HISTORY_MAX,
    ),
  };
}

/** History entry for a finished analysis. */
export function analyzedChange(
  d: AnalyzedDealership,
): Omit<DealershipChange, "at"> {
  return {
    kind: "analyzed",
    value: d.boundary?.provider ?? d.boundary?.source,
    ...(d.boundary ? { area: Math.round(d.boundary.areaSqm) } : {}),
    ...(d.detection ? { to: d.detection.vehicleCount } : {}),
  };
}

/** Flat NL query projection of a dealership (for the filter evaluator in main). */
export function toNlQueryDealership(d: AnalyzedDealership): NlQueryDealership {
  return {
    id: d.id,
    name: d.name,
    hailZone: dealershipHailZone(d)?.zone,
    vehicleCount: d.detection ? effectiveVehicleCount(d.detection) : undefined,
    utilisation: d.risk?.utilisation,
    eal: d.risk?.eal,
    exposureEur: d.risk?.exposureEur,
    boundarySource: d.boundary?.source,
    boundaryConfidence: d.boundary?.confidence,
    insured: d.insured,
    salesPartner: d.salesPartner,
    subPortfolio: d.subPortfolio,
    group: d.group,
  };
}
