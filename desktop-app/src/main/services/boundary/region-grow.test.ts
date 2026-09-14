import { describe, expect, it } from "vitest";
import { cellIndex, createGrid, maskAreaSqm, type EvidenceGrid } from "./grid";
import {
  closeMask,
  fillHoles,
  growRegion,
  largestComponent,
  pickSeed,
  reclaimBarrierCells,
} from "./region-grow";
import { rasterizeBarrier, rasterizePolygon } from "./rasterize";
import { unprojectPoint, type LonLat } from "../boundary-geometry";

const ORIGIN: LonLat = [13.4, 52.5];
const OPTIONS = {
  highThreshold: 0.6,
  lowThreshold: 0.15,
  maxAreaSqm: 200_000,
  maxRadiusM: 200,
};

function grid(): EvidenceGrid {
  return createGrid(ORIGIN, 0.5, 400);
}

/** Rectangle from metric offsets about the origin. */
function rect(
  centreE: number,
  centreN: number,
  halfW: number,
  halfH: number,
): LonLat[] {
  const corners: Array<[number, number]> = [
    [centreE - halfW, centreN - halfH],
    [centreE + halfW, centreN - halfH],
    [centreE + halfW, centreN + halfH],
    [centreE - halfW, centreN + halfH],
  ];
  const ring = corners.map((c) => unprojectPoint(c, ORIGIN));
  ring.push(ring[0]);
  return ring;
}

function seedAtCentre(g: EvidenceGrid): { col: number; row: number } {
  return { col: Math.floor(g.spec.cols / 2), row: Math.floor(g.spec.rows / 2) };
}

describe("pickSeed", () => {
  it("picks the strongest cell near the anchor", () => {
    const g = grid();
    rasterizePolygon(g.spec, rect(20, 0, 10, 10), g.score, 1.0);
    const seed = pickSeed(g, 60, OPTIONS);
    expect(seed).not.toBeNull();
    // The blob spans 10-30 m east of the anchor, i.e. columns 420-460 at 0.5 m
    // cells. Ties break towards the anchor, so its nearest edge is chosen.
    expect(seed!.col).toBeGreaterThanOrEqual(420);
    expect(seed!.col).toBeLessThanOrEqual(460);
    expect(g.score[cellIndex(g.spec, seed!.col, seed!.row)]).toBeGreaterThanOrEqual(
      OPTIONS.highThreshold,
    );
  });

  it("does not wander outside the anchor radius", () => {
    const g = grid();
    rasterizePolygon(g.spec, rect(150, 0, 10, 10), g.score, 1.0);
    // The only strong evidence is 150 m away; with a 30 m leash and nothing at
    // the anchor, there is no defensible seed.
    expect(pickSeed(g, 30, OPTIONS)).toBeNull();
  });

  it("falls back to the anchor cell when only weak evidence is present", () => {
    const g = grid();
    rasterizePolygon(g.spec, rect(0, 0, 30, 30), g.score, 0.3);
    const seed = pickSeed(g, 40, OPTIONS);
    expect(seed).toEqual(seedAtCentre(g));
  });

  it("returns null when the anchor sits on a barrier and nothing else helps", () => {
    const g = grid();
    const centre = seedAtCentre(g);
    g.blocked[cellIndex(g.spec, centre.col, centre.row)] = 1;
    expect(pickSeed(g, 5, OPTIONS)).toBeNull();
  });
});

