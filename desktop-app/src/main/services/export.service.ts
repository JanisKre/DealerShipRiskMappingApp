import { BrowserWindow, ClipboardItem, clipboard, dialog } from "electron";
import { readFile, writeFile } from "fs/promises";
import { jsPDF } from "jspdf";
// Named import: the CJS build Electron loads exports `autoTable` and a
// `default` property, so a default import calls the module object itself.
import { autoTable } from "jspdf-autotable";
import ExcelJS from "exceljs";
import type { AnalyzedDealership, Session } from "@shared/types";
import { SessionSchema } from "@shared/types";
import {
  ELEVATED_HAIL_ZONE,
  computeAccumulationClusters,
  dealershipHailZone,
  effectiveVehicleCount,
  estimateHailZoneFromScore,
} from "@shared/risk-math";
import { normalizeRiskParameters } from "@shared/parameters";
import { ealCoverage, estimatedExposure, hasEalBasis } from "@shared/estimates";
import {
  exportLabels,
  methodFacts,
  siteProvenance,
  type ExportLocale,
} from "./export-content";

/**
 * Assigns each location its accumulation cluster ID (only clusters with ≥ 2
 * locations). Locations without coordinates or in single-member clusters remain empty.
 */
function clusterAssignment(session: Session): Map<string, string> {
  const parameters = normalizeRiskParameters(session.parameters);
  const withCoords = session.dealerships.filter(
    (d) => d.lat != null && d.lon != null,
  );
  const map = new Map<string, string>();
  for (const c of computeAccumulationClusters(
    withCoords,
    parameters.accumulationRadiusKm,
    parameters,
  )) {
    if (c.count < 2) continue;
    for (const id of c.memberIds) map.set(id, c.clusterId);
  }
  return map;
}

/**
 * File-based export/import of a portfolio (replaces the share-token links).
 * Format: .drm (JSON). Sharing happens by passing along the file.
 */

export async function exportPortfolioFile(
  session: Session,
  locale: ExportLocale = "en",
): Promise<string | null> {
  const L = exportLabels(locale);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: L.dialog.portfolioExport,
    defaultPath: `${session.name || "portfolio"}.drm`,
    filters: [{ name: L.dialog.portfolioFilter, extensions: ["drm", "json"] }],
  });
  if (canceled || !filePath) return null;
  await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
  return filePath;
}

export async function importPortfolioFile(
  locale: ExportLocale = "en",
): Promise<Session | null> {
  const L = exportLabels(locale);
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: L.dialog.portfolioImport,
    properties: ["openFile"],
    filters: [{ name: L.dialog.portfolioFilter, extensions: ["drm", "json"] }],
  });
  if (canceled || filePaths.length === 0) return null;
  const raw = await readFile(filePaths[0], "utf-8");
  return SessionSchema.parse(JSON.parse(raw));
}

/**
 * Report export (CSV/PDF/Excel) in the UI language. Every format carries
 * per-site provenance (vehicle source, estimated exposure, boundary source
 * and confidence, model version) and — except the plain CSV table — the
 * methodology and limitations block (UW-11).
 */
export async function exportReport(
  session: Session,
  format: "csv" | "pdf" | "excel",
  locale: ExportLocale = "en",
): Promise<string | null> {
  const L = exportLabels(locale);
  const meta: Record<typeof format, { ext: string; name: string }> = {
    csv: { ext: "csv", name: "CSV" },
    pdf: { ext: "pdf", name: "PDF" },
    excel: { ext: "xlsx", name: "Excel" },
  };
  const { ext, name: filterName } = meta[format];
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: L.dialog.report,
    defaultPath: `${session.name || "report"}.${ext}`,
    filters: [{ name: filterName, extensions: [ext] }],
  });
  if (canceled || !filePath) return null;

  if (format === "csv") {
    await writeFile(filePath, toCsv(session, locale), "utf-8");
  } else if (format === "pdf") {
    await writePdf(session, filePath, locale);
  } else {
    await writeExcel(session, filePath, locale);
  }
  return filePath;
}

// --- Aggregate metrics for the summary ----------------------------------

