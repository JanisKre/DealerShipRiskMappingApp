import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageryCandidate } from "@shared/imagery-sources";

const mocks = vi.hoisted(() => ({
  isModelAvailable: vi.fn(),
  detectVehicles: vi.fn(),
  detectVehiclesInContext: vi.fn(),
  filterDetectionToBoundary: vi.fn(),
  aerialImageForContextFrom: vi.fn(),
  waybackTimeline: vi.fn(),
}));

vi.mock("./detection.service", () => ({
  isModelAvailable: mocks.isModelAvailable,
  detectVehicles: mocks.detectVehicles,
  detectVehiclesInContext: mocks.detectVehiclesInContext,
  filterDetectionToBoundary: mocks.filterDetectionToBoundary,
}));
vi.mock("./tiles.service", () => ({
  aerialImageForContextFrom: mocks.aerialImageForContextFrom,
}));
vi.mock("./wayback.service", () => ({
  waybackTimeline: mocks.waybackTimeline,
}));
// The roof mask needs OSM; without footprints it passes detections through.
vi.mock("./detection/roof-mask.service", () => ({
  maskRoofDetections: async (detection: unknown) => detection,
}));

import { countVehiclesOverTime } from "./vehicle-timeline.service";

function candidate(
  release: number,
  capturedAt: string | null,
  resolutionM: number | null,
): ImageryCandidate {
  return {
    id: `wayback:${release}:z20`,
    kind: "esri-wayback",
    label: `Esri Wayback ${release}`,
    capturedAt,
    dateSource: capturedAt ? "esri-wayback-metadata" : "none",
    resolutionM,
    zoom: 20,
    attribution: "",
    wayback: { release, publishedAt: `20${release % 100}-01-01` },
  };
}

describe("countVehiclesOverTime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isModelAvailable.mockReturnValue(true);
    mocks.aerialImageForContextFrom.mockImplementation(
      async (c: ImageryCandidate) => ({ release: c.wayback?.release }),
    );
    const counts: Record<number, number> = { 63124: 40, 10320: 12, 5217: 31 };
    mocks.detectVehiclesInContext.mockImplementation(
      async (image: { release: number }) => ({
        vehicleCount: counts[image.release],
      }),
    );
  });

  it("counts only dated images sharp enough for the detector, newest first", async () => {
    mocks.waybackTimeline.mockResolvedValue({
      zoom: 20,
      truncated: false,
      candidates: [
        candidate(63124, "2024-06-01", 0.15),
        candidate(40000, "2023-05-01", 0.31), // satellite, too coarse
        candidate(10320, "2020-07-01", 0.2),
        candidate(30000, null, 0.2), // undated
        candidate(5217, "2017-01-15", 0.2),
      ],
    });

    const timeline = await countVehiclesOverTime(51, 13.7);

    expect(mocks.waybackTimeline).toHaveBeenCalledWith(51, 13.7, 20);
    expect(timeline.counts.map((c) => [c.candidateId, c.vehicleCount])).toEqual(
      [
        ["wayback:63124:z20", 40],
        ["wayback:10320:z20", 12],
        ["wayback:5217:z20", 31],
      ],
    );
    expect(timeline).toMatchObject({ median: 31, min: 12, max: 40 });
  });

  it("stops at the maximum number of dates", async () => {
    mocks.waybackTimeline.mockResolvedValue({
      zoom: 20,
      truncated: false,
      candidates: [
        candidate(63124, "2024-06-01", 0.15),
        candidate(10320, "2020-07-01", 0.2),
        candidate(5217, "2017-01-15", 0.2),
      ],
    });

    const timeline = await countVehiclesOverTime(
      51,
      13.7,
      undefined,
      undefined,
      2,
    );

    expect(timeline.counts).toHaveLength(2);
    expect(mocks.detectVehiclesInContext).toHaveBeenCalledTimes(2);
  });

  it("counts like the analysis: context capture, then the boundary as a filter", async () => {
    mocks.waybackTimeline.mockResolvedValue({
      zoom: 20,
      truncated: false,
      candidates: [candidate(63124, "2024-06-01", 0.15)],
    });
    const boundary = { polygon: {} } as never;
    mocks.filterDetectionToBoundary.mockReturnValue({ vehicleCount: 17 });

    const timeline = await countVehiclesOverTime(51, 13.7, boundary);

    expect(mocks.aerialImageForContextFrom).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wayback:63124:z20" }),
      51,
      13.7,
    );
    expect(mocks.filterDetectionToBoundary).toHaveBeenCalledWith(
      { vehicleCount: 40 },
      boundary,
    );
    expect(mocks.detectVehicles).not.toHaveBeenCalled();
    expect(timeline.counts[0].vehicleCount).toBe(17);
  });

  it("re-detects inside the boundary when the context result has no boxes", async () => {
    mocks.waybackTimeline.mockResolvedValue({
      zoom: 20,
      truncated: false,
      candidates: [candidate(63124, "2024-06-01", 0.15)],
    });
    const boundary = { polygon: {} } as never;
    mocks.filterDetectionToBoundary.mockReturnValue(null);
    mocks.detectVehicles.mockResolvedValue({ vehicleCount: 9 });

    const timeline = await countVehiclesOverTime(51, 13.7, boundary);

    expect(timeline.counts[0].vehicleCount).toBe(9);
  });

  it("refuses without a detection model or a sharp archived image", async () => {
    mocks.isModelAvailable.mockReturnValue(false);
    await expect(countVehiclesOverTime(51, 13.7)).rejects.toThrow(/model/);
    expect(mocks.waybackTimeline).not.toHaveBeenCalled();

    mocks.isModelAvailable.mockReturnValue(true);
    mocks.waybackTimeline.mockResolvedValue({
      zoom: 19,
      truncated: false,
      candidates: [candidate(63124, "2024-06-01", 0.31)],
    });
    await expect(countVehiclesOverTime(51, 13.7)).rejects.toThrow(
      /sharp enough/,
    );
  });
});
