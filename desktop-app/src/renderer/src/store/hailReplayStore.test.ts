import { beforeEach, describe, expect, it } from "vitest";
import { summarizeEvent, type HailEventDetail } from "@shared/hail-events";
import { simulationEvidence } from "@shared/hail-sim";
import type { HailstormScenario } from "@shared/types";
import { useAppStore } from "./appStore";
import { showCorridor, showStorm, useHailReplayStore } from "./hailReplayStore";

const storm: HailEventDetail = {
  summary: summarizeEvent("sim-1", "simulation", "Sturm", true, []),
  cells: [],
  evidence: simulationEvidence("simulation"),
};

const corridor: HailstormScenario = {
  id: "corridor-1",
  name: "Korridor",
  pathCoordinates: [
    [13.7, 51.0],
    [13.9, 51.1],
  ],
  widthKm: 20,
  intensityLevel: "HIGH",
  returnPeriodYears: 100,
  exposureMultiplier: 1,
  modelVersion: "test",
};

describe("one hail scenario at a time", () => {
  beforeEach(() => {
    useAppStore.getState().setScenario(null);
    useHailReplayStore.getState().setDetail(null);
  });

  it("a storm takes the place of the corridor", () => {
    useAppStore.getState().setScenario(corridor);

    showStorm(storm, true);

    expect(useHailReplayStore.getState().detail).toBe(storm);
    expect(useAppStore.getState().scenario).toBeNull();
  });

  it("a corridor takes the place of the storm", () => {
    useHailReplayStore.getState().setDetail(storm);

    showCorridor(corridor);

    expect(useAppStore.getState().scenario).toBe(corridor);
    expect(useHailReplayStore.getState().detail).toBeNull();
  });
});
