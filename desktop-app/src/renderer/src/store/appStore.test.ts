import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzedDealership, DealershipInput } from "@shared/types";
import { useAppStore } from "./appStore";

const api = {
  analyzeDealership: vi.fn(),
};

const firstInput: DealershipInput = {
  id: "one",
  name: "First dealership",
  lat: 51,
  lon: 7,
};
const secondInput: DealershipInput = {
  id: "two",
  name: "Second dealership",
  lat: 52,
  lon: 8,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { api });
  useAppStore.setState({
    dealerships: [],
    analyzing: false,
    progress: null,
    analyzingIds: [],
    analysisErrors: {},
    analysisCancelRequested: false,
  });
});

describe("analysis batch controls", () => {
  it("records a per-location error and continues the batch", async () => {
    api.analyzeDealership
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({
        ...secondInput,
        risk: { overallScore: 20 },
      } as AnalyzedDealership);

    await useAppStore.getState().analyzeAll([firstInput, secondInput]);

    expect(api.analyzeDealership).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().analysisErrors).toEqual({
      one: "network unavailable",
    });
    expect(useAppStore.getState().dealerships).toHaveLength(1);
    expect(useAppStore.getState().analyzing).toBe(false);
  });

  it("stops after the active location when cancellation is requested", async () => {
    api.analyzeDealership.mockImplementationOnce(async () => {
      useAppStore.getState().cancelAnalysis();
      return {
        ...firstInput,
        risk: { overallScore: 20 },
      } as AnalyzedDealership;
    });

    await useAppStore.getState().analyzeAll([firstInput, secondInput]);

    expect(api.analyzeDealership).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().progress).toEqual({ done: 1, total: 2 });
    expect(useAppStore.getState().analyzing).toBe(false);
  });
});