describe("growRegion", () => {
  it("grows through supported evidence and stops at its edge", () => {
    const g = grid();
    rasterizePolygon(g.spec, rect(0, 0, 40, 25), g.score, 1.0);
    const result = growRegion(g, seedAtCentre(g), OPTIONS);
    expect(result.stoppedBy).toBe("exhausted");
    expect(result.confirmed).toBe(true);
    // 80 m x 50 m = 4000 m².
    expect(result.areaSqm).toBeGreaterThan(3900);
    expect(result.areaSqm).toBeLessThan(4100);
  });

  it("does not cross a negative road strip between two blobs", () => {
    const g = grid();
    rasterizePolygon(g.spec, rect(-30, 0, 25, 25), g.score, 1.0);
    rasterizePolygon(g.spec, rect(30, 0, 25, 25), g.score, 1.0);
    // A 6 m road down the middle drives those cells below lowThreshold.
    rasterizePolygon(g.spec, rect(0, 0, 3, 60), g.score, -1.5);

    const result = growRegion(g, { col: 340, row: 400 }, OPTIONS);
    expect(result.areaSqm).toBeLessThan(3000);
    // The eastern blob must not be reached.
    expect(g.score[cellIndex(g.spec, 460, 400)]).toBeGreaterThan(0);
    expect(result.mask[cellIndex(g.spec, 460, 400)]).toBe(0);
  });

  it("does not cross a fence line between two blobs", () => {
    const g = grid();
    rasterizePolygon(g.spec, rect(0, 0, 60, 25), g.score, 1.0);
    // One hairline fence, straight down the middle of otherwise uniform evidence.
    rasterizeBarrier(
      g.spec,
      [unprojectPoint([0, -60], ORIGIN), unprojectPoint([0, 60], ORIGIN)],
      g.blocked,
    );

    const result = growRegion(g, { col: 340, row: 400 }, OPTIONS);
    expect(result.mask[cellIndex(g.spec, 340, 400)]).toBe(1);
    expect(result.mask[cellIndex(g.spec, 460, 400)]).toBe(0);
  });

  it("merges the same two blobs when nothing separates them", () => {
    // Control for the two tests above: without a separator the region is one.
    const g = grid();
    rasterizePolygon(g.spec, rect(0, 0, 60, 25), g.score, 1.0);
    const result = growRegion(g, { col: 340, row: 400 }, OPTIONS);
    expect(result.mask[cellIndex(g.spec, 460, 400)]).toBe(1);
  });

  it("rejects a region that never rises above the high threshold", () => {
    const g = grid();
    rasterizePolygon(g.spec, rect(0, 0, 40, 40), g.score, 0.3);
    const result = growRegion(g, seedAtCentre(g), OPTIONS);
    expect(result.confirmed).toBe(false);
    expect(result.areaSqm).toBeGreaterThan(0);
  });

  it("reports the area cap when it truncates the site", () => {
    const g = grid();
    rasterizePolygon(g.spec, rect(0, 0, 100, 100), g.score, 1.0);
    const result = growRegion(g, seedAtCentre(g), {
      ...OPTIONS,
      maxAreaSqm: 500,
    });
    expect(result.stoppedBy).toBe("areaCap");
    expect(result.areaSqm).toBeLessThanOrEqual(520);
  });

  it("reports the radius cap when it truncates the site", () => {
    const g = grid();
    rasterizePolygon(g.spec, rect(0, 0, 150, 150), g.score, 1.0);
    const result = growRegion(g, seedAtCentre(g), {
      ...OPTIONS,
      maxRadiusM: 20,
    });
    expect(result.stoppedBy).toBe("radiusCap");
  });

  it("returns an empty region for an unsupported seed", () => {
    const g = grid();
    const result = growRegion(g, seedAtCentre(g), OPTIONS);
    expect(result.areaSqm).toBe(0);
    expect(result.confirmed).toBe(false);
  });

  it("never escapes a closed barrier ring", () => {
    const g = grid();
    // Strong evidence everywhere, fenced yard in the middle.
    g.score.fill(1);
    rasterizeBarrier(g.spec, rect(0, 0, 30, 30), g.blocked);
    const result = growRegion(g, seedAtCentre(g), OPTIONS);
    // 60 x 60 m = 3600 m², minus the barrier ring itself.
    expect(result.areaSqm).toBeGreaterThan(3300);
    expect(result.areaSqm).toBeLessThan(3700);
  });
});

describe("closeMask", () => {
  it("bridges a narrow gap between two bays of the same lot", () => {
    const g = grid();
    const mask = new Uint8Array(g.spec.cols * g.spec.rows);
    const score = new Float32Array(g.spec.cols * g.spec.rows);
    rasterizePolygon(g.spec, rect(-12, 0, 10, 20), score, 1);
    rasterizePolygon(g.spec, rect(12, 0, 10, 20), score, 1);
    for (let i = 0; i < score.length; i += 1) mask[i] = score[i] > 0 ? 1 : 0;

    const before = maskAreaSqm(g.spec, mask);
    const closed = closeMask(g.spec, mask, 6);
    expect(maskAreaSqm(g.spec, closed)).toBeGreaterThan(before);
  });
});

