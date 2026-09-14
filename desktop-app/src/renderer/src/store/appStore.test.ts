import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzedDealership, DealershipInput } from "@shared/types";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { DEFAULT_PORTFOLIO_NAME, useAppStore } from "./appStore";

const api = {
  analyzeDealership: vi.fn(),
  saveSession: vi.fn(),
  loadSession: vi.fn(),
  deleteSession: vi.fn(),
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

describe("location removal", () => {
  const seeded = [
    { ...firstInput } as AnalyzedDealership,
    { ...secondInput } as AnalyzedDealership,
  ];

  it("removes a single location and clears its selection", () => {
    useAppStore.setState({
      dealerships: seeded,
      selectedId: "one",
      analysisErrors: { one: "boom" },
    });

    useAppStore.getState().removeDealership("one");

    expect(useAppStore.getState().dealerships.map((d) => d.id)).toEqual([
      "two",
    ]);
    expect(useAppStore.getState().selectedId).toBeNull();
    expect(useAppStore.getState().analysisErrors).toEqual({});
  });

  it("removes multiple locations at once and leaves an unrelated selection untouched", () => {
    useAppStore.setState({
      dealerships: seeded,
      selectedId: "two",
      analysisErrors: { one: "boom" },
    });

    useAppStore.getState().removeDealerships(["one"]);

    expect(useAppStore.getState().dealerships.map((d) => d.id)).toEqual([
      "two",
    ]);
    expect(useAppStore.getState().selectedId).toBe("two");
    expect(useAppStore.getState().analysisErrors).toEqual({});
  });

  it("clears the selection when the selected location is among those removed", () => {
    useAppStore.setState({ dealerships: seeded, selectedId: "one" });

    useAppStore.getState().removeDealerships(["one", "two"]);

    expect(useAppStore.getState().dealerships).toHaveLength(0);
    expect(useAppStore.getState().selectedId).toBeNull();
  });
});

describe("portfolio switching", () => {
  const seeded = [{ ...firstInput } as AnalyzedDealership];

  it("saves the current portfolio before starting a new one, then resets", async () => {
    useAppStore.setState({
      sessionId: "abc",
      sessionName: "Old name",
      dealerships: seeded,
      selectedId: "one",
      lastSavedAt: "2026-01-01T00:00:00.000Z",
    });

    await useAppStore.getState().newPortfolio();

    expect(api.saveSession).toHaveBeenCalledTimes(1);
    expect(api.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "abc", name: "Old name" }),
    );
    const state = useAppStore.getState();
    expect(state.sessionId).toBeNull();
    expect(state.sessionName).toBe(DEFAULT_PORTFOLIO_NAME);
    expect(state.dealerships).toEqual([]);
    expect(state.parameters).toEqual(DEFAULT_RISK_PARAMETERS);
    expect(state.selectedId).toBeNull();
    expect(state.lastSavedAt).toBeNull();
  });

  it("does not save when starting a new portfolio from an already-empty one", async () => {
    useAppStore.setState({ dealerships: [] });

    await useAppStore.getState().newPortfolio();

    expect(api.saveSession).not.toHaveBeenCalled();
  });

  it("saves the current portfolio, then loads the target by id", async () => {
    const other: AnalyzedDealership = { ...secondInput } as AnalyzedDealership;
    api.loadSession.mockResolvedValue({
      id: "target",
      name: "Other portfolio",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      dealerships: [other],
      parameters: DEFAULT_RISK_PARAMETERS,
    });
    useAppStore.setState({
      sessionId: "abc",
      sessionName: "Current",
      dealerships: seeded,
    });

    await useAppStore.getState().switchSession("target");

    expect(api.saveSession).toHaveBeenCalledTimes(1);
    expect(api.loadSession).toHaveBeenCalledWith("target");
    const state = useAppStore.getState();
    expect(state.sessionId).toBe("target");
    expect(state.sessionName).toBe("Other portfolio");
    expect(state.dealerships).toEqual([other]);
  });

  it("does nothing when switching to the already-active portfolio", async () => {
    useAppStore.setState({ sessionId: "abc", dealerships: seeded });

    await useAppStore.getState().switchSession("abc");

    expect(api.saveSession).not.toHaveBeenCalled();
    expect(api.loadSession).not.toHaveBeenCalled();
  });

  it("renames the active portfolio in place and persists it immediately", async () => {
    useAppStore.setState({
      sessionId: "abc",
      sessionName: "Old name",
      dealerships: seeded,
    });

    await useAppStore.getState().renameSavedSession("abc", "  New name  ");

    expect(useAppStore.getState().sessionName).toBe("New name");
    expect(api.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "abc", name: "New name" }),
    );
  });

  it("renames a different, not-currently-active portfolio via load+save", async () => {
    api.loadSession.mockResolvedValue({
      id: "other",
      name: "Old other name",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      dealerships: [],
      parameters: DEFAULT_RISK_PARAMETERS,
    });
    useAppStore.setState({ sessionId: "abc", sessionName: "Active" });

    await useAppStore.getState().renameSavedSession("other", "New other name");

    expect(api.loadSession).toHaveBeenCalledWith("other");
    expect(api.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "other", name: "New other name" }),
    );
    // The active portfolio's own name is untouched.
    expect(useAppStore.getState().sessionName).toBe("Active");
  });

  it("ignores a blank rename", async () => {
    useAppStore.setState({ sessionId: "abc", sessionName: "Keep me" });

    await useAppStore.getState().renameSavedSession("abc", "   ");

    expect(useAppStore.getState().sessionName).toBe("Keep me");
    expect(api.saveSession).not.toHaveBeenCalled();
  });

  it("deletes a saved portfolio and resets to a blank one when it was active", async () => {
    useAppStore.setState({
      sessionId: "abc",
      sessionName: "Doomed",
      dealerships: seeded,
      selectedId: "one",
      lastSavedAt: "2026-01-01T00:00:00.000Z",
    });

    await useAppStore.getState().deleteSavedSession("abc");

    expect(api.deleteSession).toHaveBeenCalledWith("abc");
    const state = useAppStore.getState();
    expect(state.sessionId).toBeNull();
    expect(state.sessionName).toBe(DEFAULT_PORTFOLIO_NAME);
    expect(state.dealerships).toEqual([]);
    expect(state.selectedId).toBeNull();
  });

  it("deletes a saved portfolio without resetting when it wasn't active", async () => {
    useAppStore.setState({
      sessionId: "abc",
      sessionName: "Still active",
      dealerships: seeded,
    });

    await useAppStore.getState().deleteSavedSession("someone-else");

    expect(api.deleteSession).toHaveBeenCalledWith("someone-else");
    const state = useAppStore.getState();
    expect(state.sessionId).toBe("abc");
    expect(state.sessionName).toBe("Still active");
    expect(state.dealerships).toEqual(seeded);
  });
});

describe("bulk insured marking", () => {
  it("marks the selected locations as insured and leaves others untouched", () => {
    useAppStore.setState({
      dealerships: [
        { ...firstInput, insured: false } as AnalyzedDealership,
        { ...secondInput, insured: false } as AnalyzedDealership,
      ],
    });

    useAppStore.getState().setInsuredForDealerships(["one"], true);

    const byId = new Map(
      useAppStore.getState().dealerships.map((d) => [d.id, d.insured]),
    );
    expect(byId.get("one")).toBe(true);
    expect(byId.get("two")).toBe(false);
  });

  it("marks multiple selected locations as not insured", () => {
    useAppStore.setState({
      dealerships: [
        { ...firstInput, insured: true } as AnalyzedDealership,
        { ...secondInput, insured: true } as AnalyzedDealership,
      ],
    });

    useAppStore.getState().setInsuredForDealerships(["one", "two"], false);

    const byId = new Map(
      useAppStore.getState().dealerships.map((d) => [d.id, d.insured]),
    );
    expect(byId.get("one")).toBe(false);
    expect(byId.get("two")).toBe(false);
  });
});
