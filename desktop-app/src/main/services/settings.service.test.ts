import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const statement = { get: vi.fn() };
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

describe("settings persistence", () => {
  beforeEach(() => {
    mocks.statement.get.mockReset();
    mocks.safeStorage.decryptString.mockReset();
  });

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
});
