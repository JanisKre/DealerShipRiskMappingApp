import { safeStorage } from "electron";
import { randomBytes } from "node:crypto";
import { validateMcpServerUrl } from "@shared/mcp-client";
import type { LlmProvider, NatCatApiProvider, Settings } from "@shared/types";
import { SettingsSchema } from "@shared/types";
import { validateTileTemplate } from "@shared/tile-template";
import { validateOverpassUrl } from "@shared/overpass-url";
import { getDb } from "../db/database";

/**
 * Settings persistence. Regular settings as JSON in the settings table.
 * LLM API keys are encrypted via safeStorage (OS keychain) —
 * never in plaintext, never in the renderer.
 */

const SETTINGS_KEY = "app.settings";

// The fusion engine is the supported operational detector. Legacy stays in the
// schema so benchmarks and tests can still compare both engines.
const DEFAULTS: Settings = { language: "de", boundaryEngine: "cascade" };

export function getSettings(): Settings {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return DEFAULTS;
  let raw: unknown;
  try {
    raw = JSON.parse(row.value);
  } catch {
    // A damaged settings row must not prevent the application from starting.
    return DEFAULTS;
  }
  const parsed = SettingsSchema.safeParse(raw);
  if (!parsed.success) return DEFAULTS;
  // The engine is no longer user-selectable; a value saved by an older build
  // ("legacy", "fused") must not pin a retired detector with no way to undo it.
  return withKeyPresence({ ...parsed.data, boundaryEngine: "cascade" });
}

export function setSettings(partial: Partial<Settings>): Settings {
  // The custom tile template is fetched by the main process; reject it here
  // rather than at use, so the user sees why it was not saved.
  // An empty value disconnects the source (an undefined key would not
  // survive IPC); what was stated about it goes with it.
  if (partial.wmsTileUrl !== undefined) {
    if (partial.wmsTileUrl.trim() === "") {
      partial = { ...partial, wmsTileUrl: undefined, customImagery: undefined };
    } else {
      const check = validateTileTemplate(partial.wmsTileUrl);
      if (!check.ok) {
        throw new Error(`Invalid tile template (${check.problem})`);
      }
      partial = { ...partial, wmsTileUrl: check.template };
    }
  }
  // The Overpass server is queried by the main process: same rule.
  // An empty value clears it (an undefined key would not survive IPC).
  if (partial.overpassUrl !== undefined) {
    if (partial.overpassUrl.trim() === "") {
      partial = { ...partial, overpassUrl: undefined };
    } else {
      const check = validateOverpassUrl(partial.overpassUrl);
      if (!check.ok) {
        throw new Error(`Invalid Overpass server (${check.problem})`);
      }
      partial = { ...partial, overpassUrl: check.url };
    }
  }
  // MCP servers are contacted by the main process: HTTPS, or HTTP on this
  // computer only; ids must be unique.
  if (partial.mcpServers !== undefined) {
    const ids = new Set<string>();
    partial = {
      ...partial,
      mcpServers: partial.mcpServers.map((server) => {
        const check = validateMcpServerUrl(server.url);
        if (!check.ok) {
          throw new Error(`Invalid MCP server URL (${check.problem})`);
        }
        if (ids.has(server.id)) throw new Error("Duplicate MCP server id");
        ids.add(server.id);
        return { ...server, url: check.url };
      }),
    };
  }
  const merged = { ...getSettings(), ...partial };
  const validated = SettingsSchema.parse(merged);
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(SETTINGS_KEY, JSON.stringify(validated));
  // Recompute key presence: after a provider switch the merged flag still
  // describes the previous provider's key.
  return withKeyPresence(validated);
}

/**
 * Fills the `has*ApiKey` flags. Only inspects presence: decrypting during
 * startup accesses the macOS Keychain before the user actually needs an API.
 */
function withKeyPresence(settings: Settings): Settings {
  if (settings.llm) {
    settings.llm.hasApiKey = hasLlmApiKey(settings.llm.provider);
  }
  for (const server of settings.mcpServers ?? []) {
    server.hasToken = hasSecret(mcpServerTokenKey(server.id));
  }
  if (settings.natCat) {
    settings.natCat.catnetHasApiKey = hasNatCatApiKey("swissre-catnet");
    for (const [provider, connector] of Object.entries(
      settings.natCat.connectors ?? {},
    )) {
      connector.hasApiKey = hasNatCatApiKey(provider as NatCatApiProvider);
    }
  }
  return settings;
}

// --- Secrets via safeStorage ---------------------------------------------

function setSecret(key: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage (OS keychain) not available");
  }
  const enc = safeStorage.encryptString(value).toString("base64");
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(key, enc);
}

function getSecret(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return safeStorage.decryptString(Buffer.from(row.value, "base64"));
  } catch {
    return null;
  }
}

