import { describe, expect, it } from "vitest";
import type { DetectionBox } from "@shared/types";
import {
  boxFootprints,
  DEFAULT_DETECTION_DISPLAY,
  DETECTION_COLORS,
  detectionColor,
  inferImageFrame,
  normalizeDetectionDisplay,
} from "./detectionDisplay";

// An image whose top-left corner is (7.0 E, 51.01 N), 0.01° wide, 0.006° tall.
const FRAME = { originLon: 7, originLat: 51.01, lonSpan: 0.01, latSpan: 0.006 };

/** An axis-aligned box stored the way detections before corners were stored. */
function legacyBox(x: number, y: number, w: number, h: number): DetectionBox {
  return {
    x,
    y,
    w,
    h,
    score: 0.8,
    classLabel: "car",
    lon: FRAME.originLon + (x + w / 2) * FRAME.lonSpan,
    lat: FRAME.originLat - (y + h / 2) * FRAME.latSpan,
  };
}

describe("detectionColor", () => {
  it("uses one colour for the fixed modes", () => {
    expect(detectionColor("blue", 0.1)).toBe(DETECTION_COLORS.blue);
    expect(detectionColor("green", 0.1)).toBe(DETECTION_COLORS.green);
  });

  it("bands the confidence at 40 % and 60 %", () => {
    const low = detectionColor("confidence", 0.39);
    const medium = detectionColor("confidence", 0.4);
    const high = detectionColor("confidence", 0.6);
    expect(new Set([low, medium, high]).size).toBe(3);
    expect(detectionColor("confidence", 0.59)).toBe(medium);
    expect(detectionColor("confidence", 0.99)).toBe(high);
    expect(detectionColor("confidence", 0)).toBe(low);
  });
});

describe("normalizeDetectionDisplay", () => {
  it("falls back to the defaults for missing or broken values", () => {
    expect(normalizeDetectionDisplay(undefined)).toEqual(
      DEFAULT_DETECTION_DISPLAY,
    );
    expect(
      normalizeDetectionDisplay({
        shape: "hexagon",
        color: 3,
        dotSize: "huge",
        boxFill: "yes",
      }),
    ).toEqual(DEFAULT_DETECTION_DISPLAY);
  });

  it("keeps valid saved choices", () => {
    expect(
      normalizeDetectionDisplay({
        shape: "box",
        color: "confidence",
        dotSize: "large",
        boxFill: false,
        onlySelected: true,
      }),
    ).toEqual({
      shape: "box",
      color: "confidence",
      dotSize: "large",
      boxFill: false,
      onlySelected: true,
    });
  });
});

describe("inferImageFrame", () => {
  it("recovers the image frame from two or more legacy boxes", () => {
    const frame = inferImageFrame([
      legacyBox(0.1, 0.2, 0.02, 0.03),
      legacyBox(0.5, 0.7, 0.03, 0.02),
      legacyBox(0.8, 0.4, 0.02, 0.02),
    ]);
    expect(frame?.lon.origin).toBeCloseTo(FRAME.originLon, 10);
    expect(frame?.lon.span).toBeCloseTo(FRAME.lonSpan, 10);
    expect(frame?.lat.origin).toBeCloseTo(FRAME.originLat, 10);
    expect(frame?.lat.span).toBeCloseTo(-FRAME.latSpan, 10);
  });

  it("needs two boxes at different positions", () => {
    expect(inferImageFrame([legacyBox(0.1, 0.2, 0.02, 0.03)])).toBeNull();
    expect(
      inferImageFrame([
        legacyBox(0.1, 0.2, 0.02, 0.03),
        legacyBox(0.1, 0.2, 0.02, 0.03),
      ]),
    ).toBeNull();
  });

  it("refuses boxes that do not share one image", () => {
    const moved = { ...legacyBox(0.5, 0.7, 0.03, 0.02), lon: 7.5 };
    expect(
      inferImageFrame([
        legacyBox(0.1, 0.2, 0.02, 0.03),
        moved,
        legacyBox(0.8, 0.4, 0.02, 0.02),
      ]),
    ).toBeNull();
  });
});

describe("boxFootprints", () => {
  it("uses stored corners as [lat, lon]", () => {
    const corners: [number, number][] = [
      [7.001, 51.002],
      [7.002, 51.002],
      [7.002, 51.001],
      [7.001, 51.001],
    ];
    const [footprint] = boxFootprints([
      { ...legacyBox(0.1, 0.2, 0.02, 0.03), corners },
    ]);
    expect(footprint).toEqual(corners.map(([lon, lat]) => [lat, lon]));
  });

  it("places legacy boxes on the inferred frame around their center", () => {
    const boxes = [
      legacyBox(0.1, 0.2, 0.02, 0.04),
      legacyBox(0.6, 0.5, 0.04, 0.02),
    ];
    const footprints = boxFootprints(boxes);
    footprints.forEach((footprint, i) => {
      expect(footprint).toHaveLength(4);
      const lat = footprint!.reduce((a, [la]) => a + la, 0) / 4;
      const lon = footprint!.reduce((a, [, lo]) => a + lo, 0) / 4;
      expect(lat).toBeCloseTo(boxes[i].lat!, 10);
      expect(lon).toBeCloseTo(boxes[i].lon!, 10);
    });
    // 0.02 of a 0.01° wide image.
    const [a, b] = footprints[0]!;
    expect(b[1] - a[1]).toBeCloseTo(0.0002, 10);
  });

  it("returns null for a lone legacy box (drawn as a dot)", () => {
    expect(boxFootprints([legacyBox(0.1, 0.2, 0.02, 0.03)])).toEqual([null]);
  });
});
