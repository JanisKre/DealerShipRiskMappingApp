import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import de from "./de.json";
import en from "./en.json";
import fr from "./fr.json";

/**
 * Guards the translations: German and English carry the same keys, French
 * only keys that exist in English (it falls back to English), placeholders
 * match across languages, plurals are complete, and every literal key the
 * renderer passes to `t()` exists — so a missing key never shows up as raw
 * text like "dashboard.detailDialog.report" in the app.
 */

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string): string => key.replace(PLURAL, "");
const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{\{\s*([\w.]+)/g)].map((m) => m[1]).sort();

const locales = {
  de: flatten(de as Tree),
  en: flatten(en as Tree),
  fr: flatten(fr as Tree),
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(dir, f));
}

describe("translations", () => {
  it("German and English have the same keys", () => {
    const deKeys = [...locales.de.keys()].sort();
    const enKeys = [...locales.en.keys()].sort();
    expect(deKeys.filter((k) => !locales.en.has(k))).toEqual([]);
    expect(enKeys.filter((k) => !locales.de.has(k))).toEqual([]);
  });

  it("French has no keys that English lacks", () => {
    expect([...locales.fr.keys()].filter((k) => !locales.en.has(k))).toEqual(
      [],
    );
  });

  it("uses the same placeholders in every language", () => {
    const mismatches: string[] = [];
    for (const [lang, entries] of Object.entries(locales)) {
      if (lang === "de") continue;
      for (const [key, text] of entries) {
        const reference = locales.de.get(key);
        if (reference == null) continue;
        if (placeholders(reference).join() !== placeholders(text).join())
          mismatches.push(`${lang}:${key}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("has an _other form for every _one form", () => {
    const missing: string[] = [];
    for (const [lang, entries] of Object.entries(locales)) {
      for (const key of entries.keys()) {
        if (key.endsWith("_one") && !entries.has(`${base(key)}_other`))
          missing.push(`${lang}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("contains every literal key the renderer translates", () => {
    const known = new Set([...locales.de.keys()].map(base));
    const unknown = new Set<string>();
    const root = resolve(__dirname, "..");
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) {
        if (!known.has(match[1]))
          unknown.add(`${match[1]} (${file.slice(root.length + 1)})`);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it("has no empty translations", () => {
    const empty: string[] = [];
    for (const [lang, entries] of Object.entries(locales)) {
      for (const [key, text] of entries)
        if (!text.trim()) empty.push(`${lang}:${key}`);
    }
    expect(empty).toEqual([]);
  });
});
