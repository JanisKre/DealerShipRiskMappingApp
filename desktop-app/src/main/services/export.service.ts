import { BrowserWindow, ClipboardItem, clipboard, dialog } from "electron";
import { readFile, writeFile } from "fs/promises";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";
import type { AnalyzedDealership, Session } from "@shared/types";
import { SessionSchema } from "@shared/types";
import {
  computeAccumulationClusters,
  effectiveVehicleCount,
} from "@shared/risk-math";
import { ACCUMULATION_RADIUS_KM } from "@shared/constants";

/**
 * Assigns each location its accumulation cluster ID (only clusters with ≥ 2
 * locations). Locations without coordinates or in single-member clusters remain empty.
 */
function clusterAssignment(session: Session): Map<string, string> {
  const withCoords = session.dealerships.filter(
    (d) => d.lat != null && d.lon != null,
  );
  const map = new Map<string, string>();
  for (const c of computeAccumulationClusters(
    withCoords,
    ACCUMULATION_RADIUS_KM,
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
): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export Portfolio",
    defaultPath: `${session.name || "portfolio"}.drm`,
    filters: [
      { name: "Dealership Risk Portfolio", extensions: ["drm", "json"] },
    ],
  });
  if (canceled || !filePath) return null;
  await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
  return filePath;
}

export async function importPortfolioFile(): Promise<Session | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Import Portfolio",
    properties: ["openFile"],
    filters: [
      { name: "Dealership Risk Portfolio", extensions: ["drm", "json"] },
    ],
  });
  if (canceled || filePaths.length === 0) return null;
  const raw = await readFile(filePaths[0], "utf-8");
  return SessionSchema.parse(JSON.parse(raw));
}

/**
 * Report export (CSV/PDF/Excel). CSV: simple table. PDF: summary page +
 * risk-colored portfolio table (jspdf-autotable). Excel: styled sheet
 * with AutoFilter (exceljs).
 */
export async function exportReport(
  session: Session,
  format: "csv" | "pdf" | "excel",
): Promise<string | null> {
  const meta: Record<typeof format, { ext: string; name: string }> = {
    csv: { ext: "csv", name: "CSV" },
    pdf: { ext: "pdf", name: "PDF" },
    excel: { ext: "xlsx", name: "Excel" },
  };
  const { ext, name: filterName } = meta[format];
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export Report",
    defaultPath: `${session.name || "report"}.${ext}`,
    filters: [{ name: filterName, extensions: [ext] }],
  });
  if (canceled || !filePath) return null;

  if (format === "csv") {
    await writeFile(filePath, toCsv(session), "utf-8");
  } else if (format === "pdf") {
    await writePdf(session, filePath);
  } else {
    await writeExcel(session, filePath);
  }
  return filePath;
}

// --- Aggregate metrics for the summary ----------------------------------

interface PortfolioTotals {
  count: number;
  totalExposure: number;
  totalEal: number;
  avgScore: number;
  extremeCount: number;
}

function portfolioTotals(session: Session): PortfolioTotals {
  const ds = session.dealerships;
  const totalExposure = ds.reduce((s, d) => s + (d.risk?.exposureEur ?? 0), 0);
  const totalEal = ds.reduce((s, d) => s + (d.risk?.eal ?? 0), 0);
  const scored = ds.filter((d) => d.risk);
  const avgScore =
    scored.length > 0
      ? scored.reduce((s, d) => s + (d.risk?.overallScore ?? 0), 0) /
        scored.length
      : 0;
  const extremeCount = ds.filter(
    (d) => (d.risk?.overallScore ?? 0) >= 75,
  ).length;
  return { count: ds.length, totalExposure, totalEal, avgScore, extremeCount };
}

/** RGB color per risk score (0..100) — analogous to riskColor in the original. */
function scoreRgb(score: number): [number, number, number] {
  if (score >= 75) return [248, 113, 113]; // EXTREME
  if (score >= 50) return [251, 146, 60]; // HIGH
  if (score >= 25) return [251, 191, 36]; // MEDIUM
  return [52, 211, 153]; // LOW
}

const eur = (n: number): string =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

