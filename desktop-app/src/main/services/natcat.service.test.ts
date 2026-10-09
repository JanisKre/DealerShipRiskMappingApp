import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@shared/types";

const mocks = vi.hoisted(() => ({
  settings: { language: "en" } as Settings,
}));

vi.mock("./settings.service", () => ({
  getSettings: () => mocks.settings,
  getNatCatApiKey: (provider: string) => `key-${provider}`,
}));

import { resolveNatCat, testNatCatConnector } from "./natcat.service";

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("NatCat source resolution", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.settings = { language: "en" };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends nothing in the default screening mode", async () => {
    await expect(resolveNatCat(50, 8)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("queries each routed source once and combines them per peril", async () => {
    mocks.settings = {
      language: "en",
      natCat: {
        provider: "screening",
        primary: "swissre-catnet",
        perilSources: { flood: "jba-flood" },
        connectors: {
          "swissre-catnet": { endpoint: "https://catnet.example/lookup" },
          "jba-flood": { endpoint: "https://jba.example/lookup" },
        },
      },
    };
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      expect(JSON.parse(String(init?.body))).toMatchObject({
        latitude: 50,
        longitude: 8,
      });
      if (new URL(url).host === "catnet.example")
        return Promise.resolve(
          json({
            hazards: [
              { peril: "hail", score: 70 },
              { peril: "flood", score: 20 },
            ],
          }),
        );
      return Promise.resolve(
        json({ hazards: [{ peril: "flood", score: 90 }] }),
      );
    });

    const result = await resolveNatCat(50, 8);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.provider).toBe("composite");
    expect(result?.hazards.find((h) => h.peril === "flood")).toMatchObject({
      score: 90,
      provider: "jba-flood",
    });
    const auth = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)
      .Authorization;
    expect(auth).toMatch(/^Bearer key-/);
  });

  it("keeps analysing when a source fails", async () => {
    mocks.settings = {
      language: "en",
      natCat: {
        provider: "screening",
        primary: "swissre-catnet",
        connectors: {
          "swissre-catnet": { endpoint: "https://catnet.example/lookup" },
        },
      },
    };
    fetchMock.mockResolvedValue(json({ error: "down" }, 503));

    await expect(resolveNatCat(50, 8)).resolves.toBeUndefined();
  });

  it("reports which perils a connector answered", async () => {
    mocks.settings = {
      language: "en",
      natCat: {
        provider: "screening",
        connectors: { "jba-flood": { endpoint: "https://jba.example/lookup" } },
      },
    };
    fetchMock.mockResolvedValueOnce(
      json({ hazards: [{ peril: "flood", score: 40 }] }),
    );
    await expect(testNatCatConnector("jba-flood")).resolves.toMatchObject({
      ok: true,
      perils: ["flood"],
    });

    await expect(testNatCatConnector("verisk-li")).resolves.toMatchObject({
      ok: false,
      message: "verisk-li is not connected",
    });
  });
});
