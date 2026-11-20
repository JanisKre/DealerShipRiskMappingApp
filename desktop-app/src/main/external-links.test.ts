import { describe, expect, it } from "vitest";
import { externalUrl } from "./external-links";

describe("externalUrl", () => {
  it("passes https and mailto links", () => {
    expect(
      externalUrl("https://github.com/JanisKre/dealership_dataset#files"),
    ).toBe("https://github.com/JanisKre/dealership_dataset#files");
    expect(externalUrl("mailto:info@example.org")).toBe(
      "mailto:info@example.org",
    );
  });

  it("opens a plain http address as https", () => {
    expect(externalUrl("http://www.autohaus-beispiel.de/kontakt")).toBe(
      "https://www.autohaus-beispiel.de/kontakt",
    );
    expect(externalUrl("http://example.org:80/a")).toBe(
      "https://example.org/a",
    );
  });

  it("refuses every other scheme, credentials and broken addresses", () => {
    for (const url of [
      "file:///etc/passwd",
      "tel:+49301234567",
      "javascript:alert(1)",
      "ftp://example.org/x",
      "smb://server/share",
      "https://user:pw@example.org/",
      "not a url",
    ])
      expect(externalUrl(url), url).toBeNull();
  });
});