async function writePdf(session: Session, filePath: string): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const t = portfolioTotals(session);

  doc.setFontSize(18);
  doc.text("Dealership Risk Report", 40, 46);
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text(`Portfolio: ${session.name || "—"}`, 40, 66);
  doc.text(`Created: ${new Date().toLocaleString("de-DE")}`, 40, 82);

  doc.setTextColor(20);
  doc.setFontSize(12);
  const summary = [
    `Locations: ${t.count}`,
    `Total Exposure: ${eur(t.totalExposure)}`,
    `Total EAL: ${eur(t.totalEal)}`,
    `Avg. Risk Score: ${t.avgScore.toFixed(1)}`,
    `Extreme (≥75): ${t.extremeCount}`,
  ];
  summary.forEach((line, i) => doc.text(line, 40, 112 + i * 18));

  const head = [
    [
      "Name",
      "Machine Vehicles",
      "Manual Vehicles",
      "Vehicles Used",
      "Score",
      "Wind",
      "Lightning",
      "Snow",
      "Flood",
      "Hail",
      "Exposure",
      "EAL",
    ],
  ];
  const peril = (d: Session["dealerships"][number], name: string): number =>
    d.risk?.perils.find((x) => x.peril === name)?.score ?? 0;
  const body = session.dealerships.map((d) => [
    d.name,
    String(d.detection?.vehicleCount ?? "—"),
    String(d.detection?.manualVehicleCount ?? "—"),
    String(d.detection ? effectiveVehicleCount(d.detection) : "—"),
    (d.risk?.overallScore ?? 0).toFixed(0),
    peril(d, "wind").toFixed(0),
    peril(d, "lightning").toFixed(0),
    peril(d, "snow").toFixed(0),
    peril(d, "flood").toFixed(0),
    peril(d, "hail").toFixed(0),
    eur(d.risk?.exposureEur ?? 0),
    eur(d.risk?.eal ?? 0),
  ]);

  autoTable(doc, {
    head,
    body,
    startY: 210,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: { 0: { cellWidth: 160 } },
    didParseCell: (data) => {
      // Color the score column (cell index 2, body only)
      if (data.section === "body" && data.column.index === 2) {
        const score = Number(data.cell.raw) || 0;
        data.cell.styles.fillColor = scoreRgb(score);
        data.cell.styles.textColor = 20;
      }
    },
  });

  const buf = Buffer.from(doc.output("arraybuffer"));
  await writeFile(filePath, buf);
}

