import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzedDealership, DealershipInput } from "@shared/types";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import {
  DEFAULT_PORTFOLIO_NAME,
  applyBusinessClassification,
  useAppStore,
} from "./appStore";
import { applyMetaFilters } from "@renderer/components/dashboard/PortfolioFilterBar";

const api = {
  analyzeDealership: vi.fn(),
  saveSession: vi.fn(),
  loadSession: vi.fn(),
  deleteSession: vi.fn(),
  detectVehicles: vi.fn(),
  scoreRisk: vi.fn(),
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
    expect(useAppStore.getState().progress).toMatchObject({
      done: 1,
      total: 2,
    });
    expect(useAppStore.getState().analyzing).toBe(false);
  });

  it("analyses up to three locations at once and finishes them all", async () => {
    const inputs = Array.from({ length: 7 }, (_, i) => ({
      ...firstInput,
      id: `site-${i}`,
      name: `Site ${i}`,
    }));
    let inFlight = 0;
    let peak = 0;
    api.analyzeDealership.mockImplementation(async (input: DealershipInput) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { ...input, risk: { overallScore: 10 } } as AnalyzedDealership;
    });
    api.saveSession.mockResolvedValue(undefined);

    await useAppStore.getState().analyzeAll(inputs);

    expect(peak).toBe(3);
    expect(useAppStore.getState().dealerships).toHaveLength(7);
    expect(useAppStore.getState().progress).toMatchObject({
      done: 7,
      total: 7,
    });
    expect(useAppStore.getState().analyzingIds).toEqual([]);
  });
});

