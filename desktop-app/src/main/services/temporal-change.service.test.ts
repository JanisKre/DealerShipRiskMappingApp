import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  detectBoundary: vi.fn(),
  detectVehicles: vi.fn(),
  aerialImageForBoundary: vi.fn(),
}));

vi.mock("./settings.service", () => ({ getSettings: mocks.getSettings }));
vi.mock("./boundary.service", () => ({
  detectBoundary: mocks.detectBoundary,
}));
vi.mock("./detection.service", () => ({
  detectVehicles: mocks.detectVehicles,
}));
vi.mock("./tiles.service", () => ({
  aerialImageForBoundary: mocks.aerialImageForBoundary,
}));

import { compareTemporal } from "./temporal-change.service";

describe("temporal change detection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects providers without a date-capable imagery template", async () => {
    mocks.getSettings.mockReturnValue({ satelliteProvider: "esri" });

    await expect(
      compareTemporal(51, 7, "2020-01-01", "2024-01-01"),
    ).rejects.toThrow("date-capable tile source");
    expect(mocks.detectBoundary).not.toHaveBeenCalled();
  });

  it("calculates count and percentage deltas for two dates", async () => {
    const boundary = { areaSqm: 1_000 };
    mocks.getSettings.mockReturnValue({
      satelliteProvider: "wms",
      wmsTileUrl: "https://tiles.test/{time}/{z}/{x}/{y}.png",
    });
    mocks.detectBoundary.mockResolvedValue(boundary);
    mocks.aerialImageForBoundary
      .mockResolvedValueOnce({ date: "from" })
      .mockResolvedValueOnce({ date: "to" });
    mocks.detectVehicles
      .mockResolvedValueOnce({ vehicleCount: 10, confidence: 0.8 })
      .mockResolvedValueOnce({ vehicleCount: 15, confidence: 0.9 });

    await expect(
      compareTemporal(51, 7, "2020-01-01", "2024-01-01"),
    ).resolves.toMatchObject({
      fromCount: 10,
      toCount: 15,
      deltaCount: 5,
      deltaPct: 0.5,
      fromConfidence: 0.8,
      toConfidence: 0.9,
      provider: "wms",
      classDeltas: { car: 5, van: 0, truck: 0, bus: 0 },
    });
    expect(mocks.detectBoundary).toHaveBeenCalledWith(51, 7);
  });

  it("reports a null percentage when the baseline has no vehicles", async () => {
    mocks.getSettings.mockReturnValue({
      satelliteProvider: "wms",
      wmsTileUrl: "https://tiles.test/{time}/{z}/{x}/{y}.png",
    });
    mocks.detectBoundary.mockResolvedValue({ areaSqm: 1_000 });
    mocks.aerialImageForBoundary
      .mockResolvedValueOnce({ date: "from" })
      .mockResolvedValueOnce({ date: "to" });
    mocks.detectVehicles
      .mockResolvedValueOnce({ vehicleCount: 0, confidence: 0.8 })
      .mockResolvedValueOnce({ vehicleCount: 2, confidence: 0.9 });

    await expect(
      compareTemporal(51, 7, "2020-01-01", "2024-01-01"),
    ).resolves.toMatchObject({ deltaCount: 2, deltaPct: null });
  });
});
