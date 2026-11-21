import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import type { DrmApi } from "../src/preload";
import { dismissModelWizard, launchApp, type LaunchedApp } from "./app";

/**
 * Agent gateway end to end: the built app with the gateway switched on in
 * its settings, spoken to from outside over real HTTP — MCP, the MCP App
 * resource, A2A and AG-UI — exactly as another program on this computer
 * would. No AI provider is configured, so AG-UI must end with RUN_ERROR.
 *
 * With DRM_E2E_CLAUDE_HOST=1 and the `claude` CLI installed, Claude Code is
 * also connected as a real MCP host and asked a question it can only answer
 * through the tools (uses the CLI's own account; off by default).
 */

const PORT = 47_900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;

function site(id: string, name: string, eal: number, zone: number): unknown {
  return {
    id,
    name,
    address: "Hauptstraße 1, 01067 Dresden",
    notes: "E2E-GEHEIM",
    lat: 51.05,
    lon: 13.74,
    hailZone: zone,
    insured: true,
    detection: { vehicleCount: 100, confidence: 0.8, model: "yolo" },
    risk: {
      overallScore: 40,
      perils: [],
      eal,
      exposureEur: 2_000_000,
      computedAt: "2026-11-14T00:00:00Z",
    },
  };
}

const KEYCHAIN_MISSING = "safeStorage (OS keychain) not available";
let launched: LaunchedApp;
let page: Page;
let token = "";

const api = <T>(fn: (api: DrmApi) => Promise<T>): Promise<T> =>
  page.evaluate(
    (source) =>
      (new Function("api", `return (${source})(api)`) as (a: unknown) => T)(
        (window as unknown as { api: unknown }).api,
      ),
    fn.toString(),
  ) as Promise<T>;

async function rpc(
  path: string,
  method: string,
  params?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

test.beforeAll(async () => {
  launched = await launchApp();
  page = launched.page;
  await dismissModelWizard(page);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await page.evaluate(
    async ({ dealerships, port }) => {
      const drm = (window as unknown as { api: DrmApi }).api;
      await drm.saveSession({
        id: "e2e-gateway",
        name: "Gateway-Testportfolio",
        createdAt: "2026-11-14T00:00:00Z",
        updatedAt: "2026-11-14T00:00:00Z",
        dealerships,
      } as never);
      await drm.setSettings({
        agentGateway: {
          enabled: true,
          port,
          mcp: true,
          control: false,
          a2a: true,
          agUi: true,
        },
      });
    },
    {
      dealerships: [
        site("a", "Autohaus Alpha", 4_000, 3),
        site("b", "Autohaus Beta", 9_000, 5),
      ],
      port: PORT,
    },
  );
  // The server starts asynchronously after the settings are saved.
  // A failed start reports its error instead of a bare `false`.
  await expect
    .poll(async () => {
      const s = await api((a) => a.gatewayStatus());
      return s.running || (s.error ?? false);
    })
    .not.toBe(false);
  const status = await api((a) => a.gatewayStatus());
  // Without an OS keychain (GitHub's Linux runners) the app refuses to store
  // the token, so the gateway cannot start there; gateway.test.ts covers it.
  test.skip(
    status.error === KEYCHAIN_MISSING,
    "no OS keychain: the gateway token cannot be stored",
  );
  expect(status.error).toBeUndefined();
  expect(status.running).toBe(true);
  expect(status.port).toBe(PORT);
  token = status.token ?? "";
  expect(token.length).toBeGreaterThan(20);
});

test.afterAll(async () => {
  await launched?.close();
});

test("the gateway refuses requests without the token or from a web page", async () => {
  const noToken = await fetch(`${BASE}/mcp`, { method: "POST", body: "{}" });
  expect(noToken.status).toBe(401);
  const foreign = await rpc("/mcp", "tools/list", undefined, {
    Origin: "https://evil.example",
  });
  expect(foreign.status).toBe(403);
});

test("MCP: a client initialises, lists the tools and reads the portfolio", async () => {
  const init = await rpc("/mcp", "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1" },
  });
  expect(init.json.result).toMatchObject({
    protocolVersion: "2025-06-18",
    serverInfo: { name: "dealership-risk-mapping" },
  });
  const tools = await rpc("/mcp", "tools/list");
  expect(
    (tools.json.result as { tools: Array<{ name: string }> }).tools.map(
      (t) => t.name,
    ),
  ).toEqual([
    "list_portfolios",
    "portfolio_summary",
    "list_locations",
    "get_location",
  ]);
  const summary = await rpc("/mcp", "tools/call", {
    name: "portfolio_summary",
    arguments: {},
  });
  const text = JSON.stringify(summary.json);
  expect(summary.json.result).toMatchObject({
    structuredContent: {
      name: "Gateway-Testportfolio",
      locations: 2,
      totalHailEalEur: 13_000,
    },
  });
  // Notes and the street never leave the app.
  expect(text).not.toContain("E2E-GEHEIM");
  expect(text).not.toContain("Hauptstraße");
  const view = await rpc("/mcp", "resources/read", {
    uri: "ui://dealership-risk/portfolio-summary",
  });
  expect(JSON.stringify(view.json)).toContain("text/html;profile=mcp-app");
});

