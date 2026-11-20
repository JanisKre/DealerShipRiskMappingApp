import { describe, expect, it } from "vitest";
import {
  AS_IF_HITS_PER_DAY,
  AsIfRequestSchema,
  aggregateAsIf,
  isAsIfSource,
  rankCandidateDays,
  utcDay,
  type AsIfEvent,
} from "./as-if-history";
import type { ClassDamage } from "./hail-events";

const DAMAGE: ClassDamage = { large: 0.3, hail: 0.15, mixed: 0.05 };

function event(
  id: string,
  day: string,
  hits: AsIfEvent["hits"],
  source: AsIfEvent["source"] = "radklim",
): AsIfEvent {
  return { id, source, day, hits };
}

describe("as-if sources", () => {
  it("counts real events only", () => {
    expect(isAsIfSource("radklim")).toBe(true);
    expect(isAsIfSource("radar")).toBe(true);
    expect(isAsIfSource("import")).toBe(true);
    expect(isAsIfSource("simulation")).toBe(false);
    expect(isAsIfSource("drawn")).toBe(false);
  });

  it("names the UTC day of a moment", () => {
    expect(utcDay(Date.UTC(2013, 6, 28, 23, 59))).toBe("2013-07-28");
    expect(utcDay(Date.UTC(2013, 6, 29, 0, 0))).toBe("2013-07-29");
  });
});

describe("aggregateAsIf", () => {
  it("prices each hit with the damage rate of its class", () => {
    const { days, totals } = aggregateAsIf(
      [
        event("radklim-20130728", "2013-07-28", [
          { id: "a", hailClass: "large", exposureEur: 10_000_000 },
          { id: "b", hailClass: "hail", exposureEur: 4_000_000 },
          { id: "c", hailClass: "mixed", exposureEur: 2_000_000 },
        ]),
      ],
      DAMAGE,
    );
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      day: "2013-07-28",
      eventIds: ["radklim-20130728"],
      sources: ["radklim"],
      hitCount: 3,
      exposureEur: 16_000_000,
      lossEur: 3_000_000 + 600_000 + 100_000,
      maxClass: "large",
    });
    expect(days[0].hits.map((h) => h.id)).toEqual(["a", "b", "c"]);
    expect(totals).toEqual({ days: 1, hitDays: 1, lossEur: 3_700_000 });
  });

  it("counts a location once per day and keeps its worst class", () => {
    const { days } = aggregateAsIf(
      [
        event("radklim-20260610", "2026-06-10", [
          { id: "a", hailClass: "hail", exposureEur: 1_000_000 },
          { id: "b", hailClass: "mixed", exposureEur: 1_000_000 },
        ]),
        event(
          "radar-20260610T14",
          "2026-06-10",
          [{ id: "a", hailClass: "large", exposureEur: 1_000_000 }],
          "radar",
        ),
      ],
      DAMAGE,
    );
    expect(days).toHaveLength(1);
    expect(days[0].eventIds).toEqual(["radar-20260610T14", "radklim-20260610"]);
    expect(days[0].sources).toEqual(["radar", "radklim"]);
    expect(days[0].hitCount).toBe(2);
    expect(days[0].lossEur).toBe(300_000 + 50_000);
  });

  it("keeps a day without a hit as evaluated and loss-free", () => {
    const { days, years, totals } = aggregateAsIf(
      [
        event("radklim-20100712", "2010-07-12", []),
        event("radklim-20100713", "2010-07-13", [
          { id: "a", hailClass: "hail", exposureEur: 2_000_000 },
        ]),
      ],
      DAMAGE,
    );
    expect(days.map((d) => d.day)).toEqual(["2010-07-13", "2010-07-12"]);
    expect(days[1]).toMatchObject({ hitCount: 0, lossEur: 0, maxClass: null });
    expect(years).toEqual([
      {
        year: 2010,
        days: 2,
        hitDays: 1,
        lossEur: 300_000,
        worstDay: "2010-07-13",
        worstDayLossEur: 300_000,
      },
    ]);
    expect(totals).toEqual({ days: 2, hitDays: 1, lossEur: 300_000 });
  });

  it("sums per year, oldest first, and leaves out years without a day", () => {
    const { years } = aggregateAsIf(
      [
        event("x", "2013-07-28", [
          { id: "a", hailClass: "large", exposureEur: 10_000_000 },
        ]),
        event("y", "2013-06-20", [
          { id: "a", hailClass: "hail", exposureEur: 10_000_000 },
        ]),
        event("z", "2008-05-30", [
          { id: "b", hailClass: "hail", exposureEur: 2_000_000 },
        ]),
      ],
      DAMAGE,
    );
    expect(years.map((y) => y.year)).toEqual([2008, 2013]);
    expect(years[1]).toMatchObject({
      days: 2,
      hitDays: 2,
      lossEur: 4_500_000,
      worstDay: "2013-07-28",
      worstDayLossEur: 3_000_000,
    });
  });

  it("has no worst day in a year without a loss", () => {
    const { years } = aggregateAsIf([event("x", "2005-08-01", [])], DAMAGE);
    expect(years[0]).toMatchObject({ worstDay: null, worstDayLossEur: 0 });
  });

  it("lists only the largest losses per day but sums all of them", () => {
    const hits = Array.from({ length: AS_IF_HITS_PER_DAY + 5 }, (_, i) => ({
      id: `s${String(i).padStart(2, "0")}`,
      hailClass: "hail" as const,
      exposureEur: (i + 1) * 1_000_000,
    }));
    const { days } = aggregateAsIf([event("x", "2019-06-10", hits)], DAMAGE);
    expect(days[0].hitCount).toBe(AS_IF_HITS_PER_DAY + 5);
    expect(days[0].hits).toHaveLength(AS_IF_HITS_PER_DAY);
    expect(days[0].hits[0].id).toBe("s14");
    expect(days[0].lossEur).toBe(
      hits.reduce((s, h) => s + h.exposureEur * 0.15, 0),
    );
  });

  it("skips an event without a valid day and is deterministic", () => {
    const events = [
      event("bad", "1970", [{ id: "a", hailClass: "hail", exposureEur: 1 }]),
      event("b", "2011-08-26", [
        { id: "z", hailClass: "hail", exposureEur: 100 },
        { id: "a", hailClass: "hail", exposureEur: 100 },
      ]),
    ];
    const first = aggregateAsIf(events, DAMAGE);
    expect(first.days).toHaveLength(1);
    expect(first.days[0].hits.map((h) => h.id)).toEqual(["a", "z"]);
    expect(aggregateAsIf([...events].reverse(), DAMAGE)).toEqual(first);
  });
});

