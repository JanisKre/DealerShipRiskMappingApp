/**
 * MCP App (extension io.modelcontextprotocol/ui, spec 2026-01-26): a
 * self-contained HTML view a host such as Claude renders in the chat for the
 * `portfolio_summary` tool. No external resources, no network access; data
 * arrives from the host as the tool result and is written with textContent
 * only, so portfolio text can never become markup.
 */

export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
export const MCP_APP_EXTENSION_ID = "io.modelcontextprotocol/ui";
export const PORTFOLIO_SUMMARY_UI_URI =
  "ui://dealership-risk/portfolio-summary";

export const PORTFOLIO_SUMMARY_APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portfolio summary</title>
<style>
  :root { color-scheme: light dark; --fg:#1a1a1a; --muted:#666; --line:#d9d9d9; --card:#f6f6f4; --bar:#3b6ea5; }
  :root[data-theme="dark"] { --fg:#f0f0f0; --muted:#a3a3a3; --line:#3a3a3a; --card:#232323; --bar:#7fb0e6; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --fg:#f0f0f0; --muted:#a3a3a3; --line:#3a3a3a; --card:#232323; --bar:#7fb0e6; } }
  body { margin:0; padding:12px; font:14px/1.45 system-ui, sans-serif; color:var(--fg); background:transparent; }
  h1 { font-size:16px; margin:0 0 2px; }
  .muted { color:var(--muted); font-size:12px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px; margin:12px 0; }
  .kpi { background:var(--card); border-radius:8px; padding:8px 10px; }
  .kpi b { display:block; font-size:18px; font-variant-numeric:tabular-nums; }
  table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  th, td { text-align:left; padding:5px 6px; border-bottom:1px solid var(--line); }
  th { font-size:12px; color:var(--muted); font-weight:600; }
  td.num, th.num { text-align:right; }
  .bar { height:6px; background:var(--bar); border-radius:3px; min-width:2px; }
  ul { margin:8px 0 0; padding-left:18px; }
</style>
</head>
<body>
<h1 id="title">Portfolio summary</h1>
<div class="muted" id="subtitle">Waiting for data…</div>
<div class="kpis" id="kpis"></div>
<table id="table" hidden>
  <thead><tr><th>Location</th><th>Hail zone</th><th class="num">Vehicles</th><th class="num">Hail EAL / year</th><th style="width:22%"></th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<ul class="muted" id="limits"></ul>
<script>
(function () {
  var nextId = 1, pending = {};
  function post(message) { window.parent.postMessage(message, "*"); }
  function request(method, params) {
    var id = nextId++;
    post({ jsonrpc: "2.0", id: id, method: method, params: params });
    return new Promise(function (resolve) { pending[id] = resolve; });
  }
  function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params || {} }); }
  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; }
  function eur(value) { return value == null ? "n/a" : new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value); }
  function num(value) { return value == null ? "n/a" : new Intl.NumberFormat().format(value); }
  function theme(context) { if (context && context.theme) document.documentElement.setAttribute("data-theme", context.theme); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function render(summary) {
    if (!summary || typeof summary !== "object" || !Array.isArray(summary.topByHailEal)) return;
    document.getElementById("title").textContent = summary.name || "Portfolio";
    document.getElementById("subtitle").textContent = num(summary.locations) + " locations, " + num(summary.analyzed) + " analysed, " + num(summary.withHailEal) + " with a hail EAL";
    var kpis = document.getElementById("kpis"); clear(kpis);
    [["Hail EAL / year", eur(summary.totalHailEalEur)], ["Exposure", eur(summary.totalExposureEur)], ["Vehicles", num(summary.totalVehicles)], ["Need review", num(summary.needsReview)]].forEach(function (pair) {
      var card = el("div", null, "kpi"); card.appendChild(el("span", pair[0], "muted")); card.appendChild(el("b", pair[1])); kpis.appendChild(card);
    });
    var rows = document.getElementById("rows"); clear(rows);
    var max = summary.topByHailEal.reduce(function (m, r) { return Math.max(m, r.hailEalEur || 0); }, 0);
    summary.topByHailEal.forEach(function (row) {
      var tr = el("tr");
      var name = el("td", row.name); if (row.place) { name.appendChild(el("div", row.place, "muted")); }
      tr.appendChild(name);
      tr.appendChild(el("td", row.hailZone == null ? "n/a" : row.hailZone));
      tr.appendChild(el("td", num(row.vehicles), "num"));
      tr.appendChild(el("td", eur(row.hailEalEur), "num"));
      var cell = el("td"); var bar = el("div", null, "bar"); bar.style.width = (max > 0 ? Math.round(100 * (row.hailEalEur || 0) / max) : 0) + "%"; cell.appendChild(bar); tr.appendChild(cell);
      rows.appendChild(tr);
    });
    document.getElementById("table").hidden = summary.topByHailEal.length === 0;
    var limits = document.getElementById("limits"); clear(limits);
    (summary.limitations || []).forEach(function (text) { limits.appendChild(el("li", text)); });
  }
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.id != null && pending[message.id] && !message.method) { pending[message.id](message.result); delete pending[message.id]; return; }
    if (message.method === "ui/notifications/tool-result") render(message.params && message.params.structuredContent);
    else if (message.method === "ui/notifications/host-context-changed") theme(message.params);
    else if (message.method === "ui/resource-teardown" && message.id != null) post({ jsonrpc: "2.0", id: message.id, result: {} });
  });
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      notify("ui/notifications/size-changed", { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight });
    }).observe(document.body);
  }
  var info = { name: "dealership-risk-portfolio-summary", version: "1.0.0" };
  var caps = { availableDisplayModes: ["inline"] };
  request("ui/initialize", { protocolVersion: "2026-01-26", appInfo: info, clientInfo: info, appCapabilities: caps, capabilities: caps }).then(function (result) {
    theme(result && result.hostContext);
    notify("ui/notifications/initialized");
  });
})();
</script>
</body>
</html>
`;
