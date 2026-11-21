import { create } from "zustand";
import type { DecisionSettings } from "@shared/decision-engines";
import type { DecisionEngine, ThresholdTable } from "@shared/site-questions";

/**
 * What the renderer needs to know about the site-question engine: which
 * one answers, whether the image stays on this computer, and the measured
 * thresholds. Loaded from the main process; the settings page reloads it
 * after a change.
 */
interface DecisionState {
  loaded: boolean;
  engine: DecisionEngine | null;
  model: string;
  local: boolean;
  settings: DecisionSettings | undefined;
  thresholds: ThresholdTable | undefined;
  load: () => Promise<void>;
}

export const useDecisionStore = create<DecisionState>((set) => ({
  loaded: false,
  engine: null,
  model: "",
  local: false,
  settings: undefined,
  thresholds: undefined,
  load: async () => {
    try {
      const [settings, engine] = await Promise.all([
        window.api.getSettings(),
        window.api.decisionEngine(),
      ]);
      set({
        loaded: true,
        engine: engine.engine,
        model: engine.model,
        local: engine.local,
        settings: settings.decisions,
        thresholds: settings.decisions?.thresholds,
      });
    } catch (error) {
      console.warn("Loading the site-question engine failed:", error);
      set({ loaded: true });
    }
  },
}));

/** Loads the engine state once per window; later calls reuse it. */
let started = false;
export function ensureDecisionState(): void {
  if (started) return;
  started = true;
  void useDecisionStore.getState().load();
}