function hasSecret(key: string): boolean {
  return (
    getDb()
      .prepare("SELECT 1 AS present FROM settings WHERE key = ?")
      .get(key) != null
  );
}

function deleteSecret(key: string): void {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

const GATEWAY_TOKEN_KEY = "gateway.token";

/** Bearer token of the agent gateway; null until it was enabled once. */
export function getGatewayToken(): string | null {
  return getSecret(GATEWAY_TOKEN_KEY);
}

/** Creates the gateway token on first use; `rotate` replaces it. */
export function ensureGatewayToken(rotate = false): string {
  const existing = rotate ? null : getGatewayToken();
  if (existing) return existing;
  const token = randomBytes(32).toString("base64url");
  setSecret(GATEWAY_TOKEN_KEY, token);
  return token;
}

function mcpServerTokenKey(id: string): string {
  return `mcp.token.${id}`;
}

/** Stores the bearer token of an external MCP server; empty removes it. */
export function setMcpServerToken(id: string, token: string): void {
  if (token.trim()) setSecret(mcpServerTokenKey(id), token.trim());
  else deleteSecret(mcpServerTokenKey(id));
}

export function getMcpServerToken(id: string): string | null {
  return getSecret(mcpServerTokenKey(id));
}

// --- API-Keys via safeStorage --------------------------------------------

function keyName(provider: LlmProvider): string {
  return `llm.apikey.${provider}`;
}

export function setLlmApiKey(provider: LlmProvider, apiKey: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage (OS keychain) not available");
  }
  const enc = safeStorage.encryptString(apiKey).toString("base64");
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(keyName(provider), enc);
}

export function getLlmApiKey(provider: LlmProvider): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(keyName(provider)) as { value: string } | undefined;
  if (row) {
    try {
      return safeStorage.decryptString(Buffer.from(row.value, "base64"));
    } catch {
      // Falls back to the env fallback
    }
  }
  return envApiKey(provider);
}

function hasLlmApiKey(provider: LlmProvider): boolean {
  const row = getDb()
    .prepare("SELECT 1 as present FROM settings WHERE key = ?")
    .get(keyName(provider)) as { present: number } | undefined;
  return row != null || envApiKey(provider) != null;
}

// One key per hazard API provider. The CatNet name predates the generic
// connectors and is kept so existing installations keep their key.
function natCatKeyName(provider: NatCatApiProvider): string {
  return `natcat.apikey.${provider}`;
}

/** Environment fallback for managed deployments (CatNet only, as before). */
function natCatEnvKey(provider: NatCatApiProvider): string | null {
  if (provider !== "swissre-catnet") return null;
  return process.env.SWISSRE_CATNET_API_KEY?.trim() || null;
}

export function setNatCatApiKey(
  provider: NatCatApiProvider,
  apiKey: string,
): void {
  if (!apiKey.trim()) throw new Error("NatCat API key cannot be empty");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage (OS keychain) not available");
  }
  const enc = safeStorage.encryptString(apiKey).toString("base64");
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(natCatKeyName(provider), enc);
}

export function deleteNatCatApiKey(provider: NatCatApiProvider): void {
  getDb()
    .prepare("DELETE FROM settings WHERE key = ?")
    .run(natCatKeyName(provider));
}

export function getNatCatApiKey(provider: NatCatApiProvider): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(natCatKeyName(provider)) as { value: string } | undefined;
  if (row) {
    try {
      return safeStorage.decryptString(Buffer.from(row.value, "base64"));
    } catch {
      // Fall back to the environment for managed deployments.
    }
  }
  return natCatEnvKey(provider);
}

function hasNatCatApiKey(provider: NatCatApiProvider): boolean {
  const row = getDb()
    .prepare("SELECT 1 as present FROM settings WHERE key = ?")
    .get(natCatKeyName(provider)) as { present: number } | undefined;
  return row != null || natCatEnvKey(provider) != null;
}

/**
 * Env fallback for the API key: if no key is stored in the keychain, it comes
 * from the environment. This lets auth run entirely via a (proxy) env token
 * without a key having to be entered in the UI. Order: generic `LLM_API_KEY`
 * first, then the provider-specific variables.
 */
function envApiKey(provider: LlmProvider): string | null {
  // Local runtimes never get a key: a cloud token must not be sent to
  // whatever listens on a local port.
  if (provider === "local") return null;
  const candidates: Record<Exclude<LlmProvider, "local">, string[]> = {
    openai: ["OPENAI_API_KEY"],
    claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
    // A custom URL is whatever the user typed: a vendor's key from the
    // environment must never be sent there unasked. Only the generic
    // LLM_API_KEY (meant for exactly this) or a key saved in the settings.
    custom: [],
  };
  const names = ["LLM_API_KEY", ...candidates[provider]];
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}
