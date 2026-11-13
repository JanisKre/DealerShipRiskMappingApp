import { afterEach, describe, expect, it, vi } from "vitest";
import {
  electronNetTransport,
  fetchWithResilience,
  setHttpTransport,
} from "./http.service";

afterEach(() => {
  setHttpTransport(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("fetchWithResilience", () => {
  it("retries transient GET responses and eventually returns the response", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchWithResilience(
      "https://example.test",
      {},
      {
        backoffMs: 0,
      },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry POST requests by default", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("busy", { status: 503 }));

    const response = await fetchWithResilience(
      "https://example.test",
      { method: "POST" },
      { backoffMs: 0 },
    );

    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("turns a timeout into a typed error", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    const request = fetchWithResilience(
      "https://example.test",
      {},
      {
        timeoutMs: 10,
        retries: 0,
      },
    );
    const assertion = expect(request).rejects.toMatchObject({
      name: "HttpRequestError",
      timedOut: true,
    });
    await vi.advanceTimersByTimeAsync(10);

    await assertion;
  });
});

describe("host fair-use gate", () => {
  it("spaces Nominatim requests at least one second apart", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      starts.push(Date.now());
      return new Response("[]", { status: 200 });
    });

    const url = "https://nominatim.openstreetmap.org/search?q=a";
    const requests = Promise.all([
      fetchWithResilience(url),
      fetchWithResilience(url),
      fetchWithResilience(url),
    ]);
    await vi.runAllTimersAsync();
    await requests;

    expect(starts).toHaveLength(3);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1_000);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1_000);
  });

  it("keeps at most two Overpass requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return new Response("{}", { status: 200 });
    });

    await Promise.all(
      Array.from({ length: 5 }, () =>
        fetchWithResilience("https://overpass-api.de/api/interpreter", {
          method: "POST",
        }),
      ),
    );

    expect(peak).toBe(2);
  });
});

describe("Electron network transport", () => {
  it("sends every request through the installed transport", async () => {
    const netFetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const nodeFetch = vi.spyOn(globalThis, "fetch");
    setHttpTransport(electronNetTransport(netFetch));

    const response = await fetchWithResilience(
      new URL("https://example.test/a?b=1"),
      { headers: { "User-Agent": "test" } },
    );

    expect(response.status).toBe(200);
    expect(nodeFetch).not.toHaveBeenCalled();
    expect(netFetch).toHaveBeenCalledTimes(1);
    const [input, init] = netFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(input).toBe("https://example.test/a?b=1");
    // No session cookies, like Node's fetch; the timeout signal is kept.
    expect(init.credentials).toBe("omit");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ "User-Agent": "test" });
  });

  it("refuses non-HTTP schemes that net.fetch would otherwise read", async () => {
    const netFetch = vi.fn(async () => new Response("secret"));
    setHttpTransport(electronNetTransport(netFetch));

    for (const url of ["file:///etc/passwd", "data:text/plain,x"]) {
      await expect(
        fetchWithResilience(url, {}, { retries: 0 }),
      ).rejects.toThrow(/Unsupported URL scheme/);
    }
    expect(netFetch).not.toHaveBeenCalled();
  });

  it("falls back to Node's fetch when the transport is reset", async () => {
    const nodeFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));
    setHttpTransport(electronNetTransport(vi.fn()));
    setHttpTransport(null);

    await fetchWithResilience("https://example.test");

    expect(nodeFetch).toHaveBeenCalledTimes(1);
  });
});
