import { z } from "zod";
import { containsFigure } from "./a2ui";

/**
 * Optional AI look at the aerial image of a lot (a vision model): is hail
 * protection visible, and does the stored lot boundary fit what the image
 * shows? The answer is an observation with its image date and model, shown
 * next to the result. It never changes the vehicle count, the boundary or
 * the hail EAL: the model counts every vehicle on the lot as exposed
 * (docs/risk-model.md), and only the underwriter decides otherwise.
 */

export const SEEN = ["yes", "no", "unclear"] as const;
export const SeenSchema = z.enum(SEEN);
export type Seen = z.infer<typeof SeenSchema>;

export const OPEN_AIR_SHARES = ["most", "aboutHalf", "few", "unclear"] as const;
export const OpenAirShareSchema = z.enum(OPEN_AIR_SHARES);

export const SITE_CHECK_NOTE_MAX_CHARS = 300;

/** What the model answers; lenient, cleaned by `cleanSiteFindings`. */
export const SiteCheckAnswerSchema = z.object({
  imageUsable: z.boolean().default(true),
  hailNet: z.string().default("unclear"),
  canopy: z.string().default("unclear"),
  parkingStructure: z.string().default("unclear"),
  openAirShare: z.string().default("unclear"),
  note: z.string().max(2_000).default(""),
});

export const SiteFindingsSchema = z.object({
  /** False: clouds, snow, blur or no imagery; the other fields are then "unclear". */
  imageUsable: z.boolean(),
  /** Hail nets over parking rows. */
  hailNet: SeenSchema,
  /** Carports or canopies over parked vehicles. */
  canopy: SeenSchema,
  /** Multi-storey car park or parking deck on the lot. */
  parkingStructure: SeenSchema,
  /** Share of the visible vehicles parked in the open. */
  openAirShare: OpenAirShareSchema,
  /** One or two sentences; empty when it contained figures. */
  note: z.string().max(SITE_CHECK_NOTE_MAX_CHARS),
});
export type SiteFindings = z.infer<typeof SiteFindingsSchema>;

/**
 * Amounts, percentages and counts have no place in an observation: the
 * prompt asks for what is seen, without numbers. A note with any figure
 * (also "EUR 5.000", "rund 200000", "etwa 40 Fahrzeuge") is dropped.
 */
export function cleanNote(note: string): string {
  const text = note.replace(/\s+/g, " ").trim();
  if (!text || containsFigure(text) || /\d{2,}/.test(text)) return "";
  return text.slice(0, SITE_CHECK_NOTE_MAX_CHARS);
}

function seen(value: string): Seen {
  const v = value.trim().toLowerCase();
  return v === "yes" || v === "no" ? v : "unclear";
}

export function cleanSiteFindings(
  answer: z.infer<typeof SiteCheckAnswerSchema>,
): SiteFindings {
  if (!answer.imageUsable) {
    return {
      imageUsable: false,
      hailNet: "unclear",
      canopy: "unclear",
      parkingStructure: "unclear",
      openAirShare: "unclear",
      note: cleanNote(answer.note),
    };
  }
  const share = OpenAirShareSchema.safeParse(answer.openAirShare.trim());
  return {
    imageUsable: true,
    hailNet: seen(answer.hailNet),
    canopy: seen(answer.canopy),
    parkingStructure: seen(answer.parkingStructure),
    openAirShare: share.success ? share.data : "unclear",
    note: cleanNote(answer.note),
  };
}

/** One checked image. */
export const SiteCheckSchema = z.object({
  checkedAt: z.string(),
  /** Model that looked at the image, as configured. */
  model: z.string().max(200),
  /** Capture date of the image (YYYY-MM-DD), null when unknown. */
  imageCapturedAt: z.string().nullable(),
  /** Imagery source label, e.g. "Esri World Imagery". */
  imageLabel: z.string().max(200),
  findings: SiteFindingsSchema,
});
export type SiteCheck = z.infer<typeof SiteCheckSchema>;

