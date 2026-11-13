import { dialog } from "electron";
import { writeFile } from "fs/promises";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import sharp from "sharp";
import type {
  AnalyzedDealership,
  HailHistory,
  RiskEvidence,
} from "@shared/types";
import { outerRings } from "@shared/boundary-geometry-utils";
import { RISK_MODEL_VERSION, DETECTION_ZOOM } from "@shared/constants";
import { dealershipHailZone, effectiveVehicleCount } from "@shared/risk-math";
import { getHailHistory } from "./hail-history/hail-history.service";
import { aerialImageForBbox, type AerialCapture } from "./tiles.service";

/**
 * One-page PDF for a single location — what goes to a colleague or broker:
 * aerial image with the lot boundary, the key figures, how the hail EAL was
 * derived, the observed hail history, open review points and the data
 * basis with its limitations. Underwriting notes stay out: they are local
 * only (see `DealershipInputSchema.notes`).
 */

export type ReportLocale = "de" | "en" | "fr";

const LABELS = {
  de: {
    title: "Standortbericht",
    created: "Erstellt",
    model: "Modell",
    imageCaption: "Luftbild",
    captured: "Aufnahme",
    noImage: "Kein Luftbild verfügbar",
    keyFigures: "Kennzahlen",
    hailZone: "Hagelzone",
    zoneEstimated: "geschätzt",
    hailEal: "Hagel-EAL (erwarteter Jahresschaden)",
    vehicles: "Fahrzeuge",
    vehiclesManual: "manuell gezählt",
    vehiclesDetected: "erkannt",
    vehiclesEstimated: "geschätzt",
    exposure: "Exposure (Fahrzeugwert)",
    area: "Grundstücksfläche",
    boundary: "Grundstücksgrenze",
    confidence: "Konfidenz",
    boundaryReview: "Prüfung empfohlen",
    boundaryConfirmed: "bestätigt",
    manual: "manuell gezeichnet",
    business: "Geschäftsart",
    existing: "Bestand",
    fresh: "Neugeschäft",
    productLimit: "Produktlimit",
    deductible: "Selbstbehalt",
    derivation: "Herleitung der Hagel-EAL",
    formula: (v: string, f: string, s: string, e: string) =>
      `${v} Fahrzeuge × ${f} Schadenereignisse/Jahr × ${s} Schaden je Fahrzeug = ${e} pro Jahr`,
    placeholder:
      "Die Frequenz- und Schadenparameter sind unkalibrierte Platzhalterwerte.",
    hailHistory: "Hagelhistorie (DWD-Stationen)",
    hailHistoryLine: (d: string, n: string, km: string, a: number, b: number) =>
      `Ø ${d} Hageltage pro Jahr an Station ${n} (${km} km, ${a}-${b})`,
    hailHistoryRecent: "Zuletzt",
    hailHistoryNone: "Keine DWD-Station mit Hagelbeobachtungen im Umkreis.",
    hailHistoryFailed: "Hagelhistorie konnte nicht geladen werden.",
    hailHistoryNote:
      "Datenbasis: Deutscher Wetterdienst. Punktbeobachtungen, kein Ereigniskatalog; fließt nicht in die EAL ein.",
    review: "Offene Prüfpunkte",
    reviewNone: "Keine",
    sources: "Datenbasis und Einschränkungen",
    disclaimer:
      "Screening-Schätzung zur Unterstützung des Underwritings - keine ingenieurtechnische, rechtliche oder versicherungstechnische Entscheidung.",
    page: "Seite",
  },
  en: {
    title: "Location report",
    created: "Created",
    model: "Model",
    imageCaption: "Aerial image",
    captured: "captured",
    noImage: "No aerial image available",
    keyFigures: "Key figures",
    hailZone: "Hail zone",
    zoneEstimated: "estimated",
    hailEal: "Hail EAL (expected annual loss)",
    vehicles: "Vehicles",
    vehiclesManual: "counted manually",
    vehiclesDetected: "detected",
    vehiclesEstimated: "estimated",
    exposure: "Exposure (vehicle value)",
    area: "Lot area",
    boundary: "Lot boundary",
    confidence: "confidence",
    boundaryReview: "review recommended",
    boundaryConfirmed: "confirmed",
    manual: "drawn manually",
    business: "Business",
    existing: "Existing",
    fresh: "New",
    productLimit: "Product limit",
    deductible: "Deductible",
    derivation: "How the hail EAL is derived",
    formula: (v: string, f: string, s: string, e: string) =>
      `${v} vehicles × ${f} damaging events/year × ${s} loss per vehicle = ${e} per year`,
    placeholder:
      "Frequency and loss parameters are uncalibrated placeholder values.",
    hailHistory: "Hail history (DWD stations)",
    hailHistoryLine: (d: string, n: string, km: string, a: number, b: number) =>
      `${d} hail days per year on average at station ${n} (${km} km, ${a}-${b})`,
    hailHistoryRecent: "Latest",
    hailHistoryNone: "No DWD station with hail observations nearby.",
    hailHistoryFailed: "The hail history could not be loaded.",
    hailHistoryNote:
      "Data basis: Deutscher Wetterdienst. Point observations, not an event catalogue; not used in the EAL.",
    review: "Open review points",
    reviewNone: "None",
    sources: "Data basis and limitations",
    disclaimer:
      "Screening estimate to support underwriting - not an engineering, legal or insurance decision.",
    page: "Page",
  },
  fr: {
    title: "Rapport de site",
    created: "Créé le",
    model: "Modèle",
    imageCaption: "Image aérienne",
    captured: "prise de vue",
    noImage: "Aucune image aérienne disponible",
    keyFigures: "Chiffres clés",
    hailZone: "Zone de grêle",
    zoneEstimated: "estimée",
    hailEal: "EAL grêle (perte annuelle attendue)",
    vehicles: "Véhicules",
    vehiclesManual: "comptés manuellement",
    vehiclesDetected: "détectés",
    vehiclesEstimated: "estimés",
    exposure: "Exposition (valeur des véhicules)",
    area: "Surface du terrain",
    boundary: "Limite du terrain",
    confidence: "confiance",
    boundaryReview: "vérification recommandée",
    boundaryConfirmed: "confirmée",
    manual: "tracée manuellement",
    business: "Affaire",
    existing: "Portefeuille",
    fresh: "Nouvelle affaire",
    productLimit: "Limite produit",
    deductible: "Franchise",
    derivation: "Calcul de l'EAL grêle",
    formula: (v: string, f: string, s: string, e: string) =>
      `${v} véhicules × ${f} événements/an × ${s} de dommage par véhicule = ${e} par an`,
    placeholder:
      "Les paramètres de fréquence et de dommage sont des valeurs provisoires non calibrées.",
    hailHistory: "Historique de grêle (stations DWD)",
    hailHistoryLine: (d: string, n: string, km: string, a: number, b: number) =>
      `${d} jours de grêle par an en moyenne à la station ${n} (${km} km, ${a}-${b})`,
    hailHistoryRecent: "Derniers",
    hailHistoryNone:
      "Aucune station DWD avec observations de grêle à proximité.",
    hailHistoryFailed: "L'historique de grêle n'a pas pu être chargé.",
    hailHistoryNote:
      "Source : Deutscher Wetterdienst. Observations ponctuelles, pas un catalogue d'événements ; non utilisé dans l'EAL.",
    review: "Points à vérifier",
    reviewNone: "Aucun",
    sources: "Sources et limites",
    disclaimer:
      "Estimation de screening pour l'aide à la souscription - pas une décision technique, juridique ou d'assurance.",
    page: "Page",
  },
} as const;

