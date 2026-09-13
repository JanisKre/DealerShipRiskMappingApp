import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithResilience } from "./http.service";

afterEach(() => {
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
