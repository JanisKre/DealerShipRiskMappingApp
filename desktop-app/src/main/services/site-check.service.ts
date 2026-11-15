import sharp from "sharp";
import { DETECTION_ZOOM } from "@shared/constants";
import type { BoundaryGeometry, BoundaryResult } from "@shared/types";
import {
  BoundaryOpinionAnswerSchema,
  SITE_HISTORY_MAX_IMAGES,
  SiteCheckAnswerSchema,
  cleanBoundaryVerdict,
  cleanSiteFindings,
  spreadOverTime,
  type BoundaryOpinion,
  type SiteCheck,
  type SiteCheckResult,
} from "@shared/site-check";
import { completeJson } from "./llm-agents.service";
import { responseLanguageName, type LlmImage } from "./llm.service";
import { getSettings } from "./settings.service";
import {
  aerialImageForBoundary,
  aerialImageForContextFrom,
  type AerialCapture,
} from "./tiles.service";
import { waybackTimeline } from "./wayback.service";

/**
 * Optional AI look at the aerial image of a lot (shared/site-check.ts). The
 * image the app already uses for vehicle detection is sent to the configured
 * vision model with the lot outline drawn on it. Observations only: nothing
 * here changes the vehicle count, the boundary or the hail EAL.
 */

/** Longest image side sent to the model. */
export const SITE_CHECK_IMAGE_MAX_PX = 1568;
const SITE_CHECK_MAX_TOKENS = 500;

