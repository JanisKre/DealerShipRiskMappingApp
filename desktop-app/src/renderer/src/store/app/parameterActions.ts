import {
  DEFAULT_RISK_PARAMETERS,
  normalizeRiskParameters,
} from "@shared/parameters";
import { boundaryNeedsReview } from "@shared/boundary-review";
import { type AppState, type StoreSet } from "./types";
import { portfolioGeneration, rescoreWithConcurrency } from "./runtime";

/** Risk parameters: set, change (with rescoring) and reset. */
export function parameterActions(
  set: StoreSet,
  get: () => AppState,
): Pick<AppState, "setParameters" | "updateParameters" | "resetParameters"> {
  return {
    setParameters: (parameters) =>
      set({ parameters: normalizeRiskParameters(parameters) }),

    updateParameters: async (patch) => {
      const parameters = normalizeRiskParameters({
        ...get().parameters,
        ...patch,
      });
      set({ parameters, parametersUpdating: true });
      const generation = portfolioGeneration();
      try {
        const current = get().dealerships.filter(
          (d) => d.lat != null && d.lon != null,
        );
        const updates = await rescoreWithConcurrency(current, parameters, 4);
        // Another portfolio was opened meanwhile: it has its own parameters.
        if (generation !== portfolioGeneration()) return;
        set((s) => ({
          dealerships: s.dealerships.map((d) => {
            const update = updates.find((x) => x.id === d.id);
            const boundary = d.boundary
              ? {
                  ...d.boundary,
                  reviewRequired: boundaryNeedsReview(d.boundary, parameters),
                }
              : d.boundary;
            return update
              ? { ...d, boundary, risk: update.risk }
              : { ...d, boundary };
          }),
        }));
      } catch (err) {
        console.error("Parameter recalculation failed:", err);
      } finally {
        if (generation === portfolioGeneration()) {
          await get()
            .saveSession()
            .catch((err: unknown) => {
              console.error("Saving parameters failed:", err);
            });
        }
        set({ parametersUpdating: false });
      }
    },

    resetParameters: async () => {
      await get().updateParameters(DEFAULT_RISK_PARAMETERS);
    },
  };
}