test("A2A: the agent card is public and a message completes a task", async () => {
  const card = await fetch(`${BASE}/.well-known/agent-card.json`);
  expect(card.status).toBe(200);
  expect(await card.json()).toMatchObject({
    supportedInterfaces: [{ url: `${BASE}/a2a`, protocolBinding: "JSONRPC" }],
  });
  const sent = await rpc(
    "/a2a",
    "SendMessage",
    {
      message: {
        messageId: "m1",
        role: "ROLE_USER",
        parts: [{ text: "Wie steht Autohaus Beta da?" }],
      },
    },
    { "A2A-Version": "1.0" },
  );
  expect(sent.json.result).toMatchObject({
    task: {
      status: { state: "TASK_STATE_COMPLETED" },
      artifacts: [{ name: "location-evidence" }],
    },
  });
});

test("AG-UI: without an AI provider the run ends with RUN_ERROR", async () => {
  const res = await fetch(`${BASE}/ag-ui`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      threadId: "t",
      runId: "r",
      messages: [{ id: "1", role: "user", content: "Hallo" }],
    }),
  });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const events = (await res.text())
    .split("\n\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)) as { type: string });
  expect(events[0].type).toBe("RUN_STARTED");
  expect(events.at(-1)?.type).toBe("RUN_ERROR");
});