/** Archived images looked at for "since when". */
export const SITE_HISTORY_MAX_IMAGES = 4;

export const SiteCheckResultSchema = z.object({
  current: SiteCheckSchema,
  /** Older images, newest first; empty unless the history was requested. */
  history: z.array(SiteCheckSchema).max(SITE_HISTORY_MAX_IMAGES),
});
export type SiteCheckResult = z.infer<typeof SiteCheckResultSchema>;

/**
 * Picks up to `max` dated images spread over the available range: the
 * newest, the oldest and evenly spaced ones between. Input newest first.
 */
export function spreadOverTime<T>(newestFirst: readonly T[], max: number): T[] {
  if (newestFirst.length <= max) return [...newestFirst];
  if (max <= 1) return newestFirst.slice(0, Math.max(0, max));
  const picked: T[] = [];
  for (let i = 0; i < max; i++) {
    picked.push(
      newestFirst[Math.round((i * (newestFirst.length - 1)) / (max - 1))],
    );
  }
  return picked;
}

export type ProtectionFeature = "hailNet" | "canopy" | "parkingStructure";

export interface FeatureSince {
  feature: ProtectionFeature;
  /** Oldest image date on which the feature is seen without a gap to today. */
  seenSince: string | null;
  /** Newest image date on which it was clearly absent, if any. */
  absentOn: string | null;
}

/**
 * "Since when": for each feature seen on the current image, how far back it
 * is seen on the archived images without interruption, and the newest image
 * on which it was clearly absent. Only as precise as the image dates.
 */
export function featuresSince(result: SiteCheckResult): FeatureSince[] {
  const checks = [result.current, ...result.history]
    .filter((c) => c.findings.imageUsable)
    .sort((a, b) =>
      (b.imageCapturedAt ?? "").localeCompare(a.imageCapturedAt ?? ""),
    );
  const features: ProtectionFeature[] = [
    "hailNet",
    "canopy",
    "parkingStructure",
  ];
  const out: FeatureSince[] = [];
  for (const feature of features) {
    if (result.current.findings[feature] !== "yes") continue;
    let seenSince: string | null = null;
    let absentOn: string | null = null;
    for (const check of checks) {
      const value = check.findings[feature];
      if (value === "yes") {
        seenSince = check.imageCapturedAt ?? seenSince;
      } else if (value === "no") {
        absentOn = check.imageCapturedAt;
        break;
      } else if (check !== result.current) {
        break; // unclear image: the run of sightings ends here
      }
    }
    out.push({ feature, seenSince, absentOn });
  }
  return out;
}

// --- Second opinion on the lot boundary ------------------------------------

export const BOUNDARY_VERDICTS = [
  "plausible",
  "tooLarge",
  "tooSmall",
  "wrongPlace",
  "unclear",
] as const;
export const BoundaryVerdictSchema = z.enum(BOUNDARY_VERDICTS);
export type BoundaryVerdict = z.infer<typeof BoundaryVerdictSchema>;

export const BoundaryOpinionAnswerSchema = z.object({
  verdict: z.string().default("unclear"),
  note: z.string().max(2_000).default(""),
});

export const BoundaryOpinionSchema = z.object({
  checkedAt: z.string(),
  model: z.string().max(200),
  imageCapturedAt: z.string().nullable(),
  imageLabel: z.string().max(200),
  verdict: BoundaryVerdictSchema,
  note: z.string().max(SITE_CHECK_NOTE_MAX_CHARS),
});
export type BoundaryOpinion = z.infer<typeof BoundaryOpinionSchema>;

export function cleanBoundaryVerdict(
  answer: z.infer<typeof BoundaryOpinionAnswerSchema>,
): { verdict: BoundaryVerdict; note: string } {
  const verdict = BoundaryVerdictSchema.safeParse(answer.verdict.trim());
  return {
    verdict: verdict.success ? verdict.data : "unclear",
    note: cleanNote(answer.note),
  };
}
