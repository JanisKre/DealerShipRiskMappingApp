import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCircuitBreaker,
  DEFAULT_FAIL_THRESHOLD,
  DEFAULT_OPEN_MS,
} from "./circuit-breaker";

afterEach(() => {
  vi.useRealTimers();
});

describe("createCircuitBreaker", () => {
  it("stays closed until the failure threshold is reached", () => {
    const breaker = createCircuitBreaker();
    for (let i = 0; i < DEFAULT_FAIL_THRESHOLD - 1; i += 1) {
      breaker.recordFailure("NRW");
      expect(breaker.isOpen("NRW")).toBe(false);
    }
    breaker.recordFailure("NRW");
    expect(breaker.isOpen("NRW")).toBe(true);
  });

  it("isolates keys from each other", () => {
    const breaker = createCircuitBreaker({ failThreshold: 1 });
    breaker.recordFailure("Sachsen");
    expect(breaker.isOpen("Sachsen")).toBe(true);
    expect(breaker.isOpen("Berlin")).toBe(false);
  });

  it("closes again once the open window elapses", () => {
    vi.useFakeTimers();
    const breaker = createCircuitBreaker({ failThreshold: 1, openMs: 1_000 });
    breaker.recordFailure("Berlin");
    expect(breaker.isOpen("Berlin")).toBe(true);
    vi.advanceTimersByTime(1_001);
    expect(breaker.isOpen("Berlin")).toBe(false);
  });

  it("a success clears accumulated failures", () => {
    const breaker = createCircuitBreaker({ failThreshold: 2 });
    breaker.recordFailure("NRW");
    breaker.recordSuccess("NRW");
    breaker.recordFailure("NRW");
    // Without the reset this second failure would have opened the circuit.
    expect(breaker.isOpen("NRW")).toBe(false);
  });

  it("uses a 3-failure / 30s policy by default", () => {
    expect(DEFAULT_FAIL_THRESHOLD).toBe(3);
    expect(DEFAULT_OPEN_MS).toBe(30_000);
  });

  it("reset drops all state", () => {
    const breaker = createCircuitBreaker({ failThreshold: 1 });
    breaker.recordFailure("NRW");
    breaker.reset();
    expect(breaker.isOpen("NRW")).toBe(false);
  });
});

describe("explicit stand-down", () => {
  it("opens immediately for the requested duration", () => {
    vi.useFakeTimers();
    const breaker = createCircuitBreaker({ failThreshold: 3, openMs: 1_000 });
    // One 429 must stand the endpoint down at once — reaching a failure
    // threshold by retrying is exactly what a rate limit forbids.
    breaker.recordFailure("mirror", 60_000);
    expect(breaker.isOpen("mirror")).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(breaker.isOpen("mirror")).toBe(true);
    vi.advanceTimersByTime(30_001);
    expect(breaker.isOpen("mirror")).toBe(false);
  });

  it("ignores a non-positive duration and falls back to counting", () => {
    const breaker = createCircuitBreaker({ failThreshold: 2 });
    breaker.recordFailure("mirror", 0);
    expect(breaker.isOpen("mirror")).toBe(false);
    breaker.recordFailure("mirror", 0);
    expect(breaker.isOpen("mirror")).toBe(true);
  });
});
