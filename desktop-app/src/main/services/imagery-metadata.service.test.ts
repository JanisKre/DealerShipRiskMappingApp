import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithResilience: vi.fn(),
}));

vi.mock("./http.service", () => ({
  fetchWithResilience: mocks.fetchWithResilience,
}));
// Pass-through cache: these tests cover the lookup, not persistence.
vi.mock("./cache.service", () => ({
  TTL: { imageryMetadata: 1 },
  cached: (_key: string, _ttl: number, fetcher: () => Promise<unknown>) =>
    fetcher(),
}));

import { getEsriImageryMetadata } from "./imagery-metadata.service";

describe("getEsriImageryMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the Esri capture date for the requested zoom", async () => {
    mocks.fetchWithResilience.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            layerId: 8,
            attributes: {
              SRC_DATE: "20190419",
              NICE_DESC: "© GeoBasis-DE/LGB",
              NICE_NAME: "Brandenburg2019",
              SRC_RES: "0.2",
            },
          },
        ],
      }),
    });

    const meta = await getEsriImageryMetadata(52, 13.2, 20);

    expect(meta.capturedAt).toBe("2019-04-19");
    expect(meta.source).toBe("© GeoBasis-DE/LGB");
    const url = String(mocks.fetchWithResilience.mock.calls[0][0]);
    expect(url).toContain("layers=all%3A8");
  });

  it("degrades to unavailable when the metadata service fails", async () => {
    mocks.fetchWithResilience.mockResolvedValue({ ok: false, status: 503 });
    await expect(getEsriImageryMetadata(52, 13.2, 19)).resolves.toMatchObject(
      { available: false, capturedAt: null },
    );

    mocks.fetchWithResilience.mockRejectedValue(new Error("offline"));
    await expect(getEsriImageryMetadata(52, 13.2, 19)).resolves.toMatchObject(
      { available: false },
    );
  });
});