test("the settings offer a prompt, a command and a Claude Desktop entry to copy", async () => {
  await page.getByRole("link", { name: "Einstellungen" }).click();
  await page.getByRole("tab", { name: "KI" }).click();
  await expect(page.getByText("In Claude einbinden")).toBeVisible();
  const shown = await page.locator("pre").allInnerTexts();
  expect(shown).toHaveLength(3);
  expect(shown[0]).toContain("Binde die Desktop-App");
  expect(shown[1]).toContain(
    `claude mcp add --transport http dealership-risk ${BASE}/mcp`,
  );
  expect(shown[2]).toContain('"mcp-remote"');
  // The token is hidden on screen in all three.
  expect(shown.join("\n")).not.toContain(token);
  expect(shown[1]).toContain("Bearer ••••••••");
  const dir = process.env.DRM_E2E_SCREENSHOTS;
  if (dir) {
    await page.getByText("In Claude einbinden").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/gateway-connect-claude.png` });
  }
});

/** Calls an MCP tool and returns its result object. */
async function tool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
}> {
  const reply = await rpc("/mcp", "tools/call", { name, arguments: args });
  return reply.json.result as never;
}

test("MCP remote control is off by default and, switched on, operates the window", async () => {
  // Off: the tools are neither listed nor callable.
  const before = await rpc("/mcp", "tools/list");
  expect(JSON.stringify(before.json)).not.toContain("open_portfolio");
  expect((await tool("open_view", { view: "dashboard" })).isError).toBe(true);

  await page.evaluate(async (port) => {
    const drm = (window as unknown as { api: DrmApi }).api;
    await drm.setSettings({
      agentGateway: {
        enabled: true,
        port,
        mcp: true,
        control: true,
        a2a: true,
        agUi: true,
      },
    });
  }, PORT);
  // The server restarts with the new setting.
  await expect
    .poll(async () => {
      try {
        return JSON.stringify((await rpc("/mcp", "tools/list")).json);
      } catch {
        return "";
      }
    })
    .toContain("open_portfolio");

  // The window starts on a new, unsaved portfolio.
  const start = await tool("get_app_state");
  expect(start.structuredContent).toMatchObject({
    portfolio: { id: null, locations: 0 },
    analysis: { running: false },
  });

  const opened = await tool("open_portfolio", { portfolioId: "e2e-gateway" });
  expect(opened.structuredContent).toMatchObject({
    portfolio: {
      id: "e2e-gateway",
      name: "Gateway-Testportfolio",
      locations: 2,
    },
  });
  await expect(
    page.getByText("Portfolio „Gateway-Testportfolio“ geöffnet"),
  ).toBeVisible();
  expect((await tool("open_portfolio", { portfolioId: "nope" })).isError).toBe(
    true,
  );

  // By name, with the detail dialog; from another page it returns to the map.
  await tool("open_view", { view: "dashboard" });
  await expect(page).toHaveURL(/#\/dashboard$/);
  const shown = await tool("show_location", {
    location: "Autohaus Beta",
    details: true,
  });
  expect(shown.structuredContent).toMatchObject({
    view: "map",
    selectedLocation: { id: "b", name: "Autohaus Beta" },
    detailsOpenFor: "b",
  });
  await expect(page).toHaveURL(/#\/$/);
  await expect(
    page.getByRole("dialog").getByText("Autohaus Beta").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Nothing leaves the app that the read tools would not pass on either.
  const text = JSON.stringify([start, opened, shown]);
  expect(text).not.toContain("E2E-GEHEIM");
  expect(text).not.toContain("Hauptstraße");

  // Revision 2026-07-28: no handshake, the version travels with the
  // request. With remote control on, the server offers tasks; a start the
  // window refuses (both locations have a result) is a tool error, not a
  // task.
  const modern = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
  };
  const discovered = await rpc(
    "/mcp",
    "server/discover",
    { _meta: modern },
    { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "server/discover" },
  );
  expect(discovered.json.result).toMatchObject({
    resultType: "complete",
    supportedVersions: expect.arrayContaining(["2026-07-28", "2025-11-25"]),
    capabilities: { extensions: { "io.modelcontextprotocol/tasks": {} } },
  });
  const refused = await rpc("/mcp", "tools/call", {
    name: "start_analysis",
    arguments: {},
    _meta: modern,
  });
  expect(refused.json.result).toMatchObject({
    resultType: "complete",
    isError: true,
  });
  expect(JSON.stringify(refused.json)).toContain("nothing to analyse");
  const noTask = await rpc("/mcp", "tasks/get", {
    taskId: "00000000-0000-4000-8000-000000000000",
    _meta: modern,
  });
  expect(noTask.json.error).toMatchObject({ code: -32602 });
  expect((await rpc("/mcp", "prompts/list", { _meta: modern })).status).toBe(
    404,
  );

  const stop = await tool("stop_analysis");
  expect(stop.isError).toBe(true);
  expect(stop.content[0].text).toContain("No analysis is running");
  // Arguments outside the schema never reach the window.
  expect((await tool("open_view", { view: "devtools" })).isError).toBe(true);
});

test("switching the gateway off closes the port", async () => {
  test.skip(
    process.env.DRM_E2E_CLAUDE_HOST === "1",
    "kept running for the host test",
  );
  await api((a) =>
    a.setSettings({
      agentGateway: {
        enabled: false,
        port: 47_821,
        mcp: true,
        control: false,
        a2a: true,
        agUi: true,
      },
    }),
  );
  await expect
    .poll(async () => (await api((a) => a.gatewayStatus())).running)
    .toBe(false);
  await expect(fetch(`${BASE}/mcp`, { method: "POST" })).rejects.toThrow();
});

test("Claude Code as an MCP host answers from the tools", async () => {
  test.skip(
    process.env.DRM_E2E_CLAUDE_HOST !== "1",
    "set DRM_E2E_CLAUDE_HOST=1 to connect the claude CLI",
  );
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), "drm-mcp-host-"));
  try {
    const config = join(dir, "mcp.json");
    writeFileSync(
      config,
      JSON.stringify({
        mcpServers: {
          "dealership-risk": {
            type: "http",
            url: `${BASE}/mcp`,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      }),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && !entry[0].startsWith("CLAUDE"),
      ),
    );
    const { stdout } = await promisify(execFile)(
      "claude",
      [
        "-p",
        "Use the dealership-risk MCP tools. Which location has the highest hail EAL in the portfolio, and what is the total hail EAL? Answer in one sentence with both figures.",
        "--mcp-config",
        config,
        "--strict-mcp-config",
        "--allowedTools",
        "mcp__dealership-risk__list_portfolios,mcp__dealership-risk__portfolio_summary,mcp__dealership-risk__list_locations,mcp__dealership-risk__get_location",
        "--output-format",
        "json",
      ],
      { cwd: dir, env, timeout: 170_000, maxBuffer: 10_000_000 },
    );
    const answer = (JSON.parse(stdout) as { result?: string }).result ?? "";
    console.log(`Claude Code answered: ${answer}`);
    expect(answer).toContain("Autohaus Beta");
    expect(answer.replace(/[.,\s\u00a0\u202f]/g, "")).toContain("13000");
    expect((await api((a) => a.gatewayStatus())).requests).toBeGreaterThan(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Claude Code as an MCP host operates the window", async () => {
  test.skip(
    process.env.DRM_E2E_CLAUDE_HOST !== "1",
    "set DRM_E2E_CLAUDE_HOST=1 to connect the claude CLI",
  );
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), "drm-mcp-host-"));
  try {
    const config = join(dir, "mcp.json");
    writeFileSync(
      config,
      JSON.stringify({
        mcpServers: {
          "dealership-risk": {
            type: "http",
            url: `${BASE}/mcp`,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      }),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && !entry[0].startsWith("CLAUDE"),
      ),
    );
    await tool("open_view", { view: "map" });
    const { stdout } = await promisify(execFile)(
      "claude",
      [
        "-p",
        "Use the dealership-risk MCP tools to operate the app: open the dashboard page, then show the location with the highest hail EAL of the open portfolio with its details. Answer in one sentence naming the location you showed.",
        "--mcp-config",
        config,
        "--strict-mcp-config",
        "--allowedTools",
        [
          "list_portfolios",
          "portfolio_summary",
          "list_locations",
          "get_location",
          "get_app_state",
          "open_portfolio",
          "show_location",
          "open_view",
        ]
          .map((name) => `mcp__dealership-risk__${name}`)
          .join(","),
        "--output-format",
        "json",
      ],
      { cwd: dir, env, timeout: 170_000, maxBuffer: 10_000_000 },
    );
    const answer = (JSON.parse(stdout) as { result?: string }).result ?? "";
    console.log(`Claude Code answered: ${answer}`);
    expect(answer).toContain("Autohaus Beta");
    const state = await tool("get_app_state");
    expect(state.structuredContent).toMatchObject({
      selectedLocation: { id: "b" },
      detailsOpenFor: "b",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
