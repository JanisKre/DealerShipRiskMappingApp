import { describe, expect, it } from "vitest";
import {
  boxState,
  finalize,
  manualBox,
  unanswered,
  type TileBox,
} from "./boxes";

const corners = [
  [0, 0],
  [10, 0],
  [10, 5],
  [0, 5],
] as TileBox["corners"];

const model = (
  decision: TileBox["decision"],
  bucket: TileBox["bucket"] = "check",
): TileBox => ({
  cls: 0,
  corners,
  origin: "model",
  bucket,
  decision,
});

const label = (decision: TileBox["decision"]): TileBox => ({
  cls: 0,
  corners,
  origin: "label",
  bucket: "check",
  decision,
  labelIndex: 3,
});

describe("finalize", () => {
  it("turns unanswered model suggestions into no", () => {
    const out = finalize([model(null), model(null, "candidate")]);
    expect(out.map((b) => b.decision)).toEqual(["no", "no"]);
  });

  it("keeps answered, sure and manual boxes as they are", () => {
    const boxes = [
      model("car"),
      model("no"),
      model(null, "sure"),
      manualBox(corners),
    ];
    expect(finalize(boxes)).toEqual(boxes);
  });

  it("keeps an existing label whose audit question was not answered", () => {
    // Tester B, B5: finishing an audit tile deleted labels never looked at.
    const out = finalize([label(null), model(null)]);
    expect(out[0].decision).toBeNull();
    expect(boxState(out[0])).toBe("open");
    expect(out[1].decision).toBe("no");
  });

  it("still drops a label you answered with no", () => {
    expect(finalize([label("no")])[0].decision).toBe("no");
  });
});

describe("unanswered", () => {
  it("counts suggestions and labels separately", () => {
    expect(
      unanswered([model(null), model(null), label(null), model("car")]),
    ).toEqual({ suggestions: 2, labels: 1 });
  });
});
