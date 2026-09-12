import { spawn } from "node:child_process";
import type { BoundaryResult, Polygon } from "@shared/types";
import { cached, TTL } from "./cache.service";
import { polygonAreaSqm } from "./geo-math";
import { checkRing, type LonLat } from "./boundary-geometry";

/**
 * Optional adapter for the official Overture Maps Python CLI.
 * Overture publishes cloud-native GeoParquet rather than a small REST API;
 * the CLI performs the bbox-pruned download and emits GeoJSON. Keeping this
 * behind an adapter makes the desktop app work without Overture installed,
 * while enabling the real source where the user has configured it.
 */
export async function fromOverture(
  lat: number,
  lon: number,
): Promise<BoundaryResult[] | null> {
  const key = `overture:buildings:${lat.toFixed(5)},${lon.toFixed(5)}`;
  return cached(key, TTL.buildings, async () => {
    const bbox = [lon - 0.0015, lat - 0.0015, lon + 0.0015, lat + 0.0015].join(
      ",",
    );
    const output = await runOvertureDownload(bbox);
    if (!output) return null;
    const features = parseGeoJson(output);
    const results: BoundaryResult[] = [];
    for (const feature of features) {
      const polygons = polygonRings(feature.geometry);
      for (const ring of polygons) {
        const check = checkRing(ring, { minAreaSqm: 10, maxAreaSqm: 200_000 });
        if (!check.valid) continue;
        const confidence = readConfidence(feature.properties);
        results.push({
          source: "overture",
          role: "building",
          provider: "overture:buildings",
          gersId: readString(feature.properties?.id),
          polygon: { type: "Polygon", coordinates: [ring] } as Polygon,
          areaSqm: polygonAreaSqm(ring),
          confidence,
          label: readString(feature.properties?.["names.primary"]),
          evidence: {
            source: "Overture Maps Buildings",
            retrievedAt: new Date().toISOString(),
            method: "bbox-pruned official Overture Maps CLI download",
            confidence,
            fallbackUsed: false,
            limitations: [
              "Building footprint is a building candidate, not automatically an operational lot",
              "Availability depends on the optional overturemaps CLI installation",
            ],
          },
        });
      }
    }
    return results.length > 0 ? results.slice(0, 20) : null;
  });
}

async function runOvertureDownload(bbox: string): Promise<string | null> {
  const configuredCommand = process.env.OVERTURE_COMMAND;
  const configuredPython = process.env.OVERTURE_PYTHON;
  const attempts: Array<{ command: string; args: string[] }> = [];
  if (configuredCommand) {
    attempts.push({ command: configuredCommand, args: [] });
  } else {
    attempts.push({ command: "overturemaps", args: [] });
  }
  if (configuredPython || !configuredCommand) {
    attempts.push({
      command: configuredPython ?? "python3",
      args: ["-m", "overturemaps"],
    });
  }

  const args = [
    "download",
    `--bbox=${bbox}`,
    "--type=building",
    "-f",
    "geojson",
  ];
  for (const attempt of attempts) {
    const output = await spawnCapture(attempt.command, [
      ...attempt.args,
      ...args,
    ]);
    if (output) return output;
  }
  return null;
}

function spawnCapture(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(null);
    }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      finish(code === 0 ? Buffer.concat(chunks).toString("utf8") : null);
    });
  });
}

interface GeoJsonFeature {
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown>;
}

function parseGeoJson(output: string): GeoJsonFeature[] {
  try {
    const parsed = JSON.parse(output) as {
      type?: string;
      features?: GeoJsonFeature[];
    };
    return parsed.type === "FeatureCollection" ? (parsed.features ?? []) : [];
  } catch {
    // The CLI can also emit GeoJSONSeq. Accept that form for older versions.
    return output
      .split(/\r?\n/)
      .map((line) => {
        try {
          return JSON.parse(line) as GeoJsonFeature;
        } catch {
          return null;
        }
      })
      .filter((feature): feature is GeoJsonFeature => feature !== null);
  }
}

function polygonRings(geometry: GeoJsonFeature["geometry"]): LonLat[][] {
  if (!geometry?.coordinates) return [];
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as unknown;
    const ring = Array.isArray(rings) ? normalizeRing(rings[0]) : null;
    return ring ? [ring] : [];
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates as unknown;
    return Array.isArray(polygons)
      ? polygons.flatMap((polygon) => {
          const ring = Array.isArray(polygon)
            ? normalizeRing(polygon[0])
            : null;
          return ring ? [ring] : [];
        })
      : [];
  }
  return [];
}

function normalizeRing(value: unknown): LonLat[] | null {
  if (!Array.isArray(value)) return null;
  const ring = value.flatMap((point) => {
    if (
      !Array.isArray(point) ||
      point.length < 2 ||
      typeof point[0] !== "number" ||
      typeof point[1] !== "number"
    ) {
      return [];
    }
    return [[point[0], point[1]] as LonLat];
  });
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return ring;
}

function readConfidence(properties?: Record<string, unknown>): number {
  const value = properties?.confidence;
  return typeof value === "number" && value >= 0 && value <= 1 ? value : 0.62;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
