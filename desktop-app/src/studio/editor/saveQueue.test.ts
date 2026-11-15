import { describe, expect, it } from "vitest";
import type { SaveResult } from "@studio/api";
import { SaveQueue, failureOf, type SaveRequest } from "./saveQueue";
import type { TileBox } from "./boxes";

const box = (decision: TileBox["decision"]): TileBox => ({
  cls: 0,
  corners: [
    [0, 0],
    [10, 0],
    [10, 5],
    [0, 5],
  ],
  origin: "model",
  bucket: "check",
  decision,
});

const req = (
  done: boolean,
  decision: TileBox["decision"] = null,
  stem = "BY-osm1__0_0",
): SaveRequest => ({ mode: "label", stem, boxes: [box(decision)], done });

class Fail extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** A fake server: records requests and answers with what the test sets. */
function server(): {
  send: (r: SaveRequest) => Promise<SaveResult>;
  sent: SaveRequest[];
  answer: (fn: (r: SaveRequest) => SaveResult | Error) => void;
} {
  const sent: SaveRequest[] = [];
  let respond: (r: SaveRequest) => SaveResult | Error = (r) => ({
    ok: true,
    done: r.done,
    questions: 0,
  });
  return {
    sent,
    answer: (fn) => {
      respond = fn;
    },
    send: async (r) => {
      sent.push(r);
      await Promise.resolve();
      const out = respond(r);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("SaveQueue", () => {
  it("sends saves of one tile in order, never overlapping", async () => {
    let active = 0;
    let maxActive = 0;
    const order: boolean[] = [];
    const q = new SaveQueue(async (r) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await flush();
      order.push(r.done);
      active--;
      return { ok: true, done: r.done, questions: 0 };
    });
    await Promise.all([
      q.save(req(false)),
      q.save(req(true)),
      q.save(req(false)),
    ]);
    expect(order).toEqual([false, true, false]);
    expect(maxActive).toBe(1);
  });

  it("a draft queued after a finish goes out after it (B1 ordering)", async () => {
    const s = server();
    const q = new SaveQueue(s.send);
    const finished = q.save(req(true, "car"));
    q.keepDraft(req(false, null));
    await finished;
    await flush();
    expect(s.sent.map((r) => r.done)).toEqual([true, false]);
  });

  it("does not retry a save the server refused (400)", async () => {
    const s = server();
    const timers: (() => void)[] = [];
    const q = new SaveQueue(s.send, { schedule: (fn) => timers.push(fn) });
    const dropped: SaveRequest[] = [];
    q.onDropped((r) => dropped.push(r));
    s.answer(() => new Fail("box_outside_tile"));
    q.keepDraft(req(false));
    await flush();
    expect(s.sent).toHaveLength(1);
    expect(timers).toHaveLength(0);
    expect(dropped).toHaveLength(1);
    expect(q.pending()).toBe(0);
  });

  it("keeps a draft while labels are locked and stores it once unlocked (409)", async () => {
    const s = server();
    const timers: (() => void)[] = [];
    const q = new SaveQueue(s.send, { schedule: (fn) => timers.push(fn) });
    const saved: SaveRequest[] = [];
    q.onSaved((r) => saved.push(r));
    s.answer(() => new Fail("labels_locked"));
    q.keepDraft(req(false, "car"));
    await flush();
    expect(q.pending()).toBe(1);
    expect(timers).toHaveLength(1);
    // still locked: tries again later, quietly
    timers.shift()!();
    await flush();
    expect(q.pending()).toBe(1);
    expect(timers).toHaveLength(1);
    // unlocked
    s.answer((r) => ({ ok: true, done: r.done, questions: 0 }));
    timers.shift()!();
    await flush();
    expect(q.pending()).toBe(0);
    expect(saved).toHaveLength(1);
    expect(saved[0].boxes[0].decision).toBe("car");
  });

  it("gives a pending draft back to the editor that reopens the tile", async () => {
    const s = server();
    const timers: (() => void)[] = [];
    const q = new SaveQueue(s.send, { schedule: (fn) => timers.push(fn) });
    s.answer(() => new Fail("offline"));
    q.keepDraft(req(false, "no"));
    await flush();
    const draft = q.takeDraft("label", "BY-osm1__0_0");
    expect(draft?.boxes[0].decision).toBe("no");
    expect(q.pending()).toBe(0);
    // the scheduled retry finds nothing left to send
    const before = s.sent.length;
    timers.shift()!();
    await flush();
    expect(s.sent.length).toBe(before);
    expect(q.takeDraft("label", "BY-osm1__0_0")).toBeUndefined();
  });

  it("keeps drafts of different tiles apart", async () => {
    const s = server();
    const q = new SaveQueue(s.send);
    q.keepDraft(req(false, "car", "A-1__0_0"));
    q.keepDraft(req(false, "no", "A-1__0_1"));
    await flush();
    expect(s.sent.map((r) => r.stem).sort()).toEqual(["A-1__0_0", "A-1__0_1"]);
    expect(q.pending()).toBe(0);
  });
});

describe("failureOf", () => {
  it("maps server codes to what the editor does", () => {
    expect(failureOf(new Fail("labels_locked"))).toBe("locked");
    expect(failureOf(new Fail("offline"))).toBe("offline");
    expect(failureOf(new Fail("bad_token"))).toBe("reload");
    expect(failureOf(new Fail("box_outside_tile"))).toBe("rejected");
    expect(failureOf(new Error("x"))).toBe("rejected");
  });
});