describe("re-analysis and manual boundaries", () => {
  const manualBoundary = {
    source: "manual",
    role: "operationalLot",
    polygon: {
      type: "Polygon",
      coordinates: [
        [
          [7, 51],
          [7.001, 51],
          [7.001, 51.001],
          [7, 51.001],
          [7, 51],
        ],
      ],
    },
    areaSqm: 5_000,
    confidence: 1,
  } as AnalyzedDealership["boundary"];

  const priorAutoBoundary = {
    source: "osm",
    polygon: {
      type: "Polygon",
      coordinates: [
        [
          [7, 51],
          [7.002, 51],
          [7.002, 51.002],
          [7, 51.002],
          [7, 51],
        ],
      ],
    },
    areaSqm: 8_000,
    confidence: 0.6,
  } as AnalyzedDealership["boundary"];

  it("keeps a manually-confirmed boundary through re-analysis instead of overwriting it", async () => {
    const existing = {
      ...firstInput,
      boundary: manualBoundary,
      boundaryBeforeManualEdit: priorAutoBoundary,
      detection: { vehicleCount: 3, confidence: 0.5, model: "test" },
      risk: { overallScore: 20 } as AnalyzedDealership["risk"],
    } as AnalyzedDealership;
    useAppStore.setState({ dealerships: [existing] });

    // The re-run would otherwise replace the boundary with a fresh detection.
    api.analyzeDealership.mockResolvedValueOnce({
      ...existing,
      boundary: priorAutoBoundary,
      detection: { vehicleCount: 7, confidence: 0.8, model: "test" },
    } as AnalyzedDealership);
    api.detectVehicles.mockResolvedValueOnce({
      vehicleCount: 4,
      confidence: 0.7,
      model: "test",
    });
    api.scoreRisk.mockResolvedValueOnce({ overallScore: 25 });

    await useAppStore.getState().reanalyzeDealership("one");

    const updated = useAppStore
      .getState()
      .dealerships.find((d) => d.id === "one")!;
    expect(updated.boundary).toEqual(manualBoundary);
    expect(updated.boundaryBeforeManualEdit).toEqual(priorAutoBoundary);
    // Vehicles/risk are recomputed against the preserved boundary, not discarded.
    expect(api.detectVehicles).toHaveBeenCalledWith(
      existing.lat,
      existing.lon,
      manualBoundary,
      expect.anything(),
    );
    expect(updated.detection?.vehicleCount).toBe(4);
    expect(updated.risk?.overallScore).toBe(25);
  });

  it("accepts the fresh boundary as usual when the prior one was not manual", async () => {
    const existing = {
      ...firstInput,
      boundary: priorAutoBoundary,
      detection: { vehicleCount: 3, confidence: 0.5, model: "test" },
    } as AnalyzedDealership;
    useAppStore.setState({ dealerships: [existing] });

    api.analyzeDealership.mockResolvedValueOnce({
      ...existing,
      boundary: manualBoundary, // stands in for "a different auto result"
      detection: { vehicleCount: 9, confidence: 0.9, model: "test" },
    } as AnalyzedDealership);

    await useAppStore.getState().reanalyzeDealership("one");

    const updated = useAppStore
      .getState()
      .dealerships.find((d) => d.id === "one")!;
    expect(updated.boundary).toEqual(manualBoundary);
    expect(updated.detection?.vehicleCount).toBe(9);
    expect(api.detectVehicles).not.toHaveBeenCalled();
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

describe("dealership notes", () => {
  beforeEach(() => {
    api.saveSession.mockResolvedValue(undefined);
  });

  it("stores notes on the location, stamps them and persists the session", async () => {
    useAppStore.setState({
      sessionId: "abc",
      dealerships: [
        { ...firstInput, insured: true } as AnalyzedDealership,
        { ...secondInput, insured: false } as AnalyzedDealership,
      ],
    });

    await useAppStore
      .getState()
      .updateDealershipNotes("two", "Sales partner visit planned");

    const [one, two] = useAppStore.getState().dealerships;
    expect(two.notes).toBe("Sales partner visit planned");
    expect(two.notesUpdatedAt).toEqual(expect.any(String));
    expect(one.notes).toBeUndefined();
    expect(api.saveSession).toHaveBeenCalledTimes(1);
    expect(api.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        dealerships: expect.arrayContaining([
          expect.objectContaining({
            id: "two",
            notes: "Sales partner visit planned",
          }),
        ]),
      }),
    );
  });

  it("clears notes when only whitespace is saved", async () => {
    useAppStore.setState({
      dealerships: [
        {
          ...firstInput,
          notes: "Old note",
          notesUpdatedAt: "2026-01-01T00:00:00.000Z",
        } as AnalyzedDealership,
      ],
    });

    await useAppStore.getState().updateDealershipNotes("one", "   ");

    const [one] = useAppStore.getState().dealerships;
    expect(one.notes).toBeUndefined();
    expect(one.notesUpdatedAt).toBeUndefined();
    expect(api.saveSession).toHaveBeenCalledTimes(1);
  });

  it("does not save when the notes are unchanged", async () => {
    useAppStore.setState({
      dealerships: [{ ...firstInput, notes: "Same" } as AnalyzedDealership],
    });

    await useAppStore.getState().updateDealershipNotes("one", "Same");

    expect(api.saveSession).not.toHaveBeenCalled();
  });

  it("keeps notes edited while a re-analysis is running", async () => {
    useAppStore.setState({
      dealerships: [{ ...firstInput, notes: "Before" } as AnalyzedDealership],
    });
    api.analyzeDealership.mockImplementationOnce(async (input) => {
      await useAppStore.getState().updateDealershipNotes("one", "During");
      return { ...input, risk: { overallScore: 10 } } as AnalyzedDealership;
    });

    await useAppStore.getState().reanalyzeDealership("one");

    const [one] = useAppStore.getState().dealerships;
    expect(one.notes).toBe("During");
    expect(one.risk?.overallScore).toBe(10);
  });
});

describe("dealership website", () => {
  beforeEach(() => {
    api.saveSession.mockResolvedValue(undefined);
  });

  it("stores a detected OSM website and persists the session", async () => {
    useAppStore.setState({
      dealerships: [{ ...firstInput } as AnalyzedDealership],
    });

    const ok = await useAppStore
      .getState()
      .updateDealershipWebsite("one", "autohaus.de", "osm");

    expect(ok).toBe(true);
    const [one] = useAppStore.getState().dealerships;
    expect(one.website).toBe("https://autohaus.de/");
    expect(one.websiteSource).toBe("osm");
    expect(api.saveSession).toHaveBeenCalledTimes(1);
  });

  it("never lets an OSM link replace a manual one", async () => {
    useAppStore.setState({
      dealerships: [
        {
          ...firstInput,
          website: "https://manual.de/",
          websiteSource: "manual",
        } as AnalyzedDealership,
      ],
    });

    await useAppStore
      .getState()
      .updateDealershipWebsite("one", "https://osm.de/", "osm");

    const [one] = useAppStore.getState().dealerships;
    expect(one.website).toBe("https://manual.de/");
    expect(one.websiteSource).toBe("manual");
    expect(api.saveSession).not.toHaveBeenCalled();
  });

  it("replaces an OSM link manually and resets back to automatic", async () => {
    useAppStore.setState({
      dealerships: [
        {
          ...firstInput,
          website: "https://osm.de/",
          websiteSource: "osm",
        } as AnalyzedDealership,
      ],
    });

    await useAppStore
      .getState()
      .updateDealershipWebsite("one", "www.richtig.de", "manual");
    expect(useAppStore.getState().dealerships[0]).toMatchObject({
      website: "https://www.richtig.de/",
      websiteSource: "manual",
    });

    await useAppStore.getState().updateDealershipWebsite("one", null, "manual");
    const [one] = useAppStore.getState().dealerships;
    expect(one.website).toBeUndefined();
    expect(one.websiteSource).toBeUndefined();
    expect(api.saveSession).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid URL without changing the stored link", async () => {
    useAppStore.setState({
      dealerships: [
        {
          ...firstInput,
          website: "https://osm.de/",
          websiteSource: "osm",
        } as AnalyzedDealership,
      ],
    });

    const ok = await useAppStore
      .getState()
      .updateDealershipWebsite("one", "javascript:alert(1)", "manual");

    expect(ok).toBe(false);
    expect(useAppStore.getState().dealerships[0].website).toBe(
      "https://osm.de/",
    );
    expect(api.saveSession).not.toHaveBeenCalled();
  });

  it("takes a website found by re-analysis only when none is stored", async () => {
    useAppStore.setState({
      dealerships: [
        { ...firstInput } as AnalyzedDealership,
        {
          ...secondInput,
          website: "https://manual.de/",
          websiteSource: "manual",
        } as AnalyzedDealership,
      ],
    });
    api.analyzeDealership.mockImplementation(
      async (input: AnalyzedDealership) =>
        ({
          ...input,
          website: input.website ?? "https://osm.de/",
          websiteSource: input.websiteSource ?? "osm",
          risk: { overallScore: 10 },
        }) as AnalyzedDealership,
    );

    await useAppStore.getState().reanalyzeDealership("one");
    await useAppStore.getState().reanalyzeDealership("two");

    const [one, two] = useAppStore.getState().dealerships;
    expect(one).toMatchObject({
      website: "https://osm.de/",
      websiteSource: "osm",
    });
    expect(two).toMatchObject({
      website: "https://manual.de/",
      websiteSource: "manual",
    });
  });

  it("keeps a website set while a re-analysis is running", async () => {
    useAppStore.setState({
      dealerships: [{ ...firstInput } as AnalyzedDealership],
    });
    api.analyzeDealership.mockImplementationOnce(async (input) => {
      await useAppStore
        .getState()
        .updateDealershipWebsite("one", "autohaus.de", "manual");
      return { ...input, risk: { overallScore: 10 } } as AnalyzedDealership;
    });

    await useAppStore.getState().reanalyzeDealership("one");

    expect(useAppStore.getState().dealerships[0]).toMatchObject({
      website: "https://autohaus.de/",
      websiteSource: "manual",
    });
  });
});

describe("portfolio import", () => {
  const rows: DealershipInput[] = [
    { ...firstInput, insured: true },
    { ...secondInput, insured: undefined },
  ];

  beforeEach(() => {
    api.saveSession.mockResolvedValue(undefined);
    api.analyzeDealership.mockImplementation(
      async (input: DealershipInput) =>
        ({ ...input, risk: { overallScore: 10 } }) as AnalyzedDealership,
    );
  });

  it("classifies rows from the file or for the whole portfolio", () => {
    expect(
      applyBusinessClassification(rows, "file").map((r) => r.insured),
    ).toEqual([true, undefined]);
    expect(
      applyBusinessClassification(rows, "existing").map((r) => r.insured),
    ).toEqual([true, true]);
    expect(
      applyBusinessClassification(rows, "new").map((r) => r.insured),
    ).toEqual([false, false]);
  });

  it("saves the current portfolio and imports into a new, named one", async () => {
    const parameters = {
      ...DEFAULT_RISK_PARAMETERS,
      hailFrequencyZone1: 0.5,
    };
    useAppStore.setState({
      sessionId: "old",
      sessionName: "Old portfolio",
      dealerships: [
        { id: "x", name: "Existing", lat: 50, lon: 9 } as AnalyzedDealership,
      ],
      parameters,
    });

    await useAppStore.getState().importPortfolio({
      rows,
      target: "new",
      name: "  Händler Q3  ",
      business: "new",
    });

    expect(api.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "old", name: "Old portfolio" }),
    );
    expect(api.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Händler Q3" }),
    );
    const state = useAppStore.getState();
    expect(state.sessionName).toBe("Händler Q3");
    expect(state.parameters.hailFrequencyZone1).toBe(0.5);
    expect(state.dealerships.map((d) => d.id)).toEqual(["one", "two"]);
    expect(state.dealerships.every((d) => d.insured === false)).toBe(true);
  });

  it("adds to the current portfolio without renaming it", async () => {
    useAppStore.setState({
      sessionId: "cur",
      sessionName: "Current",
      dealerships: [
        { id: "x", name: "Existing", lat: 50, lon: 9 } as AnalyzedDealership,
      ],
    });

    await useAppStore.getState().importPortfolio({
      rows,
      target: "current",
      name: "ignored",
      business: "existing",
    });

    const state = useAppStore.getState();
    expect(state.sessionId).toBe("cur");
    expect(state.sessionName).toBe("Current");
    expect(state.dealerships.map((d) => d.id)).toEqual(["x", "one", "two"]);
    expect(
      state.dealerships.filter((d) => d.id !== "x").every((d) => d.insured),
    ).toBe(true);
  });

  it("filters existing vs. new business, counting unknown as new", () => {
    const portfolio = [
      { ...firstInput, insured: true },
      { ...secondInput, insured: false },
      { ...firstInput, id: "three", insured: undefined },
    ] as AnalyzedDealership[];
    const filters = useAppStore.getState().filters;

    expect(
      applyMetaFilters(portfolio, { ...filters, business: "existing" }).map(
        (d) => d.id,
      ),
    ).toEqual(["one"]);
    expect(
      applyMetaFilters(portfolio, { ...filters, business: "new" }).map(
        (d) => d.id,
      ),
    ).toEqual(["two", "three"]);
  });
});

