import { z } from "zod";
import type { HailstormScenario } from "./types";

/**
 * Optional AI draft of a hailstorm scenario from one sentence ("Hagelzug
 * von München nach Augsburg, 10 km breit, stark"). The model only extracts
 * place names along the track, a width and an intensity; the app geocodes
 * the places with its own geocoder, builds the corridor and shows the draft
 * before the user applies it. The drawn scenario on the map works without AI.
 */

export const SCENARIO_INTENSITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "EXTREME",
] as const;
export const SCENARIO_MIN_WIDTH_KM = 1;
export const SCENARIO_MAX_WIDTH_KM = 100;
/** Width when the sentence names none. */
export const SCENARIO_DEFAULT_WIDTH_KM = 10;

export const ScenarioDraftSchema = z.object({
  places: z.array(z.string().trim().min(2).max(120)).min(2).max(6),
  widthKm: z.number().min(SCENARIO_MIN_WIDTH_KM).max(SCENARIO_MAX_WIDTH_KM),
  intensityLevel: z.enum(SCENARIO_INTENSITIES),
  name: z.string().trim().min(1).max(80),
});
export type ScenarioDraft = z.infer<typeof ScenarioDraftSchema>;

/** What the model may answer; normalised by {@link normaliseScenarioDraft}. */
export const ScenarioDraftAnswerSchema = z.object({
  places: z.array(z.string()).max(12),
  widthKm: z.number().nullable().optional(),
  intensityLevel: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
});

/**
 * Clamps the width, maps unknown intensities to HIGH, drops empty and
 * repeated places and caps them at six. Throws when fewer than two places
 * remain: a corridor needs a start and an end.
 */
export function normaliseScenarioDraft(
  answer: z.infer<typeof ScenarioDraftAnswerSchema>,
  fallbackName: string,
): ScenarioDraft {
  const seen = new Set<string>();
  const places: string[] = [];
  for (const raw of answer.places) {
    const place = raw.replace(/\s+/g, " ").trim().slice(0, 120);
    const key = place.toLowerCase();
    if (place.length < 2 || seen.has(key)) continue;
    seen.add(key);
    places.push(place);
    if (places.length === 6) break;
  }
  if (places.length < 2)
    throw new Error("The sentence names fewer than two places along the track");
  const width = answer.widthKm ?? SCENARIO_DEFAULT_WIDTH_KM;
  const intensity = SCENARIO_INTENSITIES.find(
    (i) => i === answer.intensityLevel?.toUpperCase(),
  );
  return ScenarioDraftSchema.parse({
    places,
    widthKm: Math.min(
      SCENARIO_MAX_WIDTH_KM,
      Math.max(SCENARIO_MIN_WIDTH_KM, Math.round(width)),
    ),
    intensityLevel: intensity ?? "HIGH",
    name: answer.name?.trim().slice(0, 80) || fallbackName,
  });
}

/**
 * The scenario for a draft once every place was geocoded; the list of
 * places that could not be found otherwise.
 */
export function scenarioFromDraft(
  draft: ScenarioDraft,
  points: Array<{ lat: number; lon: number } | null>,
  base: Pick<HailstormScenario, "id" | "modelVersion">,
): { scenario: HailstormScenario } | { missing: string[] } {
  const missing = draft.places.filter((_, i) => points[i] == null);
  if (missing.length > 0) return { missing };
  return {
    scenario: {
      id: base.id,
      name: draft.name,
      pathCoordinates: points.map((p) => [p!.lon, p!.lat]),
      widthKm: draft.widthKm,
      intensityLevel: draft.intensityLevel,
      returnPeriodYears: 100,
      exposureMultiplier: 1,
      modelVersion: base.modelVersion,
    },
  };
}
