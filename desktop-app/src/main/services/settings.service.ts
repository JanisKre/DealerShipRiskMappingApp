import { safeStorage } from "electron";
import type { LlmProvider, Settings } from "@shared/types";
import { SettingsSchema } from "@shared/types";
import { getDb } from "../db/database";

/**
 * Settings persistence. Regular settings as JSON in the settings table.
 * LLM API keys are encrypted via safeStorage (OS keychain) —
 * never in plaintext, never in the renderer.
 */

const SETTINGS_KEY = "app.settings";

const DEFAULTS: Settings = { language: "en" };

export function getSettings(): Settings {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return DEFAULTS;
  const parsed = SettingsSchema.safeParse(JSON.parse(row.value));
  if (!parsed.success) return DEFAULTS;
  const settings = parsed.data;
  // Read-only flag: is a key stored in the keychain for the active provider?
  if (settings.llm) {
    settings.llm.hasApiKey = getLlmApiKey(settings.llm.provider) != null;
  }
  return settings;
}

export function setSettings(partial: Partial<Settings>): Settings {
  const merged = { ...getSettings(), ...partial };
  const validated = SettingsSchema.parse(merged);
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(SETTINGS_KEY, JSON.stringify(validated));
  return validated;
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

/**
 * Env fallback for the API key: if no key is stored in the keychain, it comes
 * from the environment. This lets auth run entirely via a (proxy) env token
 * without a key having to be entered in the UI. Order: generic `LLM_API_KEY`
 * first, then the provider-specific variables.
 */
function envApiKey(provider: LlmProvider): string | null {
  const candidates: Record<LlmProvider, string[]> = {
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
