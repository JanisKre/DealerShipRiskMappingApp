import { describe, expect, it } from "vitest";
import { validateLlmBaseUrl } from "./llmBaseUrl";

describe("validateLlmBaseUrl", () => {
  it("accepts an empty field as the provider default", () => {
    expect(validateLlmBaseUrl("  ", "openai")).toEqual({ ok: true, url: "" });
  });

  it("accepts HTTP(S) URLs", () => {
    expect(validateLlmBaseUrl(" https://proxy.example/v1 ", "openai")).toEqual({
      ok: true,
      url: "https://proxy.example/v1",
    });
    expect(validateLlmBaseUrl("http://10.0.0.5:8080/v1", "custom").ok).toBe(
      true,
    );
  });

  it("rejects text that isn't a URL", () => {
    expect(validateLlmBaseUrl("not a url", "openai")).toEqual({
      ok: false,
      problem: "invalid-url",
    });
  });

  it("rejects other schemes and embedded credentials", () => {
    expect(validateLlmBaseUrl("ftp://foo", "custom")).toEqual({
      ok: false,
      problem: "not-http",
    });
    expect(validateLlmBaseUrl("file:///etc/passwd", "custom").ok).toBe(false);
    expect(validateLlmBaseUrl("https://u:p@host/v1", "custom")).toEqual({
      ok: false,
      problem: "credentials",
    });
  });

  it("keeps a local model on this computer", () => {
    expect(validateLlmBaseUrl("http://localhost:11434/v1", "local").ok).toBe(
      true,
    );
    expect(validateLlmBaseUrl("http://127.0.0.1:1234/v1", "local").ok).toBe(
      true,
    );
    expect(validateLlmBaseUrl("http://[::1]:8080/v1", "local").ok).toBe(true);
    expect(validateLlmBaseUrl("http://192.168.1.2:11434/v1", "local")).toEqual({
      ok: false,
      problem: "not-local",
    });
  });
});
