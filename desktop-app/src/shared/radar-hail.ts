import { z } from "zod";
import { RiskEvidenceSchema } from "./types";

/**
 * Hail cells tracked by the DWD radar network (KONRAD3D), kept in a local
 * archive. DWD publishes the cells of the last 48 hours only; the app keeps
 * every hail cell it has fetched, so the archive grows from the first use
 * on. Methodology and limitations: docs/risk-model.md, "Radar hail cells".
 */

/**
 * Hydrometeor class of a cell: `large` (area classified as large hail),
 * `hail`, or `mixed` (rain–hail mixture with the hail flag set; in the cold
 * season mostly graupel).
 */
export const RADAR_HAIL_CLASSES = ["large", "hail", "mixed"] as const;
export const RadarHailClassSchema = z.enum(RADAR_HAIL_CLASSES);
export type RadarHailClass = z.infer<typeof RadarHailClassSchema>;

/** Distance within which a cell outline counts as passing over a site. */
export const RADAR_HAIL_RADIUS_KM = 1;

/** One day on which a hail cell passed over (or close to) a location. */
export const RadarHailDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hailClass: RadarHailClassSchema,
  firstAt: z.string(),
  lastAt: z.string(),
  /** Closest distance between the site and a cell outline; 0 inside. */
  distanceKm: z.number().nonnegative(),
  maxDbz: z.number(),
  /** Radar time steps (5 min) with a cell over the site. */
  steps: z.number().int().positive(),
});
export type RadarHailDay = z.infer<typeof RadarHailDaySchema>;

export const RadarHailResultSchema = z.object({
  days: z.array(RadarHailDaySchema),
  /** Time span the local archive covers, null while it is empty. */
  archiveFrom: z.string().nullable(),
  archiveTo: z.string().nullable(),
  /** Radar time steps in the archive. */
  steps: z.number().int().nonnegative(),
  radiusKm: z.number().positive(),
  /** False when DWD could not be reached; the archive is still shown. */
  synced: z.boolean(),
  /** True while the archive is still being filled in the background. */
  syncing: z.boolean(),
  evidence: RiskEvidenceSchema,
});
export type RadarHailResult = z.infer<typeof RadarHailResultSchema>;

/** Order of severity, for picking a day's class. */
export function radarHailRank(c: RadarHailClass): number {
  return c === "large" ? 3 : c === "hail" ? 2 : 1;
}
