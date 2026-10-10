import { describe, expect, it } from "vitest";
import {
  WEBSITE_URL_MAX_LENGTH,
  isHttpWebsiteUrl,
  normalizeWebsiteUrl,
  websiteLabel,
} from "./website";

describe("normalizeWebsiteUrl", () => {
  it("adds https to bare host names and keeps paths and ports", () => {
    expect(normalizeWebsiteUrl("autohaus-mueller.de")).toBe(
      "https://autohaus-mueller.de/",
    );
    expect(normalizeWebsiteUrl("  www.autohaus.de/kontakt ")).toBe(
      "https://www.autohaus.de/kontakt",
    );
    expect(normalizeWebsiteUrl("autohaus.de:8080/x")).toBe(
      "https://autohaus.de:8080/x",
    );
  });

  it("keeps explicit http(s) URLs", () => {
    expect(normalizeWebsiteUrl("http://autohaus.de/")).toBe(
      "http://autohaus.de/",
    );
    expect(normalizeWebsiteUrl("HTTPS://Autohaus.de")).toBe(
      "https://autohaus.de/",
    );
  });

  it("rejects empty, non-web and credential-carrying input", () => {
    expect(normalizeWebsiteUrl(undefined)).toBeUndefined();
    expect(normalizeWebsiteUrl("   ")).toBeUndefined();
    expect(normalizeWebsiteUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizeWebsiteUrl("mailto:info@autohaus.de")).toBeUndefined();
    expect(normalizeWebsiteUrl("file:///etc/passwd")).toBeUndefined();
    expect(normalizeWebsiteUrl("ftp://autohaus.de")).toBeUndefined();
    expect(normalizeWebsiteUrl("autohaus")).toBeUndefined();
    expect(normalizeWebsiteUrl("https://user:pw@autohaus.de")).toBeUndefined();
    expect(
      normalizeWebsiteUrl(`autohaus.de/${"x".repeat(WEBSITE_URL_MAX_LENGTH)}`),
    ).toBeUndefined();
  });
});

describe("isHttpWebsiteUrl", () => {
  it("only accepts absolute http(s) URLs", () => {
    expect(isHttpWebsiteUrl("https://autohaus.de/")).toBe(true);
    expect(isHttpWebsiteUrl("autohaus.de")).toBe(false);
    expect(isHttpWebsiteUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("websiteLabel", () => {
  it("shows the host without www", () => {
    expect(websiteLabel("https://www.autohaus.de/kontakt")).toBe("autohaus.de");
  });
});
