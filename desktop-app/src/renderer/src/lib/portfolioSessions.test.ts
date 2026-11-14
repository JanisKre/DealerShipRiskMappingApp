import { describe, expect, it } from "vitest";
import {
  groupSessions,
  isSnapshot,
  pickActiveSession,
} from "./portfolioSessions";

const live = { id: "live", name: "West", updatedAt: "2026-11-14T10:00:00Z" };
const snap = {
  id: "snap",
  name: "West – Stand 14.11.26, 14:47",
  updatedAt: "2026-11-14T14:47:00Z",
  snapshotOf: "live",
};
const older = { id: "old", name: "Ost", updatedAt: "2026-11-01T10:00:00Z" };

describe("portfolio sessions", () => {
  it("never opens a saved state at start-up, even when it is newest", () => {
    expect(pickActiveSession([snap, live, older])?.id).toBe("live");
    expect(pickActiveSession([snap])).toBeUndefined();
  });

  it("skips the excluded id (the portfolio just deleted)", () => {
    expect(pickActiveSession([snap, live, older], "live")?.id).toBe("old");
  });

  it("groups saved states below the portfolios", () => {
    const { portfolios, snapshots } = groupSessions([snap, live, older]);
    expect(portfolios.map((s) => s.id)).toEqual(["live", "old"]);
    expect(snapshots.map((s) => s.id)).toEqual(["snap"]);
    expect(isSnapshot(live)).toBe(false);
  });
});