interface PortfolioTotals {
  count: number;
  totalExposure: number;
  /** 0..100, rounded: share of the exposure that is an estimate. */
  exposureEstimatedPct: number;
  totalEal: number;
  /** Analysed sites and those with a vehicle count (EAL basis). */
  coverage: { withBasis: number; analyzed: number };
  /** Locations in hail zone 4 or higher. */
  elevatedZoneCount: number;
}

function portfolioTotals(session: Session): PortfolioTotals {
  const ds = session.dealerships;
  const exposure = estimatedExposure(ds);
  const totalEal = ds.reduce(
    (s, d) => s + (hasEalBasis(d) ? (d.risk?.eal ?? 0) : 0),
    0,
  );
  const elevatedZoneCount = ds.filter(
    (d) => (dealershipHailZone(d)?.zone ?? 0) >= ELEVATED_HAIL_ZONE,
  ).length;
  return {
    count: ds.length,
    totalExposure: exposure.totalEur,
    exposureEstimatedPct: Math.round(exposure.share * 100),
    totalEal,
    coverage: ealCoverage(ds),
    elevatedZoneCount,
  };
}

/** RGB color per hail zone (1 = green … 6 = red), lighter than the map's so text stays readable. */
const ZONE_RGB: Array<[number, number, number]> = [
  [52, 211, 153], // 1
  [163, 230, 53], // 2
  [251, 191, 36], // 3
  [251, 146, 60], // 4
  [248, 113, 113], // 5
  [225, 29, 72], // 6
];

function zoneRgb(zone: number): [number, number, number] {
  return ZONE_RGB[Math.min(6, Math.max(1, Math.round(zone))) - 1];
}

/** Hail zone as display text; "—" when the location has no zone yet, "≈" when estimated. */
function zoneText(d: AnalyzedDealership): string {
  const zone = dealershipHailZone(d);
  if (zone == null) return "—";
  return zone.source === "estimated" ? `≈${zone.zone}` : String(zone.zone);
}

