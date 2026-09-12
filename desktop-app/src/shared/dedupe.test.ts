import { describe, expect, it } from "vitest";
import type { DealershipInput } from "./types";
import { dedupeDealerships } from "./dedupe";

/** Minimal location dataset for dedupe tests. */
function make(
  id: string,
  opts: {
    name?: string;
    address?: string;
    lat?: number;
    lon?: number;
  } = {},
): DealershipInput {
  return {
    id,
    name: opts.name ?? "Example Dealership",
    address: opts.address,
    lat: opts.lat,
    lon: opts.lon,
  };
}

describe("dedupeDealerships", () => {
  it("detects the same name + same address as a duplicate", () => {
    const a = make("a", { address: "Main St. 1, Cologne" });
    const b = make("b", { address: "Main St. 1, Cologne" });
    const { unique, duplicates } = dedupeDealerships([a, b]);
    expect(unique.map((d) => d.id)).toEqual(["a"]);
    expect(duplicates).toEqual([{ row: b, duplicateOf: "a" }]);
  });

  it("normalizes addresses independent of case/whitespace/punctuation", () => {
    const a = make("a", { address: "Main St. 1,  Cologne" });
    const b = make("b", { address: "main st 1 cologne" });
    const { duplicates } = dedupeDealerships([a, b]);
    expect(duplicates).toHaveLength(1);
  });

  it("detects the same name + nearby coordinates (<150m) as a duplicate", () => {
    const a = make("a", { lat: 50.9375, lon: 6.9603 });
    // ~50m offset to the northeast.
    const b = make("b", { lat: 50.938, lon: 6.961 });
    const { unique, duplicates } = dedupeDealerships([a, b]);
    expect(unique.map((d) => d.id)).toEqual(["a"]);
    expect(duplicates).toEqual([{ row: b, duplicateOf: "a" }]);
  });

  it("treats the same name + far-apart coordinates (>150m) as distinct", () => {
    const a = make("a", { lat: 50.9375, lon: 6.9603 });
    // ~1km away.
    const b = make("b", { lat: 50.9465, lon: 6.9603 });
    const { unique, duplicates } = dedupeDealerships([a, b]);
    expect(unique.map((d) => d.id)).toEqual(["a", "b"]);
    expect(duplicates).toEqual([]);
  });

  it("treats different names as distinct despite an identical address", () => {
    const a = make("a", { name: "Dealership North", address: "Main St. 1, Cologne" });
    const b = make("b", { name: "Dealership South", address: "Main St. 1, Cologne" });
    const { unique, duplicates } = dedupeDealerships([a, b]);
    expect(unique.map((d) => d.id)).toEqual(["a", "b"]);
    expect(duplicates).toEqual([]);
  });

  it("treats the same name without any address/coordinates as a duplicate (fallback)", () => {
    const a = make("a");
    const b = make("b");
    const { unique, duplicates } = dedupeDealerships([a, b]);
    expect(unique.map((d) => d.id)).toEqual(["a"]);
    expect(duplicates).toEqual([{ row: b, duplicateOf: "a" }]);
  });

  it("treats the same name as distinct when only one side has an address", () => {
    const a = make("a", { address: "Main St. 1, Cologne" });
    const b = make("b");
    const { unique, duplicates } = dedupeDealerships([a, b]);
    expect(unique.map((d) => d.id)).toEqual(["a", "b"]);
    expect(duplicates).toEqual([]);
  });

  it("always references the first original for multiple duplicates", () => {
    const a = make("a", { address: "Main St. 1, Cologne" });
    const b = make("b", { address: "Main St. 1, Cologne" });
    const c = make("c", { address: "Main St. 1, Cologne" });
    const { unique, duplicates } = dedupeDealerships([a, b, c]);
    expect(unique.map((d) => d.id)).toEqual(["a"]);
    expect(duplicates).toEqual([
      { row: b, duplicateOf: "a" },
      { row: c, duplicateOf: "a" },
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(dedupeDealerships([])).toEqual({ unique: [], duplicates: [] });
  });
});
