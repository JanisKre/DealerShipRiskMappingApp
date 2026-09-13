import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const statement = { get: vi.fn(), run: vi.fn() };
  return {
    statement,
    db: { prepare: vi.fn(() => statement) },
    safeStorage: {
      decryptString: vi.fn(),
      encryptString: vi.fn(),
      isEncryptionAvailable: vi.fn(() => true),
    },
  };
});

vi.mock("electron", () => ({ safeStorage: mocks.safeStorage }));
vi.mock("../db/database", () => ({ getDb: () => mocks.db }));

import { getSettings } from "./settings.service";
import {
  getLlmApiKey,
  getNatCatApiKey,
  setLlmApiKey,
  setNatCatApiKey,
  setSettings,
} from "./settings.service";

describe("settings persistence", () => {
  beforeEach(() => {
    mocks.statement.get.mockReset();
    mocks.statement.run.mockReset();
    mocks.safeStorage.decryptString.mockReset();
    mocks.safeStorage.encryptString.mockReset();
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(true);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("does not decrypt keychain values while loading startup settings", () => {
    mocks.statement.get
      .mockReturnValueOnce({
        value: JSON.stringify({
          language: "en",
          llm: { provider: "openai", model: "test-model" },
          natCat: { provider: "screening" },
        }),
      })
      .mockReturnValueOnce({ present: 1 })
      .mockReturnValueOnce({ present: 1 });

    const settings = getSettings();

    expect(settings.llm?.hasApiKey).toBe(true);
    expect(settings.natCat?.catnetHasApiKey).toBe(true);
    expect(mocks.safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it("falls back to defaults when the settings JSON is damaged", () => {
    mocks.statement.get.mockReturnValueOnce({ value: "not-json" });

    expect(getSettings()).toEqual({ language: "en" });
    expect(mocks.safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it("merges and persists validated settings", () => {
    mocks.statement.get.mockReturnValueOnce({
      value: JSON.stringify({ language: "en" }),
    });

    expect(setSettings({ language: "de" })).toEqual({ language: "de" });
    expect(mocks.statement.run).toHaveBeenCalledWith(
      "app.settings",
      JSON.stringify({ language: "de" }),
    );
  });

  it("encrypts and decrypts LLM keys only on explicit use", () => {
    mocks.safeStorage.encryptString.mockReturnValue(Buffer.from("secret"));
    setLlmApiKey("openai", "api-key");
    expect(mocks.safeStorage.encryptString).toHaveBeenCalledWith("api-key");

    mocks.statement.get.mockReturnValue({
      value: Buffer.from("secret").toString("base64"),
    });
    mocks.safeStorage.decryptString.mockReturnValue("api-key");
    expect(getLlmApiKey("openai")).toBe("api-key");
  });

  it("falls back to environment keys when the stored key cannot be decrypted", () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key");
    mocks.statement.get.mockReturnValue({ value: "invalid-base64" });
    mocks.safeStorage.decryptString.mockImplementation(() => {
      throw new Error("keychain unavailable");
    });

    expect(getLlmApiKey("openai")).toBe("env-key");
  });

  it("validates CatNet keys and persists encrypted values", () => {
    expect(() => setNatCatApiKey("  ")).toThrow("cannot be empty");

    mocks.safeStorage.encryptString.mockReturnValue(Buffer.from("catnet"));
    setNatCatApiKey("catnet-key");
    expect(mocks.safeStorage.encryptString).toHaveBeenCalledWith("catnet-key");
  });

  it("uses the environment fallback for CatNet when the keychain is unavailable", () => {
    vi.stubEnv("SWISSRE_CATNET_API_KEY", "env-catnet");
    mocks.statement.get.mockReturnValue({ value: "invalid-base64" });
    mocks.safeStorage.decryptString.mockImplementation(() => {
      throw new Error("keychain unavailable");
    });

    expect(getNatCatApiKey()).toBe("env-catnet");
  });
});