function formatters(locale: ExportLocale): {
  eur: (n: number) => string;
  num: (n: number, digits?: number) => string;
  pct: (n: number) => string;
} {
  const intl = exportLabels(locale).intl;
  return {
    eur: (n) =>
      new Intl.NumberFormat(intl, {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(n),
    num: (n, digits = 0) =>
      new Intl.NumberFormat(intl, { maximumFractionDigits: digits }).format(n),
    pct: (n) =>
      new Intl.NumberFormat(intl, {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(n),
  };
}

/** Summary lines shared by PDF and HTML. */
function summaryLines(
  session: Session,
  locale: ExportLocale,
): Array<{ label: string; value: string; hint?: string }> {
  const L = exportLabels(locale);
  const f = formatters(locale);
  const t = portfolioTotals(session);
  return [
    { label: L.locations, value: f.num(t.count) },
    {
      label: L.totalExposure,
      value: `${t.exposureEstimatedPct > 0 ? "≈" : ""}${f.eur(t.totalExposure)}`,
      hint:
        t.exposureEstimatedPct > 0
          ? L.estimatedShare(t.exposureEstimatedPct)
          : undefined,
    },
    {
      label: L.totalEal,
      value:
        t.coverage.analyzed > 0 && t.coverage.withBasis === 0
          ? "–"
          : f.eur(t.totalEal),
      hint: L.ealCoverage(t.coverage.withBasis, t.coverage.analyzed),
    },
    {
      label: L.elevated(ELEVATED_HAIL_ZONE),
      value: f.num(t.elevatedZoneCount),
    },
  ];
}

function methodLines(session: Session, locale: ExportLocale): string[] {
  const parameters = normalizeRiskParameters(session.parameters);
  return exportLabels(locale).method(methodFacts(session, parameters, locale));
}

/** Vehicles as shown in a report cell: "≈2.896" for an area estimate. */
function vehiclesText(d: AnalyzedDealership, locale: ExportLocale): string {
  if (!d.detection) return "—";
  const f = formatters(locale);
  const value = f.num(effectiveVehicleCount(d.detection));
  return siteProvenance(d).vehicleSource === "areaEstimate"
    ? `≈${value}`
    : value;
}

function ealText(d: AnalyzedDealership, locale: ExportLocale): string {
  const L = exportLabels(locale);
  const p = siteProvenance(d);
  if (p.ealStatus === "pending") return "—";
  if (p.ealStatus === "noCount") return L.noEal;
  return formatters(locale).eur(d.risk?.eal ?? 0);
}

function exposureText(d: AnalyzedDealership, locale: ExportLocale): string {
  if (!d.risk) return "—";
  const value = formatters(locale).eur(d.risk.exposureEur ?? 0);
  return siteProvenance(d).exposureEstimated ? `≈${value}` : value;
}

function boundaryText(d: AnalyzedDealership, locale: ExportLocale): string {
  const p = siteProvenance(d);
  if (!p.boundarySource) return "—";
  return p.boundaryConfidence != null
    ? `${p.boundarySource} · ${formatters(locale).pct(p.boundaryConfidence)}`
    : p.boundarySource;
}

async function writePdf(
  session: Session,
  filePath: string,
  locale: ExportLocale,
): Promise<void> {
  const L = exportLabels(locale);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  doc.setFontSize(18);
  doc.text(L.reportTitle, 40, 46);
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text(`${L.portfolio}: ${session.name || "—"}`, 40, 66);
  doc.text(
    `${L.created}: ${new Date().toLocaleString(L.intl)} · ${L.method(methodFacts(session, normalizeRiskParameters(session.parameters), locale))[0]}`,
    40,
    82,
    { maxWidth: 760 },
  );

  doc.setTextColor(20);
  doc.setFontSize(12);
  summaryLines(session, locale).forEach((line, i) =>
    doc.text(
      `${line.label}: ${line.value}${line.hint ? ` (${line.hint})` : ""}`,
      40,
      116 + i * 18,
    ),
  );

  const c = L.columns;
  const head = [
    [
      c.name,
      c.hailZone,
      c.vehicles,
      c.vehicleSource,
      c.boundarySource,
      c.exposure,
      c.eal,
    ],
  ];
  const body = session.dealerships.map((d) => [
    d.name,
    zoneText(d),
    vehiclesText(d, locale),
    L.vehicleSource[siteProvenance(d).vehicleSource],
    boundaryText(d, locale),
    exposureText(d, locale),
    ealText(d, locale),
  ]);

  autoTable(doc, {
    head,
    body,
    startY: 196,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: { 0: { cellWidth: 170 } },
    didParseCell: (data) => {
      // Color the hail zone column (cell index 1, body only)
      if (data.section === "body" && data.column.index === 1) {
        const zone = Number(String(data.cell.raw).replace("≈", ""));
        if (zone >= 1) data.cell.styles.fillColor = zoneRgb(zone);
        data.cell.styles.textColor = 20;
      }
    },
  });

  // Methodology and limitations on their own page.
  doc.addPage();
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text(L.methodTitle, 40, 46);
  doc.setFontSize(10);
  let y = 72;
  for (const line of methodLines(session, locale)) {
    const wrapped = doc.splitTextToSize(`• ${line}`, 760) as string[];
    doc.text(wrapped, 40, y);
    y += wrapped.length * 13 + 6;
  }

  const buf = Buffer.from(doc.output("arraybuffer"));
  await writeFile(filePath, buf);
}

async function writeExcel(
  session: Session,
  filePath: string,
  locale: ExportLocale,
): Promise<void> {
  const L = exportLabels(locale);
  const c = L.columns;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dealership Risk Mapping";
  wb.created = new Date();

  const ws = wb.addWorksheet(L.portfolio, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = [
    { header: c.name, key: "name", width: 30 },
    { header: c.address, key: "address", width: 30 },
    { header: c.lat, key: "lat", width: 12 },
    { header: c.lon, key: "lon", width: 12 },
    { header: c.machineVehicles, key: "machineVehicles", width: 16 },
    { header: c.manualVehicles, key: "manualVehicles", width: 16 },
    { header: c.vehicles, key: "vehicles", width: 14 },
    { header: c.vehicleSource, key: "vehicleSource", width: 24 },
    { header: c.hailZone, key: "hailZone", width: 10 },
    { header: c.hailZoneSource, key: "hailZoneSource", width: 14 },
    { header: c.exposure, key: "exposure", width: 16 },
    { header: c.exposureEstimated, key: "exposureEstimated", width: 12 },
    { header: c.eal, key: "eal", width: 14 },
    { header: c.ealStatus, key: "ealStatus", width: 18 },
    { header: c.ealLow, key: "ealLow", width: 18 },
    { header: c.ealHigh, key: "ealHigh", width: 18 },
    { header: c.boundarySource, key: "boundarySource", width: 14 },
    { header: c.boundaryConfidence, key: "boundaryConfidence", width: 12 },
    { header: c.confidence, key: "confidence", width: 12 },
    { header: c.modelVersion, key: "modelVersion", width: 16 },
    { header: c.insured, key: "insured", width: 12 },
    { header: c.salesPartner, key: "salesPartner", width: 20 },
    { header: c.subPortfolio, key: "subPortfolio", width: 18 },
    { header: c.group, key: "group", width: 18 },
    { header: c.assetValue, key: "assetValue", width: 18 },
    { header: c.productLimit, key: "productLimit", width: 18 },
    { header: c.deductible, key: "deductible", width: 16 },
    { header: c.clusterId, key: "clusterId", width: 16 },
  ];

  const clusters = clusterAssignment(session);

  for (const d of session.dealerships) {
    const p = siteProvenance(d);
    const zone = dealershipHailZone(d);
    const row = ws.addRow({
      name: d.name,
      address: d.address ?? "",
      lat: d.lat,
      lon: d.lon,
      machineVehicles: d.detection?.vehicleCount ?? null,
      manualVehicles: d.detection?.manualVehicleCount ?? null,
      vehicles: d.detection ? effectiveVehicleCount(d.detection) : null,
      vehicleSource: L.vehicleSource[p.vehicleSource],
      hailZone: zone?.zone ?? null,
      hailZoneSource: zone?.source ?? "",
      exposure: d.risk?.exposureEur ?? null,
      exposureEstimated: d.risk ? (p.exposureEstimated ? L.yes : L.no) : "",
      // No vehicle count, no EAL: an empty cell, not 0 €.
      eal: p.ealStatus === "ok" ? (d.risk?.eal ?? null) : null,
      ealStatus: L.ealStatus[p.ealStatus],
      ealLow: d.risk?.ealBreakdown?.hailDetail?.stockRange?.ealLow ?? null,
      ealHigh: d.risk?.ealBreakdown?.hailDetail?.stockRange?.ealHigh ?? null,
      boundarySource: p.boundarySource ?? "",
      boundaryConfidence: p.boundaryConfidence ?? null,
      confidence: p.confidence ?? null,
      modelVersion: p.modelVersion ?? "",
      insured: d.insured == null ? "" : d.insured ? L.yes : L.no,
      salesPartner: d.salesPartner ?? "",
      subPortfolio: d.subPortfolio ?? "",
      group: d.group ?? "",
      assetValue: d.assetValue ?? null,
      productLimit: d.productLimitEur ?? null,
      deductible: d.deductibleEur ?? null,
      clusterId: clusters.get(d.id) ?? "",
    });
    // Color the hail zone cell
    if (zone != null) {
      const hex = `FF${zoneRgb(zone.zone)
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("")}`.toUpperCase();
      row.getCell("hailZone").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: hex },
      };
    }
  }

  // Bold header row + AutoFilter
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" },
  };
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: session.dealerships.length + 1, column: ws.columnCount },
  };

  const currencyCols = [
    "exposure",
    "eal",
    "ealLow",
    "ealHigh",
    "assetValue",
    "productLimit",
    "deductible",
  ];
  for (const key of currencyCols) {
    ws.getColumn(key).numFmt = "#,##0 €";
  }
  for (const key of ["boundaryConfidence", "confidence"]) {
    ws.getColumn(key).numFmt = "0%";
  }

  // Methodology, sources and limitations travel with the numbers.
  const notes = wb.addWorksheet(L.methodTitle.slice(0, 31));
  notes.columns = [{ header: L.methodTitle, key: "text", width: 140 }];
  notes.getRow(1).font = { bold: true };
  for (const line of summaryLines(session, locale)) {
    notes.addRow({
      text: `${line.label}: ${line.value}${line.hint ? ` (${line.hint})` : ""}`,
    });
  }
  notes.addRow({ text: "" });
  for (const line of methodLines(session, locale)) {
    const row = notes.addRow({ text: line });
    row.alignment = { wrapText: true, vertical: "top" };
  }

  await wb.xlsx.writeFile(filePath);
}

