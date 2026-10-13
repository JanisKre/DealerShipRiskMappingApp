import { describe, expect, it } from "vitest";
import type { DetectionResult, VehicleTimelineCount } from "./types";
import {
  attachVehicleTimeline,
  describeVehicleTimeline,
  summarizeVehicleTimeline,
} from "./vehicle-timeline";

function count(
  vehicleCount: number,
  capturedAt: string | null,
): VehicleTimelineCount {
  return {
    candidateId: `wayback:${vehicleCount}:z20`,
    capturedAt,
    resolutionM: 0.2,
    vehicleCount,
  };
}

const AT = "2026-10-13T00:00:00.000Z";

describe("summarizeVehicleTimeline", () => {
  it("takes the middle value for an odd number of counts", () => {
    expect(
      summarizeVehicleTimeline(
        [
          count(40, "2024-06-01"),
          count(12, "2020-07-01"),
          count(31, "2017-01-15"),
        ],
        AT,
      ),
    ).toMatchObject({ median: 31, min: 12, max: 40, computedAt: AT });
  });

  it("averages the two middle values for an even number of counts", () => {
    expect(
      summarizeVehicleTimeline(
        [count(10, null), count(20, null), count(31, null), count(50, null)],
        AT,
      )?.median,
    ).toBe(25.5);
  });

  it("returns null without counts", () => {
    expect(summarizeVehicleTimeline([], AT)).toBeNull();
  });
});

describe("describeVehicleTimeline", () => {
  it("states the date span, median and range", () => {
    const timeline = summarizeVehicleTimeline(
      [
        count(40, "2024-06-01"),
        count(12, "2020-07-01"),
        count(31, "2017-01-15"),
      ],
      AT,
    )!;
    expect(describeVehicleTimeline(timeline)).toBe(
      "Vehicle stock across 3 archived images (2017-01-15 to 2024-06-01): median 31, range 12–40. Evidence only; the exposure uses the current count.",
    );
  });

  it("handles a single or undated image", () => {
    expect(
      describeVehicleTimeline(
        summarizeVehicleTimeline([count(7, "2020-07-01")], AT)!,
      ),
    ).toContain("1 archived image (2020-07-01)");
    expect(
      describeVehicleTimeline(summarizeVehicleTimeline([count(7, null)], AT)!),
    ).toContain("(undated images)");
  });
});

describe("attachVehicleTimeline", () => {
  const detection: DetectionResult = {
    vehicleCount: 35,
    confidence: 0.8,
    model: "yolo",
    evidence: {
      source: "model",
      retrievedAt: AT,
      method: "yolo",
      confidence: 0.8,
      fallbackUsed: false,
      limitations: [
        "Vehicles counted on X",
        "Vehicle stock across 2 archived images (old): median 1, range 1–1. Evidence only; the exposure uses the current count.",
      ],
    },
  };

  it("stores the timeline, replaces the old summary line and keeps the count", () => {
    const timeline = summarizeVehicleTimeline([count(12, "2020-07-01")], AT)!;
    const next = attachVehicleTimeline(detection, timeline);
    expect(next.vehicleCount).toBe(35);
    expect(next.timeline).toBe(timeline);
    expect(next.evidence?.limitations).toEqual([
      "Vehicles counted on X",
      describeVehicleTimeline(timeline),
    ]);
  });
});
