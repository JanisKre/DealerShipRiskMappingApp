import { describe, expect, it } from "vitest";
import {
  evaluateLatestRelease,
  isNewerVersion,
  parseVersion,
} from "./update-release";

const TAG_PAGE =
  "https://github.com/JanisKre/DealerShipRiskMappingApp/releases/tag/v0.5.0";

describe("version comparison", () => {
  it("parses plain versions with or without a leading v", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("0.10.0")).toEqual([0, 10, 0]);
    expect(parseVersion("1.2.3-beta.1")).toBeNull();
    expect(parseVersion("latest")).toBeNull();
  });

  it("compares numerically, not as text", () => {
    expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.4.0", "0.4.0")).toBe(false);
    expect(isNewerVersion("0.3.9", "0.4.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "garbage")).toBe(false);
  });
});

describe("evaluateLatestRelease", () => {
  it("offers a newer release with its tag page", () => {
    expect(
      evaluateLatestRelease("0.4.0", {
        tag_name: "v0.5.0",
        html_url: TAG_PAGE,
      }),
    ).toEqual({
      latestVersion: "0.5.0",
      available: true,
      releaseUrl: TAG_PAGE,
    });
  });

  it("reports the current version as not available", () => {
    expect(
      evaluateLatestRelease("0.5.0", { tag_name: "v0.5.0" })?.available,
    ).toBe(false);
  });

  it("never links to a URL chosen by the response", () => {
    expect(
      evaluateLatestRelease("0.4.0", {
        tag_name: "v0.5.0",
        html_url: "https://evil.example/download",
      })?.releaseUrl,
    ).toBe(TAG_PAGE);
  });

  it("ignores drafts, pre-releases, odd tags and malformed bodies", () => {
    expect(
      evaluateLatestRelease("0.4.0", { tag_name: "v0.5.0", draft: true }),
    ).toBeNull();
    expect(
      evaluateLatestRelease("0.4.0", { tag_name: "v0.5.0", prerelease: true }),
    ).toBeNull();
    expect(evaluateLatestRelease("0.4.0", { tag_name: "nightly" })).toBeNull();
    expect(evaluateLatestRelease("0.4.0", { message: "Not Found" })).toBeNull();
    expect(evaluateLatestRelease("0.4.0", null)).toBeNull();
  });
});