describe("map focus", () => {
  it("requests a one-off fit to the given locations and clears the selection", () => {
    useAppStore.setState({ selectedId: "one", mapFocusIds: null });

    useAppStore.getState().focusDealerships(["one", "two"]);
    expect(useAppStore.getState().mapFocusIds).toEqual(["one", "two"]);
    expect(useAppStore.getState().selectedId).toBeNull();

    useAppStore.getState().focusDealerships(["one"], 10);
    expect(useAppStore.getState().mapFocusRadiusKm).toBe(10);

    useAppStore.getState().clearMapFocus();
    expect(useAppStore.getState().mapFocusIds).toBeNull();
    expect(useAppStore.getState().mapFocusRadiusKm).toBeNull();
  });
});

describe("rescoring keeps the postcode hail zone", () => {
  it("passes the stored hail zone to scoreRisk on a parameter change", async () => {
    const dealership: AnalyzedDealership = {
      ...firstInput,
      lat: 51,
      lon: 7,
      hailZone: 4,
    };
    useAppStore.setState({ dealerships: [dealership], sessionId: null });
    api.scoreRisk.mockResolvedValue({
      overallScore: 60,
      perils: [],
      eal: 1,
      computedAt: "2026-10-09T00:00:00.000Z",
    });
    api.saveSession.mockResolvedValue({ ok: true });

    await useAppStore.getState().updateParameters({});

    expect(api.scoreRisk).toHaveBeenCalledTimes(1);
    expect(api.scoreRisk.mock.calls[0].at(-1)).toBe(4);
  });
});