const INTL_LOCALE: Record<ReportLocale, string> = {
  de: "de-DE",
  en: "en-GB",
  fr: "fr-FR",
};

/** Lot outline colour on the aerial image (orange, readable on grey roofs). */
const OUTLINE = "#f97316";
const IMAGE_MAX_WIDTH_PX = 1100;
const IMAGE_PAD_RATIO = 0.25;
const MIN_HALF_SPAN_M = 60;

export interface LocationReportInput {
  dealership: AnalyzedDealership;
  locale: ReportLocale;
  /** Localized titles of the open review points, from the renderer. */
  reviewNotes: string[];
}

export async function exportLocationReport(
  input: LocationReportInput,
): Promise<string | null> {
  const { dealership } = input;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: LABELS[input.locale].title,
    defaultPath: `${safeFileName(dealership.name)}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return null;

  const [image, history] = await Promise.all([
    renderAerialImage(dealership).catch((err: unknown) => {
      console.warn("Location report: aerial image failed:", err);
      return null;
    }),
    getHailHistory(dealership.lat, dealership.lon).catch((err: unknown) => {
      console.warn("Location report: hail history failed:", err);
      return null;
    }),
  ]);
  const pdf = buildLocationReportPdf(input, image, history, new Date());
  await writeFile(filePath, Buffer.from(pdf));
  return filePath;
}

export function safeFileName(name: string): string {
  const cleaned = [...name]
    .map((ch) =>
      ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? " " : ch,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "location").slice(0, 120);
}

// --- Aerial image -------------------------------------------------------

/** Bbox around the lot (or the point) with some margin, at least ±60 m. */
export function reportBbox(
  d: AnalyzedDealership,
): [number, number, number, number] {
  let [west, south, east, north] = [d.lon, d.lat, d.lon, d.lat];
  for (const ring of d.boundary ? outerRings(d.boundary.polygon) : []) {
    for (const [lon, lat] of ring) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  const mPerLat = 111_320;
  const mPerLon = 111_320 * Math.cos((d.lat * Math.PI) / 180);
  const halfLon = Math.max(
    ((east - west) / 2) * (1 + IMAGE_PAD_RATIO * 2),
    MIN_HALF_SPAN_M / mPerLon,
  );
  const halfLat = Math.max(
    ((north - south) / 2) * (1 + IMAGE_PAD_RATIO * 2),
    MIN_HALF_SPAN_M / mPerLat,
  );
  const cLon = (west + east) / 2;
  const cLat = (south + north) / 2;
  return [cLon - halfLon, cLat - halfLat, cLon + halfLon, cLat + halfLat];
}

function mercatorY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

/** Lon/lat → pixel in a Web Mercator mosaic. */
export function toPixel(
  capture: Pick<
    AerialCapture,
    "originLon" | "originLat" | "lonSpan" | "latSpan" | "width" | "height"
  >,
  lon: number,
  lat: number,
): [number, number] {
  const top = mercatorY(capture.originLat);
  const bottom = mercatorY(capture.originLat - capture.latSpan);
  return [
    ((lon - capture.originLon) / capture.lonSpan) * capture.width,
    ((top - mercatorY(lat)) / (top - bottom)) * capture.height,
  ];
}

interface ReportImage {
  dataUri: string;
  width: number;
  height: number;
  caption: string;
}

async function renderAerialImage(
  d: AnalyzedDealership,
): Promise<ReportImage | null> {
  const bbox = reportBbox(d);
  const capture = await aerialImageForBbox(bbox, Math.min(DETECTION_ZOOM, 19));
  if (!capture.rgba || capture.validTileCount === 0) return null;

  const [x0, y0] = toPixel(capture, bbox[0], bbox[3]);
  const [x1, y1] = toPixel(capture, bbox[2], bbox[1]);
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const width = Math.min(capture.width - left, Math.ceil(x1 - x0));
  const height = Math.min(capture.height - top, Math.ceil(y1 - y0));
  if (width <= 0 || height <= 0) return null;

  const rings = d.boundary ? outerRings(d.boundary.polygon) : [];
  const paths = rings
    .map(
      (ring) =>
        `<polygon points="${ring
          .map(([lon, lat]) => {
            const [x, y] = toPixel(capture, lon, lat);
            return `${(x - left).toFixed(1)},${(y - top).toFixed(1)}`;
          })
          .join(
            " ",
          )}" fill="${OUTLINE}" fill-opacity="0.12" stroke="${OUTLINE}" stroke-width="${Math.max(2, width / 300).toFixed(1)}"/>`,
    )
    .join("");
  const [px, py] = toPixel(capture, d.lon, d.lat);
  const marker = `<circle cx="${(px - left).toFixed(1)}" cy="${(py - top).toFixed(1)}" r="${Math.max(4, width / 160).toFixed(1)}" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>`;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${paths}${marker}</svg>`,
  );

  const outWidth = Math.min(IMAGE_MAX_WIDTH_PX, width);
  // Two passes: sharp applies `composite` after `resize`, so the outline is
  // drawn on the full-resolution crop first and the result scaled after.
  const outlined = await sharp(Buffer.from(capture.rgba), {
    raw: { width: capture.width, height: capture.height, channels: 4 },
  })
    .extract({ left, top, width, height })
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
  const jpeg = await sharp(outlined)
    .removeAlpha()
    .resize({ width: outWidth })
    .jpeg({ quality: 82 })
    .toBuffer();
  const meta = await sharp(jpeg).metadata();
  const chosen = capture.imagery?.chosen;
  return {
    dataUri: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    width: meta.width ?? outWidth,
    height: meta.height ?? Math.round((height / width) * outWidth),
    caption: chosen
      ? `${chosen.label}${chosen.capturedAt ? ` (${chosen.capturedAt.slice(0, 10)})` : ""} · ${chosen.attribution}`
      : "Esri World Imagery",
  };
}

// --- PDF ---------------------------------------------------------------

/** Builds the PDF; pure apart from jsPDF, so it is unit-tested directly. */
export function buildLocationReportPdf(
  input: LocationReportInput,
  image: ReportImage | null,
  history: HailHistory | null,
  now: Date,
): ArrayBuffer {
  const { dealership: d, locale } = input;
  const L = LABELS[locale];
  const intl = INTL_LOCALE[locale];
  // The PDF standard fonts have no narrow no-break space (fr groups
  // thousands with it) and mis-measure the no-break space before "€".
  const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, " ");
  const eur = (n: number | undefined): string =>
    n == null
      ? "-"
      : plain(
          new Intl.NumberFormat(intl, {
            style: "currency",
            currency: "EUR",
            // "€" is outside the standard fonts' encoding and swallows
            // the following space in running text; the code reads cleanly.
            currencyDisplay: "code",
            maximumFractionDigits: 0,
          }).format(n),
        );
  const num = (n: number | undefined, digits = 0): string =>
    n == null
      ? "-"
      : plain(
          new Intl.NumberFormat(intl, { maximumFractionDigits: digits }).format(
            n,
          ),
        );
  const pct = (n: number | undefined): string =>
    n == null ? "-" : `${Math.round(n * 100)} %`;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  let y = 48;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  for (const line of doc.splitTextToSize(d.name, contentWidth) as string[]) {
    doc.text(line, margin, y);
    y += 19;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(90);
  const address = addressWithoutName(d);
  if (address) {
    doc.text(doc.splitTextToSize(address, contentWidth), margin, y);
    y += 13;
  }
  doc.text(
    `${L.title} · ${L.created} ${now.toLocaleDateString(intl)} · ${L.model} ${d.risk?.modelVersion ?? RISK_MODEL_VERSION}`,
    margin,
    y,
  );
  y += 14;

  // Aerial image, capped so the page keeps room for the figures.
  const maxImageHeight = 215;
  if (image) {
    let w = contentWidth;
    let h = (image.height / image.width) * w;
    if (h > maxImageHeight) {
      h = maxImageHeight;
      w = (image.width / image.height) * h;
    }
    doc.addImage(image.dataUri, "JPEG", margin, y, w, h);
    y += h + 11;
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text(
      doc.splitTextToSize(`${L.imageCaption}: ${image.caption}`, contentWidth),
      margin,
      y,
    );
    y += 12;
  } else {
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(L.noImage, margin, y + 10);
    y += 22;
  }

  const zone = dealershipHailZone(d);
  const detection = d.detection;
  const vehicles = detection ? effectiveVehicleCount(detection) : undefined;
  const vehicleSource =
    detection?.manualVehicleCount != null
      ? L.vehiclesManual
      : detection?.model === "stub-area-heuristic"
        ? L.vehiclesEstimated
        : detection
          ? L.vehiclesDetected
          : "";
  const boundary = d.boundary;
  const boundaryState = boundary?.reviewRequired
    ? L.boundaryReview
    : boundary?.confirmedAt
      ? L.boundaryConfirmed
      : "";
  const rows: Array<[string, string]> = [
    [
      L.hailZone,
      zone
        ? `${zone.zone}${zone.source === "estimated" ? ` (${L.zoneEstimated})` : ""}`
        : "-",
    ],
    [L.hailEal, eur(d.risk?.eal)],
    [
      L.vehicles,
      vehicles == null
        ? "-"
        : `${num(vehicles)}${vehicleSource ? ` (${vehicleSource})` : ""}`,
    ],
    [L.exposure, eur(d.risk?.exposureEur)],
    [L.area, boundary ? `${num(boundary.areaSqm)} m²` : "-"],
    [
      L.boundary,
      boundary
        ? [
            boundarySourceText(boundary.provider ?? boundary.source, L),
            `${L.confidence} ${pct(boundary.confidence)}`,
            boundaryState,
          ]
            .filter(Boolean)
            .join(" · ")
        : "-",
    ],
    [
      L.business,
      d.insured === true ? L.existing : d.insured === false ? L.fresh : "-",
    ],
  ];
  if (d.productLimitEur != null)
    rows.push([L.productLimit, eur(d.productLimitEur)]);
  if (d.deductibleEur != null) rows.push([L.deductible, eur(d.deductibleEur)]);

  autoTable(doc, {
    startY: y,
    head: [[L.keyFigures, ""]],
    body: rows,
    theme: "grid",
    margin: { left: margin, right: margin },
    styles: { fontSize: 8.5, cellPadding: 3.5, textColor: 20 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 170, textColor: 80 } },
  });
  y =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? y;
  y += 16;

  // Keeps text clear of the footer; long source lists continue on page 2.
  const footerTop = pageHeight - 52;
  const ensureRoom = (height: number): void => {
    if (y + height <= footerTop) return;
    doc.addPage();
    y = 48;
  };
  const section = (title: string): void => {
    ensureRoom(26);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(title, margin, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(40);
  };
  const paragraph = (text: string, color = 40, size = 8.5): void => {
    const lineHeight = size * 1.24;
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lines = doc.splitTextToSize(text, contentWidth) as string[];
    ensureRoom(lines.length * lineHeight);
    doc.text(lines, margin, y, { lineHeightFactor: 1.24 });
    y += lines.length * lineHeight + 2;
  };

  const detail = d.risk?.ealBreakdown?.hailDetail;
  if (detail) {
    section(L.derivation);
    paragraph(
      L.formula(
        num(detail.vehicles),
        num(detail.frequency, 3),
        eur(detail.meanSeverityEur),
        eur(d.risk?.ealBreakdown?.hail),
      ),
    );
    paragraph(L.placeholder, 100);
    y += 4;
  }

  section(L.hailHistory);
  const nearest = history?.stations[0];
  if (!history) paragraph(L.hailHistoryFailed, 100);
  else if (!nearest) paragraph(L.hailHistoryNone, 100);
  else {
    paragraph(
      L.hailHistoryLine(
        num(nearest.hailDaysPerYear, 1),
        nearest.name,
        num(nearest.distanceKm, 1),
        nearest.firstYear,
        nearest.lastYear,
      ),
    );
    if (nearest.recentHailDates.length > 0)
      paragraph(
        `${L.hailHistoryRecent}: ${nearest.recentHailDates
          .map((date) =>
            new Date(`${date}T00:00:00Z`).toLocaleDateString(intl, {
              timeZone: "UTC",
            }),
          )
          .join(", ")}`,
      );
  }
  paragraph(L.hailHistoryNote, 100);
  y += 4;

  section(L.review);
  paragraph(
    input.reviewNotes.length > 0
      ? input.reviewNotes.map((note) => `- ${note}`).join("\n")
      : L.reviewNone,
  );
  y += 4;

  section(L.sources);
  for (const line of evidenceLines(d)) paragraph(`- ${line}`, 70, 7.5);

  // Footer: disclaimer on every page (the sources can spill onto a second).
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text(
      doc.splitTextToSize(L.disclaimer, contentWidth - 50),
      margin,
      pageHeight - 28,
    );
    doc.text(
      `${L.page} ${page}/${pages}`,
      pageWidth - margin,
      pageHeight - 28,
      {
        align: "right",
      },
    );
  }
  return doc.output("arraybuffer");
}

/** "Name, 01219 Dresden" → "01219 Dresden": the name is the title already. */
export function addressWithoutName(d: AnalyzedDealership): string | undefined {
  const prefix = `${d.name}, `;
  return d.address?.startsWith(prefix)
    ? d.address.slice(prefix.length)
    : d.address;
}

function boundarySourceText(
  source: string,
  labels: (typeof LABELS)[ReportLocale],
): string {
  return source === "manual" ? labels.manual : source;
}

/** Source, method and limitations of every evidence record, deduplicated. */
export function evidenceLines(d: AnalyzedDealership): string[] {
  const records: RiskEvidence[] = [
    ...(d.risk?.evidence ?? []),
    ...(d.boundary?.evidence ? [d.boundary.evidence] : []),
    ...(d.detection?.evidence ? [d.detection.evidence] : []),
  ];
  const lines = new Set<string>();
  for (const e of records) {
    lines.add(`${e.source}: ${e.method}${e.fallbackUsed ? " (fallback)" : ""}`);
  }
  for (const limitation of [
    ...records.flatMap((e) => e.limitations),
    ...(d.risk?.limitations ?? []),
  ]) {
    lines.add(limitation);
  }
  return [...lines].slice(0, 12);
}