/**
 * CSV report — one row per site with provenance columns. English keeps the
 * machine-readable header and `,`; German and French use their headers,
 * `;`, decimal commas and a UTF-8 BOM so Excel opens them correctly.
 */
export function toCsv(session: Session, locale: ExportLocale = "en"): string {
  const L = exportLabels(locale);
  const c = L.columns;
  const sep = L.csvSeparator;
  const decimal = (v: number | undefined | null): string =>
    v == null ? "" : sep === ";" ? String(v).replace(".", ",") : String(v);
  const clusters = clusterAssignment(session);
  const header = [
    c.name,
    c.address,
    c.lat,
    c.lon,
    c.assetValue,
    c.machineVehicles,
    c.manualVehicles,
    c.vehicles,
    c.vehicleSource,
    c.hailZone,
    c.hailZoneSource,
    c.exposure,
    c.exposureEstimated,
    c.eal,
    c.ealStatus,
    c.ealLow,
    c.ealHigh,
    c.boundarySource,
    c.boundaryConfidence,
    c.confidence,
    c.modelVersion,
    c.insured,
    c.salesPartner,
    c.subPortfolio,
    c.group,
    c.productLimit,
    c.deductible,
    c.clusterId,
  ];
  const cell = (v: string): string => csv(v, sep);
  const lines = [header.map(cell).join(sep)];
  for (const d of session.dealerships) {
    const p = siteProvenance(d);
    const zone = dealershipHailZone(d);
    lines.push(
      [
        cell(d.name),
        cell(d.address ?? ""),
        decimal(d.lat),
        decimal(d.lon),
        decimal(d.assetValue),
        d.detection?.vehicleCount ?? "",
        d.detection?.manualVehicleCount ?? "",
        d.detection ? effectiveVehicleCount(d.detection) : "",
        locale === "en"
          ? p.vehicleSource
          : cell(L.vehicleSource[p.vehicleSource]),
        zone?.zone ?? "",
        zone?.source ?? "",
        decimal(d.risk?.exposureEur),
        d.risk ? (p.exposureEstimated ? L.yes : L.no) : "",
        // No vehicle count, no EAL: empty, with the reason in ealStatus.
        p.ealStatus === "ok" ? decimal(d.risk?.eal) : "",
        locale === "en" ? p.ealStatus : cell(L.ealStatus[p.ealStatus]),
        decimal(d.risk?.ealBreakdown?.hailDetail?.stockRange?.ealLow),
        decimal(d.risk?.ealBreakdown?.hailDetail?.stockRange?.ealHigh),
        p.boundarySource ?? "",
        decimal(p.boundaryConfidence),
        decimal(p.confidence),
        cell(p.modelVersion ?? ""),
        d.insured == null ? "" : d.insured ? L.yes : L.no,
        cell(d.salesPartner ?? ""),
        cell(d.subPortfolio ?? ""),
        cell(d.group ?? ""),
        decimal(d.productLimitEur),
        decimal(d.deductibleEur),
        clusters.get(d.id) ?? "",
      ].join(sep),
    );
  }
  const body = lines.join("\n");
  return sep === ";" ? `\uFEFF${body}` : body;
}