async function writeExcel(session: Session, filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dealership Risk Mapping";
  wb.created = new Date();

  const ws = wb.addWorksheet("Portfolio", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = [
    { header: "Name", key: "name", width: 30 },
    { header: "Address", key: "address", width: 30 },
    { header: "Lat", key: "lat", width: 12 },
    { header: "Lon", key: "lon", width: 12 },
    { header: "Machine Vehicles", key: "machineVehicles", width: 16 },
    { header: "Manual Vehicles", key: "manualVehicles", width: 16 },
    { header: "Vehicles Used", key: "vehicles", width: 14 },
    { header: "Score", key: "score", width: 10 },
    { header: "Wind", key: "wind", width: 8 },
    { header: "Lightning", key: "lightning", width: 8 },
    { header: "Snow", key: "snow", width: 8 },
    { header: "Flood", key: "flood", width: 8 },
    { header: "Hail", key: "hail", width: 8 },
    { header: "Exposure (EUR)", key: "exposure", width: 16 },
    { header: "EAL (EUR)", key: "eal", width: 14 },
    { header: "Insured", key: "insured", width: 12 },
    { header: "Sales Partner", key: "salesPartner", width: 20 },
    { header: "Subportfolio", key: "subPortfolio", width: 18 },
    { header: "Group", key: "group", width: 18 },
    { header: "Product Limit (EUR)", key: "productLimit", width: 18 },
    { header: "Cluster ID", key: "clusterId", width: 16 },
  ];

  const clusters = clusterAssignment(session);

  const peril = (d: Session["dealerships"][number], name: string): number =>
    d.risk?.perils.find((x) => x.peril === name)?.score ?? 0;

  for (const d of session.dealerships) {
    const row = ws.addRow({
      name: d.name,
      address: d.address ?? "",
      lat: d.lat,
      lon: d.lon,
      machineVehicles: d.detection?.vehicleCount ?? null,
      manualVehicles: d.detection?.manualVehicleCount ?? null,
      vehicles: d.detection ? effectiveVehicleCount(d.detection) : null,
      score: d.risk?.overallScore ?? null,
      wind: peril(d, "wind"),
      lightning: peril(d, "lightning"),
      snow: peril(d, "snow"),
      flood: peril(d, "flood"),
      hail: peril(d, "hail"),
      exposure: d.risk?.exposureEur ?? null,
      eal: d.risk?.eal ?? null,
      insured: d.insured == null ? "" : d.insured ? "yes" : "no",
      salesPartner: d.salesPartner ?? "",
      subPortfolio: d.subPortfolio ?? "",
      group: d.group ?? "",
      productLimit: d.productLimitEur ?? null,
      clusterId: clusters.get(d.id) ?? "",
    });
    // Color the score cell
    const score = d.risk?.overallScore ?? 0;
    const [r, g, b] = scoreRgb(score);
    const hex =
      `FF${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    row.getCell("score").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: hex },
    };
  }

  // Bold header row + AutoFilter
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" },
  };
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.autoFilter = { from: "A1", to: `U${session.dealerships.length + 1}` };

  const currencyCols = ["exposure", "eal", "productLimit"];
  for (const key of currencyCols) {
    ws.getColumn(key).numFmt = "#,##0 €";
  }

  await wb.xlsx.writeFile(filePath);
}

/**
 * CSV report — simple table.
 */

function toCsv(session: Session): string {
  const clusters = clusterAssignment(session);
  const header = [
    "name",
    "address",
    "lat",
    "lon",
    "assetValue",
    "machineVehicleCount",
    "manualVehicleCount",
    "vehicleCount",
    "overallRisk",
    "wind",
    "lightning",
    "snow",
    "flood",
    "hail",
    "eal",
    "insured",
    "salesPartner",
    "subPortfolio",
    "group",
    "productLimitEur",
    "clusterId",
  ];
  const lines = [header.join(",")];
  for (const d of session.dealerships) {
    const p = (name: string): number =>
      d.risk?.perils.find((x) => x.peril === name)?.score ?? 0;
    lines.push(
      [
        csv(d.name),
        csv(d.address ?? ""),
        d.lat,
        d.lon,
        d.assetValue ?? "",
        d.detection?.vehicleCount ?? "",
        d.detection?.manualVehicleCount ?? "",
        d.detection ? effectiveVehicleCount(d.detection) : "",
        d.risk?.overallScore ?? "",
        p("wind"),
        p("lightning"),
        p("snow"),
        p("flood"),
        p("hail"),
        d.risk?.eal ?? "",
        d.insured == null ? "" : d.insured ? "yes" : "no",
        csv(d.salesPartner ?? ""),
        csv(d.subPortfolio ?? ""),
        csv(d.group ?? ""),
        d.productLimitEur ?? "",
        clusters.get(d.id) ?? "",
      ].join(","),
    );
  }
  return lines.join("\n");
}

function csv(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

/** Risk color (hex) per score — analogous to scoreRgb. */
function scoreHex(score: number): string {
  const [r, g, b] = scoreRgb(score);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Generates a standalone, read-only HTML snapshot of the portfolio
 * (KPI summary, accumulation cluster table, location table) including an
 * embedded screenshot of the current view as a data URI. No app, no
 * backend, no external dependencies — a shareable file.
 */
export async function exportReadonlyView(
  session: Session,
): Promise<string | null> {
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
    title: "Export Read-Only View",
    defaultPath: `${session.name || "portfolio"}-view.html`,
    filters: [{ name: "HTML File", extensions: ["html"] }],
  });
  if (canceled || !filePath) return null;

  await writeFile(
    filePath,
    buildReadonlyHtml(session, snapshotDataUri),
    "utf-8",
  );
  return filePath;
}

function buildReadonlyHtml(session: Session, snapshotDataUri: string): string {
  const t = portfolioTotals(session);
  const clusterMap = clusterAssignment(session);
  const withCoords = session.dealerships.filter(
    (d) => d.lat != null && d.lon != null,
  );
  const clusters = computeAccumulationClusters(
    withCoords,
    ACCUMULATION_RADIUS_KM,
  ).filter((c) => c.count > 1);

  const peril = (d: AnalyzedDealership, name: string): number =>
    d.risk?.perils.find((x) => x.peril === name)?.score ?? 0;

  const kpis = [
    { label: "Locations", value: String(t.count) },
    { label: "Total Exposure", value: eur(t.totalExposure) },
    { label: "Total EAL", value: eur(t.totalEal) },
    { label: "Avg. Risk Score", value: t.avgScore.toFixed(1) },
    { label: "Extreme (≥75)", value: String(t.extremeCount) },
    { label: "Accumulation Clusters", value: String(clusters.length) },
  ];

  const kpiCards = kpis
    .map(
      (k) =>
        `<div class="kpi"><div class="kpi-label">${esc(k.label)}</div><div class="kpi-value">${esc(k.value)}</div></div>`,
    )
    .join("");

  const clusterRows = clusters
    .map(
      (c) => `<tr>
      <td class="mono">${esc(c.clusterId)}</td>
      <td class="num">${c.count}</td>
      <td class="num">${c.totalVehicles.toLocaleString("de-DE")}</td>
      <td class="num">${eur(c.totalExposureEur)}</td>
      <td><span class="badge" style="background:${scoreHex(c.maxHailScore)}">${c.maxHailScore.toFixed(0)}</span></td>
      <td class="num">${eur(c.natCatKpiEur)}</td>
      <td>${esc(c.dominantSalesPartner ?? "–")}</td>
    </tr>`,
    )
    .join("");

  const dealerRows = session.dealerships
    .map((d) => {
      const score = d.risk?.overallScore ?? 0;
      return `<tr>
      <td>${esc(d.name)}</td>
      <td>${esc(d.address ?? "")}</td>
      <td class="num">${d.detection?.vehicleCount ?? "–"}</td>
      <td class="num">${d.detection?.manualVehicleCount ?? "–"}</td>
      <td class="num">${d.detection ? effectiveVehicleCount(d.detection) : "–"}</td>
      <td><span class="badge" style="background:${scoreHex(score)}">${score.toFixed(0)}</span></td>
      <td class="num">${peril(d, "hail").toFixed(0)}</td>
      <td class="num">${eur(d.risk?.exposureEur ?? 0)}</td>
      <td class="num">${eur(d.risk?.eal ?? 0)}</td>
      <td>${d.insured ? "yes" : "–"}</td>
      <td>${esc(d.salesPartner ?? "")}</td>
      <td>${esc(d.subPortfolio ?? "")}</td>
      <td class="mono">${esc(clusterMap.get(d.id) ?? "")}</td>
    </tr>`;
    })
    .join("");

  const clusterSection = clusters.length
    ? `<h2>Accumulation Clusters (${clusters.length})</h2>
    <table>
      <thead><tr><th>Cluster ID</th><th class="num">Locations</th><th class="num">Vehicles</th><th class="num">Value</th><th>Hail</th><th class="num">Nat-Cat KPI</th><th>Sales Partner</th></tr></thead>
      <tbody>${clusterRows}</tbody>
    </table>`
    : "";

  const snapshotSection = snapshotDataUri
    ? `<h2>View Snapshot</h2><img class="snapshot" src="${snapshotDataUri}" alt="Snapshot of the view" />`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(session.name || "Portfolio")} — Risk View</title>
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
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; font-size: 13px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #f1f5f9; }
  th { background: #1e293b; color: #fff; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .badge { display: inline-block; min-width: 28px; text-align: center; color: #0f172a; border-radius: 6px; padding: 1px 6px; font-weight: 600; font-size: 12px; }
  .snapshot { max-width: 100%; border: 1px solid #e2e8f0; border-radius: 10px; margin-top: 8px; }
  footer { margin-top: 40px; color: #94a3b8; font-size: 12px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${esc(session.name || "Portfolio")}</h1>
      <div class="meta">Read-only view · created ${esc(new Date().toLocaleString("de-DE"))}</div>
    </header>

    <h2>Metrics</h2>
    <div class="kpis">${kpiCards}</div>

    ${clusterSection}

    <h2>Locations (${session.dealerships.length})</h2>
    <table>
      <thead><tr><th>Name</th><th>Address</th><th class="num">Machine Vehicles</th><th class="num">Manual Vehicles</th><th class="num">Vehicles Used</th><th>Score</th><th class="num">Hail</th><th class="num">Exposure</th><th class="num">EAL</th><th>Insured</th><th>Partner</th><th>Subportfolio</th><th>Cluster</th></tr></thead>
      <tbody>${dealerRows}</tbody>
    </table>

    ${snapshotSection}

    <footer>Generated with Dealership Risk Mapping — static export, no live data.</footer>
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
): Promise<{ path: string | null; ok: boolean }> {
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
        "image/png": new Blob([image.toPNG()], { type: "image/png" }),
      }),
    ]);
    return { path: null, ok: true };
  }

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Save Map Screenshot",
    defaultPath: `map-${new Date().toISOString().slice(0, 10)}.png`,
    filters: [{ name: "PNG Image", extensions: ["png"] }],
  });
  if (canceled || !filePath) return { path: null, ok: false };
  await writeFile(filePath, image.toPNG());
  return { path: filePath, ok: true };
}