describe("as-if request", () => {
  it("rejects coordinates and damage rates out of range", () => {
    const ok = {
      sites: [{ id: "a", lat: 48.1, lon: 11.6, exposureEur: 5 }],
      damage: DAMAGE,
      radiusKm: 1,
    };
    expect(AsIfRequestSchema.safeParse(ok).success).toBe(true);
    expect(
      AsIfRequestSchema.safeParse({
        ...ok,
        sites: [{ id: "a", lat: 95, lon: 11.6, exposureEur: 5 }],
      }).success,
    ).toBe(false);
    expect(
      AsIfRequestSchema.safeParse({ ...ok, damage: { ...DAMAGE, large: 1.5 } })
        .success,
    ).toBe(false);
    expect(AsIfRequestSchema.safeParse({ ...ok, radiusKm: 50 }).success).toBe(
      false,
    );
  });
});

describe("rankCandidateDays", () => {
  const dates = new Map<string, string[]>([
    ["00001", ["2000-06-01", "2008-05-30", "2009-07-03", "2009-07-03"]],
    ["00002", ["2008-05-30", "2010-07-12"]],
    ["00003", ["2030-01-01"]],
  ]);
  const assignments = [
    { stationId: "00001", exposureEur: 5_000_000 },
    { stationId: "00001", exposureEur: 3_000_000 },
    { stationId: "00002", exposureEur: 20_000_000 },
    { stationId: "00003", exposureEur: 1 },
  ];
  const range = { from: "2001-01-01", to: "2026-11-18" };

  it("ranks by the exposure whose station saw hail", () => {
    const days = rankCandidateDays(assignments, dates, range);
    expect(days).toEqual([
      {
        day: "2008-05-30",
        stations: 2,
        sites: 3,
        exposureEur: 28_000_000,
        loaded: false,
      },
      {
        day: "2010-07-12",
        stations: 1,
        sites: 1,
        exposureEur: 20_000_000,
        loaded: false,
      },
      {
        day: "2009-07-03",
        stations: 1,
        sites: 2,
        exposureEur: 8_000_000,
        loaded: false,
      },
    ]);
  });

  it("marks loaded days and honours the limit", () => {
    const days = rankCandidateDays(assignments, dates, {
      ...range,
      loaded: new Set(["2008-05-30"]),
      limit: 2,
    });
    expect(days.map((d) => [d.day, d.loaded])).toEqual([
      ["2008-05-30", true],
      ["2010-07-12", false],
    ]);
  });

  it("is empty without stations", () => {
    expect(rankCandidateDays([], dates, range)).toEqual([]);
    expect(rankCandidateDays(assignments, new Map(), range)).toEqual([]);
  });
});