function csv(s: string, sep = ","): string {
  // A cell starting like a formula is run by Excel/LibreOffice on opening
  // (CSV injection); the leading apostrophe keeps it text.
  const text = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  const special = sep === ";" ? /[";\n\r]/ : /[",\n\r]/;
  return special.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// --- Read-only HTML bundle (sharing without the app) -------------------------------

/** HTML escaping for text content. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Hail zone color (hex) — analogous to zoneRgb. */
function zoneHex(zone: number): string {
  const [r, g, b] = zoneRgb(zone);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Generates a standalone, read-only HTML snapshot of the portfolio
 * (KPI summary, accumulation cluster table, location table, methodology)
 * including an embedded screenshot of the current view as a data URI. No
 * app, no backend, no external dependencies — a shareable file.
 */
export async function exportReadonlyView(
  session: Session,
  locale: ExportLocale = "en",
): Promise<string | null> {
  const L = exportLabels(locale);
  const win = BrowserWindow.getAllWindows()[0];

  // Best-effort screenshot of the current view as an embedded image.
  let snapshotDataUri = "";
  if (win) {
    try {
      const image = await win.webContents.capturePage();
      snapshotDataUri = image.toDataURL();
    } catch {
      // Continue without an image.
    }
  }

  const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined, {
    title: L.dialog.view,
    defaultPath: `${session.name || "portfolio"}-view.html`,
    filters: [{ name: L.dialog.htmlFilter, extensions: ["html"] }],
  });
  if (canceled || !filePath) return null;

  await writeFile(
    filePath,
    buildReadonlyHtml(session, snapshotDataUri, locale),
    "utf-8",
  );
  return filePath;
}

function buildReadonlyHtml(
  session: Session,
  snapshotDataUri: string,
  locale: ExportLocale = "en",
): string {
  const L = exportLabels(locale);
  const c = L.columns;
  const f = formatters(locale);
  const parameters = normalizeRiskParameters(session.parameters);
  const clusterMap = clusterAssignment(session);
  const withCoords = session.dealerships.filter(
    (d) => d.lat != null && d.lon != null,
  );
  const clusters = computeAccumulationClusters(
    withCoords,
    parameters.accumulationRadiusKm,
    parameters,
  ).filter((cl) => cl.count > 1);
  const byId = new Map(session.dealerships.map((d) => [d.id, d]));

  const kpis = [
    ...summaryLines(session, locale),
    { label: L.clusters, value: f.num(clusters.length), hint: undefined },
  ];

  const kpiCards = kpis
    .map(
      (k) =>
        `<div class="kpi"><div class="kpi-label">${esc(k.label)}</div><div class="kpi-value">${esc(k.value)}</div>${k.hint ? `<div class="kpi-hint">${esc(k.hint)}</div>` : ""}</div>`,
    )
    .join("");

  const clusterRows = clusters
    .map((cl) => {
      const zone = estimateHailZoneFromScore(cl.maxHailScore);
      const members = cl.memberIds
        .map((id) => byId.get(id))
        .filter((d): d is AnalyzedDealership => d != null);
      const share = Math.round(estimatedExposure(members).share * 100);
      return `<tr>
      <td class="mono">${esc(cl.clusterId)}</td>
      <td class="num">${cl.count}</td>
      <td class="num">${f.num(cl.totalVehicles)}</td>
      <td class="num">${share > 0 ? "≈" : ""}${f.eur(cl.totalExposureEur)}${share > 0 ? `<br><small>${esc(L.estimatedShare(share))}</small>` : ""}</td>
      <td><span class="badge" style="background:${zoneHex(zone)}">${zone}</span></td>
      <td class="num">${f.eur(cl.natCatKpiEur)}</td>
      <td>${esc(cl.dominantSalesPartner ?? "–")}</td>
    </tr>`;
    })
    .join("");

  const dealerRows = session.dealerships
    .map((d) => {
      const zone = dealershipHailZone(d)?.zone;
      const p = siteProvenance(d);
      return `<tr>
      <td>${esc(d.name)}</td>
      <td>${esc(d.address ?? "")}</td>
      <td class="num">${esc(vehiclesText(d, locale))}</td>
      <td>${esc(L.vehicleSource[p.vehicleSource])}</td>
      <td>${zone != null ? `<span class="badge" style="background:${zoneHex(zone)}">${esc(zoneText(d))}</span>` : "–"}</td>
      <td class="num">${esc(exposureText(d, locale))}</td>
      <td class="num">${esc(ealText(d, locale))}</td>
      <td>${esc(boundaryText(d, locale))}</td>
      <td>${esc(p.modelVersion ?? "–")}</td>
      <td>${d.insured == null ? "–" : d.insured ? L.yes : L.no}</td>
      <td>${esc(d.salesPartner ?? "")}</td>
      <td class="mono">${esc(clusterMap.get(d.id) ?? "")}</td>
    </tr>`;
    })
    .join("");

  const clusterSection = clusters.length
    ? `<h2>${esc(L.clusters)} (${clusters.length})</h2>
    <table>
      <thead><tr><th>${esc(c.clusterId)}</th><th class="num">${esc(L.locations)}</th><th class="num">${esc(c.vehicles)}</th><th class="num">${esc(c.exposure)}</th><th>${esc(c.hailZone)}</th><th class="num">Nat-Cat KPI</th><th>${esc(c.salesPartner)}</th></tr></thead>
      <tbody>${clusterRows}</tbody>
    </table>`
    : "";

  const snapshotSection = snapshotDataUri
    ? `<h2>Snapshot</h2><img class="snapshot" src="${snapshotDataUri}" alt="Snapshot" />`
    : "";

  const methodSection = `<h2>${esc(L.methodTitle)}</h2>
    <ul class="method">${methodLines(session, locale)
      .map((line) => `<li>${esc(line)}</li>`)
      .join("")}</ul>`;

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(session.name || L.portfolio)} — ${esc(L.viewTitle)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #f8fafc; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }
  header { border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #64748b; font-size: 13px; }
  h2 { font-size: 16px; margin: 32px 0 12px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  .kpi-label { font-size: 12px; color: #64748b; }
  .kpi-value { font-size: 20px; font-weight: 600; margin-top: 2px; }
  .kpi-hint { font-size: 12px; color: #64748b; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; font-size: 13px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #f1f5f9; }
  th { background: #1e293b; color: #fff; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .badge { display: inline-block; min-width: 28px; text-align: center; color: #0f172a; border-radius: 6px; padding: 1px 6px; font-weight: 600; font-size: 12px; }
  .snapshot { max-width: 100%; border: 1px solid #e2e8f0; border-radius: 10px; margin-top: 8px; }
  .method { font-size: 13px; line-height: 1.5; color: #334155; }
  footer { margin-top: 40px; color: #94a3b8; font-size: 12px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${esc(session.name || L.portfolio)}</h1>
      <div class="meta">${esc(L.viewTitle)} · ${esc(L.created)} ${esc(new Date().toLocaleString(L.intl))}</div>
      <div class="meta">${esc(L.method(methodFacts(session, parameters, locale))[0])}</div>
    </header>

    <h2>${esc(L.reportTitle)}</h2>
    <div class="kpis">${kpiCards}</div>

    ${clusterSection}

    <h2>${esc(L.locations)} (${session.dealerships.length})</h2>
    <table>
      <thead><tr><th>${esc(c.name)}</th><th>${esc(c.address)}</th><th class="num">${esc(c.vehicles)}</th><th>${esc(c.vehicleSource)}</th><th>${esc(c.hailZone)}</th><th class="num">${esc(c.exposure)}</th><th class="num">${esc(c.eal)}</th><th>${esc(c.boundarySource)}</th><th>${esc(c.modelVersion)}</th><th>${esc(c.insured)}</th><th>${esc(c.salesPartner)}</th><th>${esc(c.clusterId)}</th></tr></thead>
      <tbody>${dealerRows}</tbody>
    </table>

    ${methodSection}

    ${snapshotSection}

    <footer>Dealership Risk Mapping — static export, no live data.</footer>
  </div>
</body>
</html>`;
}

/**
 * Takes a screenshot of the renderer window (optionally cropped to `rect`)
 * and saves it as a PNG file or copies it to the clipboard.
 */
export async function captureMap(
  rect: { x: number; y: number; width: number; height: number } | undefined,
  mode: "save" | "clipboard",
  locale: ExportLocale = "en",
): Promise<{ path: string | null; ok: boolean }> {
  const L = exportLabels(locale);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return { path: null, ok: false };

  const image = await win.webContents.capturePage(
    rect
      ? {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
      : undefined,
  );

  if (mode === "clipboard") {
    await clipboard.write([
      new ClipboardItem({
        "image/png": new Blob([new Uint8Array(image.toPNG())], {
          type: "image/png",
        }),
      }),
    ]);
    return { path: null, ok: true };
  }

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: L.dialog.screenshot,
    defaultPath: `map-${new Date().toISOString().slice(0, 10)}.png`,
    filters: [{ name: L.dialog.pngFilter, extensions: ["png"] }],
  });
  if (canceled || !filePath) return { path: null, ok: false };
  await writeFile(filePath, image.toPNG());
  return { path: filePath, ok: true };
}