/** Rings of a boundary as SVG path data in image pixels. */
export function outlinePath(
  geometry: BoundaryGeometry,
  bbox: [number, number, number, number],
  width: number,
  height: number,
): string {
  const [west, south, east, north] = bbox;
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const parts: string[] = [];
  for (const rings of polygons) {
    for (const ring of rings) {
      const points = ring.map(([lon, lat]) => {
        const x = ((lon - west) / (east - west)) * width;
        const y = ((north - lat) / (north - south)) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      parts.push(`M${points.join("L")}Z`);
    }
  }
  return parts.join("");
}

/** The capture as a JPEG, with the lot outline drawn on it when given. */
export async function encodeAerialImage(
  capture: AerialCapture,
  boundary?: BoundaryResult,
): Promise<LlmImage | null> {
  if (!capture.rgba || capture.validTileCount === 0) return null;
  // sharp resizes before it composites, whatever the call order: the outline
  // is therefore drawn at the output size, with the capture as its viewBox.
  const scale = Math.min(
    1,
    SITE_CHECK_IMAGE_MAX_PX / Math.max(capture.width, capture.height),
  );
  const width = Math.max(1, Math.round(capture.width * scale));
  const height = Math.max(1, Math.round(capture.height * scale));
  let image = sharp(Buffer.from(capture.rgba), {
    raw: { width: capture.width, height: capture.height, channels: 4 },
  }).resize(width, height, { fit: "fill" });
  if (boundary) {
    const stroke = Math.max(3, Math.round(capture.width / 300));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${capture.width} ${capture.height}"><path d="${outlinePath(boundary.polygon, capture.bbox, capture.width, capture.height)}" fill="none" stroke="#ff2d95" stroke-width="${stroke}"/></svg>`;
    image = image.composite([{ input: Buffer.from(svg) }]);
  }
  const jpeg = await image.removeAlpha().jpeg({ quality: 82 }).toBuffer();
  return { mediaType: "image/jpeg", base64: jpeg.toString("base64") };
}

export function siteCheckSystemPrompt(
  outlined: boolean,
  language: string = responseLanguageName(),
): string {
  return `You look at one aerial image of a car dealership in Germany for a hail-risk screening tool.${outlined ? " The pink line is the lot boundary the tool uses; judge only what is inside it." : ""}
Report only what is visible:
- imageUsable: false if clouds, snow, shadow, blur or missing imagery prevent a judgement.
- hailNet: "yes" if hail protection nets are stretched over parking rows (fine regular mesh on masts, often grey or black, cars faintly visible underneath), "no" if the parking rows are clearly open, else "unclear".
- canopy: "yes" if carports or solid canopies cover parked vehicles, "no", or "unclear".
- parkingStructure: "yes" if there is a multi-storey car park or parking deck, "no", or "unclear".
- openAirShare: of the vehicles you can see or infer, how many stand in the open: "most", "aboutHalf", "few" or "unclear".
- note: one or two sentences in ${language} on where the protection is (e.g. "nets over the eastern rows"). No numbers, amounts or percentages.
Prefer "unclear" to a guess. Building roofs are not hail protection for the stock unless vehicles are parked under them.
Reply with exactly one JSON object and nothing else: {"imageUsable":true,"hailNet":"unclear","canopy":"unclear","parkingStructure":"unclear","openAirShare":"unclear","note":""}`;
}

export function boundaryOpinionSystemPrompt(
  language: string = responseLanguageName(),
): string {
  return `You look at one aerial image of a car dealership in Germany. The pink line is the lot boundary a screening tool found automatically; it should enclose the dealership's operating area: sales and storage areas with parked vehicles, the buildings and their yards. It should not include public roads, neighbouring businesses, fields, forest or housing.
Give a second opinion:
- verdict: "plausible" if the outline fits; "tooLarge" if it clearly includes areas that do not belong to the dealership; "tooSmall" if rows of parked vehicles or yards that obviously belong to it lie outside; "wrongPlace" if the outline does not sit on a dealership at all; "unclear" if the image does not allow a judgement.
- note: one or two sentences in ${language} naming what is wrongly included or left out and where (north, south, east, west). No numbers, amounts or percentages.
Reply with exactly one JSON object and nothing else: {"verdict":"unclear","note":""}`;
}

function modelName(): string {
  return getSettings().llm?.model ?? "";
}

function provenance(capture: AerialCapture): {
  imageCapturedAt: string | null;
  imageLabel: string;
} {
  const chosen = capture.imagery?.chosen;
  return {
    imageCapturedAt: chosen?.capturedAt?.slice(0, 10) ?? null,
    imageLabel: chosen?.label ?? "aerial image",
  };
}

const NO_IMAGE = "No aerial image is available for this location.";

async function checkCapture(
  capture: AerialCapture,
  boundary: BoundaryResult | undefined,
  label?: { imageCapturedAt: string | null; imageLabel: string },
): Promise<SiteCheck> {
  const image = await encodeAerialImage(capture, boundary);
  if (!image) throw new Error(NO_IMAGE);
  const answer = await completeJson(
    [
      { role: "system", content: siteCheckSystemPrompt(boundary != null) },
      { role: "user", content: "Aerial image of the lot." },
    ],
    SiteCheckAnswerSchema,
    SITE_CHECK_MAX_TOKENS,
    [image],
  );
  return {
    checkedAt: new Date().toISOString(),
    model: modelName(),
    ...(label ?? provenance(capture)),
    findings: cleanSiteFindings(answer),
  };
}

/**
 * Checks the current image and, with `history`, up to
 * SITE_HISTORY_MAX_IMAGES archived images spread over the available years.
 * An archived image that fails is skipped: the current check stands alone.
 */
export async function checkSite(
  lat: number,
  lon: number,
  boundary: BoundaryResult | undefined,
  history: boolean,
): Promise<SiteCheckResult> {
  const capture = await aerialImageForBoundary(lat, lon, boundary);
  const current = await checkCapture(capture, boundary);
  const older: SiteCheck[] = [];
  if (history) {
    const timeline = await waybackTimeline(lat, lon, DETECTION_ZOOM);
    const dated = timeline.candidates.filter(
      (c) =>
        c.capturedAt != null &&
        c.capturedAt.slice(0, 10) !== current.imageCapturedAt,
    );
    for (const candidate of spreadOverTime(dated, SITE_HISTORY_MAX_IMAGES)) {
      try {
        older.push(
          await checkCapture(
            await aerialImageForContextFrom(candidate, lat, lon),
            boundary,
            {
              imageCapturedAt: candidate.capturedAt!.slice(0, 10),
              imageLabel: candidate.label,
            },
          ),
        );
      } catch (error) {
        console.warn("Site check on an archived image failed:", error);
      }
    }
  }
  return { current, history: older };
}

/** Second opinion on the stored lot boundary. */
export async function boundaryOpinion(
  lat: number,
  lon: number,
  boundary: BoundaryResult,
): Promise<BoundaryOpinion> {
  const capture = await aerialImageForBoundary(lat, lon, boundary);
  const image = await encodeAerialImage(capture, boundary);
  if (!image) throw new Error(NO_IMAGE);
  const answer = await completeJson(
    [
      { role: "system", content: boundaryOpinionSystemPrompt() },
      { role: "user", content: "Aerial image with the lot boundary." },
    ],
    BoundaryOpinionAnswerSchema,
    SITE_CHECK_MAX_TOKENS,
    [image],
  );
  return {
    checkedAt: new Date().toISOString(),
    model: modelName(),
    ...provenance(capture),
    ...cleanBoundaryVerdict(answer),
  };
}
