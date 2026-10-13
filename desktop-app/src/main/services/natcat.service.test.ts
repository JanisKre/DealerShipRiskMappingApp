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

  it("queries the hail source once and keeps only its hail value", async () => {
    mocks.settings = {
      language: "en",
      natCat: {
        provider: "screening",
        primary: "swissre-catnet",
        connectors: {
          "swissre-catnet": { endpoint: "https://catnet.example/lookup" },
          "munichre-lri": { endpoint: "https://munichre.example/lookup" },
        },
      },
    };
    fetchMock.mockImplementation((input, init) => {
      expect(new URL(String(input)).host).toBe("catnet.example");
      expect(JSON.parse(String(init?.body))).toEqual({
        latitude: 50,
        longitude: 8,
        perils: ["hail"],
      });
      return Promise.resolve(
        json({
          hazards: [
            { peril: "hail", score: 70 },
            { peril: "flood", score: 20 },
          ],
        }),
      );
    });

    const result = await resolveNatCat(50, 8);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.provider).toBe("swissre-catnet");
    expect(result?.hazards).toHaveLength(1);
    expect(result?.hazards[0]).toMatchObject({
      peril: "hail",
      score: 70,
      provider: "swissre-catnet",
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
        connectors: {
          "munichre-lri": { endpoint: "https://munichre.example/lookup" },
        },
      },
    };
    fetchMock.mockResolvedValueOnce(
      json({ hazards: [{ peril: "hail", score: 40 }] }),
    );
    await expect(testNatCatConnector("munichre-lri")).resolves.toMatchObject({
      ok: true,
      perils: ["hail"],
    });

    await expect(testNatCatConnector("verisk-li")).resolves.toMatchObject({
      ok: false,
      message: "verisk-li is not connected",
    });
  });
});
