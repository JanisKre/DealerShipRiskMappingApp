import { describe, expect, it } from "vitest";
import { validateOverpassUrl } from "./overpass-url";

describe("validateOverpassUrl", () => {
  it("accepts a local server over HTTP and any server over HTTPS", () => {
    expect(
      validateOverpassUrl("http://localhost:12345/api/interpreter"),
    ).toEqual({
      ok: true,
      url: "http://localhost:12345/api/interpreter",
    });
    expect(
      validateOverpassUrl(" http://127.0.0.1:8080/api/interpreter ").ok,
    ).toBe(true);
    expect(
      validateOverpassUrl("https://overpass.example.org/api/interpreter").ok,
    ).toBe(true);
  });

  it("rejects plain HTTP to another machine", () => {
    expect(
      validateOverpassUrl("http://overpass.example.org/api/interpreter"),
    ).toEqual({
      ok: false,
      problem: "not-https",
    });
    expect(validateOverpassUrl("file:///etc/passwd")).toEqual({
      ok: false,
      problem: "not-https",
    });
  });

  it("rejects credentials, query strings and junk", () => {
    expect(
      validateOverpassUrl("https://u:p@example.org/api/interpreter").ok,
    ).toBe(false);
    expect(
      validateOverpassUrl("https://example.org/api/interpreter?data=x"),
    ).toEqual({
      ok: false,
      problem: "query-or-fragment",
    });
    expect(validateOverpassUrl("not a url")).toEqual({
      ok: false,
      problem: "invalid-url",
    });
    expect(validateOverpassUrl("   ")).toEqual({ ok: false, problem: "empty" });
  });
});
