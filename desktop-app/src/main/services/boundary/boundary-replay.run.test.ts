/**
 * Opt-in offline replay of frozen boundary inputs (no network, no model):
 *
 *   BOUNDARY_REPLAY=/path/to/boundary-inputs.json npm run benchmark:boundary:replay
 *
 * The file is a JSON array of `ReplaySample` (boundary-replay.ts), written by
 * `BOUNDARY_BENCHMARK_DUMP` or assembled from an audit. Inputs derived from a
 * customer portfolio stay outside the repository.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { replayBoundarySamples, type ReplaySample } from "./boundary-replay";
import { CASCADE_VERSION } from "./cascade";

const path = process.env.BOUNDARY_REPLAY;

describe.skipIf(!path)("boundary replay (frozen inputs)", () => {
  it("replays every sample through the current cascade", () => {
    const samples = JSON.parse(
      readFileSync(resolve(path!), "utf8"),
    ) as ReplaySample[];
    const outcome = replayBoundarySamples(samples);
    console.log(`cascade v${CASCADE_VERSION}, ${samples.length} samples\n`);
    for (const row of outcome.rows) {
      console.log(
        `${row.id.padEnd(22)} stage ${row.stage} ${Math.round(row.areaSqm)
          .toString()
          .padStart(7)} m² conf ${row.confidence.toFixed(2)}` +
          (row.reviewReasons.length > 0
            ? ` review: ${row.reviewReasons.join(", ")}`
            : ""),
      );
      for (const line of row.trace) console.log(`    ${line}`);
    }
    for (const [label, result] of [
      ["ALL (with reference)", outcome.all],
      ["HOLD-OUT", outcome.holdout],
    ] as const) {
      if (!result) continue;
      console.log(
        `\n${label}: n=${result.evaluatedSamples} mean IoU ${result.meanIoU.toFixed(3)}, ` +
          `coverage ${result.meanCoverage.toFixed(3)}, area bias ${result.meanAreaBias.toFixed(3)}`,
      );
    }
    expect(outcome.rows).toHaveLength(samples.length);
  });
});
