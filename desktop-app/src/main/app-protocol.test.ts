import { join, resolve, sep } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ protocol: {} }));

import {
  APP_ENTRY_URL,
  contentTypeFor,
  RENDERER_CSP,
  resolveAppPath,
} from "./app-protocol";

const root = resolve("/opt/app/out/renderer");

describe("app:// paths", () => {
  it("maps the entry page and assets below the renderer folder", () => {
    expect(resolveAppPath(root, APP_ENTRY_URL)).toBe(join(root, "index.html"));
    expect(resolveAppPath(root, "app://bundle/")).toBe(
      join(root, "index.html"),
    );
    expect(resolveAppPath(root, "app://bundle/assets/index-1.js?x#y")).toBe(
      join(root, "assets", "index-1.js"),
    );
    expect(resolveAppPath(root, "app://bundle/assets/a%20b.png")).toBe(
      join(root, "assets", "a b.png"),
    );
  });

  it("never leaves the folder and refuses other hosts", () => {
    expect(resolveAppPath(root, "app://other/index.html")).toBeNull();
    expect(resolveAppPath(root, "file:///etc/passwd")).toBeNull();
    expect(resolveAppPath(root, "app://bundle/index.html%00.js")).toBeNull();
    expect(resolveAppPath(root, "app://bundle/%E0%A4%A")).toBeNull();
    for (const url of [
      "app://bundle/../main/index.cjs",
      "app://bundle/%2e%2e/main/index.cjs",
      "app://bundle/assets/%2e%2e%2f%2e%2e%2fmain%2findex.cjs",
      "app://bundle/..%5c..%5cmain%5cindex.cjs",
      "app://other/index.html",
      "file:///opt/app/out/renderer/index.html",
      "app://bundle/%E0%A4%A",
      "app://bundle/index.html%00.js",
      "not a url",
    ]) {
      const path = resolveAppPath(root, url);
      // `..` is folded by the URL parser; what is left stays inside.
      expect(
        path === null || path.startsWith(root + sep),
        `${url} → ${String(path)}`,
      ).toBe(true);
    }
  });

  it("names the types the renderer bundle uses", () => {
    expect(contentTypeFor("index.html")).toMatch(/^text\/html/);
    expect(contentTypeFor("a.JS")).toMatch(/^text\/javascript/);
    expect(contentTypeFor("a.css")).toMatch(/^text\/css/);
    expect(contentTypeFor("a.woff2")).toBe("font/woff2");
    expect(contentTypeFor("a.unknown")).toBe("application/octet-stream");
  });

  it("keeps the header policy in step with the page's meta tag", () => {
    const html = readFileSync(resolve("src/renderer/index.html"), "utf8");
    const meta = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
    const directives = (policy: string): string[] =>
      policy
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .sort();
    // The header adds form-action; everything else is the same.
    expect(directives(RENDERER_CSP)).toEqual(
      directives(`${meta}; form-action 'none'`),
    );
  });
});
