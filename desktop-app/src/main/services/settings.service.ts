import { safeStorage } from "electron";
import type { LlmProvider, NatCatApiProvider, Settings } from "@shared/types";
import { SettingsSchema } from "@shared/types";
import { getDb } from "../db/database";

/**
 * Settings persistence. Regular settings as JSON in the settings table.
 * LLM API keys are encrypted via safeStorage (OS keychain) —
 * never in plaintext, never in the renderer.
 */

const SETTINGS_KEY = "app.settings";

// The fusion engine is the supported operational detector. Legacy stays in the
// schema so benchmarks and tests can still compare both engines.
const DEFAULTS: Settings = { language: "de", boundaryEngine: "fused" };

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
  // The engine is no longer user-selectable; a "legacy" value saved by an
  // older build must not pin the weaker detector with no way to undo it.
  return withKeyPresence({ ...parsed.data, boundaryEngine: "fused" });
}

export function setSettings(partial: Partial<Settings>): Settings {
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
    custom: ["ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"],
  };
  const names = ["LLM_API_KEY", ...candidates[provider]];
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}