describe("fillHoles", () => {
  it("fills a small enclosed void such as a showroom", () => {
    const g = grid();
    const mask = new Uint8Array(g.spec.cols * g.spec.rows);
    const score = new Float32Array(g.spec.cols * g.spec.rows);
    rasterizePolygon(g.spec, rect(0, 0, 40, 40), score, 1);
    rasterizePolygon(g.spec, rect(0, 0, 5, 5), score, -5);
    for (let i = 0; i < score.length; i += 1) mask[i] = score[i] > 0 ? 1 : 0;

    const filled = fillHoles(g.spec, mask, 2_500);
    expect(mask[cellIndex(g.spec, 400, 400)]).toBe(0);
    expect(filled[cellIndex(g.spec, 400, 400)]).toBe(1);
  });

  it("leaves a large enclosed void open", () => {
    const g = grid();
    const mask = new Uint8Array(g.spec.cols * g.spec.rows);
    const score = new Float32Array(g.spec.cols * g.spec.rows);
    rasterizePolygon(g.spec, rect(0, 0, 90, 90), score, 1);
    rasterizePolygon(g.spec, rect(0, 0, 40, 40), score, -5); // 6400 m²
    for (let i = 0; i < score.length; i += 1) mask[i] = score[i] > 0 ? 1 : 0;

    const filled = fillHoles(g.spec, mask, 2_500);
    expect(filled[cellIndex(g.spec, 400, 400)]).toBe(0);
  });

  it("does not fill the background outside the region", () => {
    const g = grid();
    const mask = new Uint8Array(g.spec.cols * g.spec.rows);
    const score = new Float32Array(g.spec.cols * g.spec.rows);
    rasterizePolygon(g.spec, rect(0, 0, 20, 20), score, 1);
    for (let i = 0; i < score.length; i += 1) mask[i] = score[i] > 0 ? 1 : 0;
    const filled = fillHoles(g.spec, mask, 10_000_000);
    expect(filled[cellIndex(g.spec, 5, 5)]).toBe(0);
  });
});

describe("reclaimBarrierCells", () => {
  it("extends the region onto the fence that bounds it", () => {
    const g = grid();
    g.score.fill(1);
    rasterizeBarrier(g.spec, rect(0, 0, 30, 30), g.blocked);
    const grown = growRegion(g, seedAtCentre(g), OPTIONS);
    const reclaimed = reclaimBarrierCells(g.spec, grown.mask, g.blocked);
    expect(maskAreaSqm(g.spec, reclaimed)).toBeGreaterThan(grown.areaSqm);
  });

  it("does not add barrier cells that touch nothing", () => {
    const g = grid();
    const mask = new Uint8Array(g.spec.cols * g.spec.rows);
    g.blocked[cellIndex(g.spec, 10, 10)] = 1;
    const reclaimed = reclaimBarrierCells(g.spec, mask, g.blocked);
    expect(reclaimed[cellIndex(g.spec, 10, 10)]).toBe(0);
  });
});

describe("largestComponent", () => {
  it("keeps the biggest island and drops the rest", () => {
    const g = grid();
    const mask = new Uint8Array(g.spec.cols * g.spec.rows);
    const score = new Float32Array(g.spec.cols * g.spec.rows);
    rasterizePolygon(g.spec, rect(-80, 0, 30, 30), score, 1);
    rasterizePolygon(g.spec, rect(80, 0, 8, 8), score, 1);
    for (let i = 0; i < score.length; i += 1) mask[i] = score[i] > 0 ? 1 : 0;

    const kept = largestComponent(g.spec, mask);
    expect(kept[cellIndex(g.spec, 240, 400)]).toBe(1);
    expect(kept[cellIndex(g.spec, 560, 400)]).toBe(0);
  });

  it("returns an empty mask for an empty input", () => {
    const g = grid();
    const empty = largestComponent(g.spec, new Uint8Array(g.spec.cols * g.spec.rows));
    expect(maskAreaSqm(g.spec, empty)).toBe(0);
  });
});
