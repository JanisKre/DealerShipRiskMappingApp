import type { AnalyzedDealership } from "@shared/types";
import { dedupeDealerships } from "@shared/dedupe";
import { type AppState, type StoreSet } from "./types";
import {
  applyBusinessClassification,
  unanalyzedInputs,
  DEFAULT_PORTFOLIO_NAME,
  withoutKey,
  errorMessage,
  withChange,
  analyzedChange,
} from "./helpers";
import { portfolioGeneration, runAnalysisQueue } from "./runtime";

/** Analysis runs: batches, re-analysis, resume, retry and import. */
export function analysisActions(
  set: StoreSet,
  get: () => AppState,
): Pick<
  AppState,
  | "reanalyzeDealership"
  | "reanalyzeDealerships"
  | "refreshNatCat"
  | "analyzeAll"
  | "cancelAnalysis"
  | "resumeAnalysis"
  | "discardUnlocatedInput"
  | "discardPendingAnalysis"
  | "retryFailedAnalyses"
  | "addAndAnalyze"
  | "importPortfolio"
> {
  return {
    reanalyzeDealership: async (id) => {
      const d = get().dealerships.find((x) => x.id === id);
      if (!d) return;
      const generation = portfolioGeneration();
      set((s) => ({
        analyzingIds: [...s.analyzingIds, id],
        analysisErrors: withoutKey(s.analysisErrors, id),
      }));
      try {
        const result = await window.api.analyzeDealership(d, get().parameters);
        if (d.detection && result.detection) {
          result.detection = {
            ...result.detection,
            manualVehicleCount: d.detection.manualVehicleCount,
            manualVehiclePoints: d.detection.manualVehiclePoints,
            manualVehicleRemovedPoints: d.detection.manualVehicleRemovedPoints,
          };
        }
        // A manually-confirmed boundary must survive re-analysis
        // (docs/boundary-improvement-plan.de.md P7): re-running detection is
        // useful, but it must never silently discard a human's correction —
        // neither an edited outline nor a suggestion the reviewer confirmed.
        // Vehicles and risk are recomputed against the *preserved* boundary
        // rather than the freshly (re-)detected one that `result` carries.
        if (
          d.boundary?.source === "manual" ||
          d.boundary?.confirmedAt != null
        ) {
          result.boundary = d.boundary;
          result.boundaryBeforeManualEdit = d.boundaryBeforeManualEdit;
          try {
            const detection = await window.api.detectVehicles(
              d.lat,
              d.lon,
              d.boundary,
              get().parameters,
            );
            result.detection = d.detection
              ? {
                  ...detection,
                  manualVehicleCount: d.detection.manualVehicleCount,
                  manualVehiclePoints: d.detection.manualVehiclePoints,
                  manualVehicleRemovedPoints:
                    d.detection.manualVehicleRemovedPoints,
                }
              : detection;
            result.risk = await window.api.scoreRisk(
              d.lat,
              d.lon,
              d.assetValue,
              result.detection,
              d.boundary,
              get().parameters,
              result.natCat,
              result.hailZone ?? d.hailZone,
            );
          } catch (err) {
            // Never store vehicles and risk of the freshly detected boundary
            // next to the preserved one: keep the previous, consistent pair.
            console.error(
              `Re-detecting vehicles for the preserved manual boundary failed (${id}):`,
              err,
            );
            result.detection = d.detection;
            result.risk = d.risk;
            set((s) => ({
              analysisErrors: {
                ...s.analysisErrors,
                [id]: errorMessage(err),
              },
            }));
          }
        }
        // Notes and website edited while the re-analysis ran must not be
        // overwritten by the snapshot `result` was built from. A location
        // deleted meanwhile (or another portfolio opened) stays gone.
        const latest = get().dealerships.find((x) => x.id === id);
        if (!latest || generation !== portfolioGeneration()) return;
        get().upsertDealership({
          ...withChange(
            { ...result, history: latest.history },
            analyzedChange(result),
          ),
          notes: latest.notes,
          notesUpdatedAt: latest.notesUpdatedAt,
          // A link found by this run fills an empty slot only.
          website: latest.website ?? result.website,
          websiteSource: latest.website
            ? latest.websiteSource
            : result.websiteSource,
        });
      } catch (err) {
        console.error(`Re-analysis failed for ${d.name}:`, err);
        if (generation === portfolioGeneration()) {
          set((s) => ({
            analysisErrors: { ...s.analysisErrors, [id]: errorMessage(err) },
          }));
        }
      } finally {
        set((s) => ({ analyzingIds: s.analyzingIds.filter((x) => x !== id) }));
      }
    },

    reanalyzeDealerships: async (ids) => {
      const known = ids.filter((id) =>
        get().dealerships.some((d) => d.id === id),
      );
      if (known.length === 0 || get().analyzing) return;
      const generation = portfolioGeneration();
      let next = 0;
      let done = 0;
      set({
        analyzing: true,
        progress: { done: 0, total: known.length, startedAt: Date.now() },
        analysisCancelRequested: false,
      });
      async function worker(): Promise<void> {
        while (
          next < known.length &&
          !get().analysisCancelRequested &&
          generation === portfolioGeneration()
        ) {
          await get().reanalyzeDealership(known[next++]);
          done++;
          set((s) => ({
            progress: s.progress ? { ...s.progress, done } : s.progress,
          }));
        }
      }
      // Same parallelism as a batch import (see runAnalysisQueue).
      await Promise.all(
        Array.from({ length: Math.min(3, known.length) }, () => worker()),
      );
      if (generation !== portfolioGeneration()) return;
      set({ analyzing: false, analysisCancelRequested: false });
      await get()
        .saveSession()
        .catch((err: unknown) => {
          console.error("Saving after the re-analysis failed:", err);
        });
    },

    refreshNatCat: async (id) => {
      const d = get().dealerships.find((x) => x.id === id);
      if (!d) return;
      try {
        const natCat =
          (await window.api.resolveNatCat(d.lat, d.lon)) ?? undefined;
        const risk = await window.api.scoreRisk(
          d.lat,
          d.lon,
          d.assetValue,
          d.detection,
          d.boundary,
          get().parameters,
          natCat,
          d.hailZone,
        );
        const latest = get().dealerships.find((x) => x.id === id);
        if (latest) {
          get().upsertDealership({ ...latest, natCat, risk });
          await get().saveSession();
        }
      } catch (err) {
        console.error(`NatCat refresh failed for ${d.name}:`, err);
        throw err;
      }
    },

    analyzeAll: async (inputs) => {
      set({
        analyzing: true,
        progress: { done: 0, total: inputs.length, startedAt: Date.now() },
        dealerships: [],
        analyzingIds: [],
        analysisErrors: {},
        failedInputs: {},
        analysisCancelRequested: false,
      });
      await runAnalysisQueue(inputs, set, get);
    },

    cancelAnalysis: () => set({ analysisCancelRequested: true }),

    resumeAnalysis: async () => {
      const inputs = unanalyzedInputs(get());
      if (inputs.length === 0 || get().analyzing) return;
      set({
        analyzing: true,
        progress: { done: 0, total: inputs.length, startedAt: Date.now() },
        analysisCancelRequested: false,
      });
      await runAnalysisQueue(inputs, set, get);
    },

    discardUnlocatedInput: (id) => {
      set((s) => ({
        pendingAnalysis: s.pendingAnalysis.filter((p) => p.id !== id),
        failedInputs: withoutKey(s.failedInputs, id),
        analysisErrors: withoutKey(s.analysisErrors, id),
      }));
      void get()
        .saveSession()
        .catch((err: unknown) => {
          console.error("Saving after discarding an import row failed:", err);
        });
    },

    discardPendingAnalysis: () => {
      // Only forgets the queue; imported locations are never deleted here.
      set({ pendingAnalysis: [] });
      void get()
        .saveSession()
        .catch((err: unknown) => {
          console.error(
            "Saving after discarding the pending analysis failed:",
            err,
          );
        });
    },

    retryFailedAnalyses: async () => {
      const { analysisErrors, failedInputs, dealerships } = get();
      const inputs = Object.keys(analysisErrors).flatMap((id) => {
        const input = failedInputs[id] ?? dealerships.find((d) => d.id === id);
        return input ? [input] : [];
      });
      if (inputs.length === 0 || get().analyzing) return;
      set({
        analyzing: true,
        progress: { done: 0, total: inputs.length, startedAt: Date.now() },
        analysisCancelRequested: false,
      });
      await runAnalysisQueue(inputs, set, get);
    },

    addAndAnalyze: async (inputs) => {
      // Deduplicate new locations against the existing set: existing entries
      // are already unique and come first, so the newly accepted ones are
      // exactly the tail of `unique` after the existing entries.
      const existing = get().dealerships;
      const { unique, duplicates } = dedupeDealerships([
        ...existing,
        ...inputs,
      ]);
      const fresh = unique.slice(existing.length);
      if (fresh.length === 0) return duplicates.length;

      // Make pending pins with coordinates visible immediately — in one update,
      // not one store write (and map rebuild) per imported row.
      const pendingPins = fresh.filter(
        (input) => input.lat != null && input.lon != null,
      ) as AnalyzedDealership[];
      if (pendingPins.length > 0) {
        set((s) => ({ dealerships: [...s.dealerships, ...pendingPins] }));
      }

      const freshIds = fresh.map((f) => f.id);
      set((s) => ({
        lastAddedIds: freshIds,
        // Single address → select directly so the map flies to it.
        selectedId: freshIds.length === 1 ? freshIds[0] : s.selectedId,
        analyzing: true,
        progress: { done: 0, total: fresh.length, startedAt: Date.now() },
        analysisCancelRequested: false,
        analysisErrors: fresh.reduce<Record<string, string>>(
          (errors, input) => {
            delete errors[input.id];
            return errors;
          },
          { ...get().analysisErrors },
        ),
      }));

      await runAnalysisQueue(fresh, set, get);
      return duplicates.length;
    },

    importPortfolio: async ({
      rows,
      target,
      name,
      business,
      report,
      parameters: assumptions,
    }) => {
      const classified = applyBusinessClassification(rows, business);
      if (target === "new") {
        // A new portfolio keeps the parameter set in use (e.g. calibrated
        // hail EAL values) instead of falling back to the defaults, unless
        // the dialog confirmed other assumptions.
        const parameters = assumptions ?? get().parameters;
        await get().newPortfolio();
        const trimmed = name.trim();
        set({ sessionName: trimmed || DEFAULT_PORTFOLIO_NAME });
        get().setParameters(parameters);
      } else if (get().dealerships.length === 0) {
        // The first import into the empty start portfolio names it, as the
        // dialog's name field promises; otherwise it stayed "New Portfolio".
        if (name.trim()) set({ sessionName: name.trim() });
        if (assumptions) get().setParameters(assumptions);
      }
      if (report) set({ lastImportReport: report });
      // addAndAnalyze adds the pins and the pending queue synchronously and
      // then analyses for a while; save right away so the rows are listed
      // (and survive closing the app) before the analysis finishes. On the
      // next start the "resume analysis" notice takes over.
      const analysis = get().addAndAnalyze(classified);
      await get()
        .saveSession()
        .catch((err: unknown) => {
          console.error("Saving the imported portfolio failed:", err);
        });
      return analysis;
    },
  };
}
