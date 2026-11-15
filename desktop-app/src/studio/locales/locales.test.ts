import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { initialLanguage } from "../i18n";
import de from "./de.json";
import en from "./en.json";
import fr from "./fr.json";

/**
 * Guards the studio's translations (mirrors the renderer's locales test):
 * German, English and French carry exactly the same keys, no text is empty,
 * placeholders and plurals match, every literal key the studio translates
 * exists, and every code, stage and job title training/studio.py sends has
 * a translation.
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
const tags = (text: string): string[] =>
  [...text.matchAll(/<\/?(\w+)>/g)].map((m) => m[0]).sort();

const locales = {
  de: flatten(de as Tree),
  en: flatten(en as Tree),
  fr: flatten(fr as Tree),
};

const STUDIO = resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(dir, f));
}

/** The keys of a `NAME = { "key": ... }` dict in training/studio.py. */
function studioPyKeys(name: string): string[] {
  const py = readFileSync(
    resolve(__dirname, "../../../../training/studio.py"),
    "utf8",
  );
  const block = py.match(
    new RegExp(`^${name} = \\{\\n([\\s\\S]*?)\\n\\}`, "m"),
  );
  if (!block) throw new Error(`${name} not found in studio.py`);
  return [...block[1].matchAll(/^\s+"([a-z_]+)":/gm)].map((m) => m[1]);
}

describe("studio translations", () => {
  it.each(["en", "fr"] as const)("%s has exactly the German keys", (lang) => {
    const other = locales[lang];
    expect([...locales.de.keys()].filter((k) => !other.has(k))).toEqual([]);
    expect([...other.keys()].filter((k) => !locales.de.has(k))).toEqual([]);
  });

  it("has no empty translations", () => {
    const empty: string[] = [];
    for (const [lang, entries] of Object.entries(locales))
      for (const [key, text] of entries)
        if (!text.trim()) empty.push(`${lang}:${key}`);
    expect(empty).toEqual([]);
  });

  it("uses the same placeholders and markup in every language", () => {
    const mismatches: string[] = [];
    for (const [lang, entries] of Object.entries(locales)) {
      if (lang === "de") continue;
      for (const [key, text] of entries) {
        const reference = locales.de.get(key) ?? "";
        if (
          placeholders(reference).join() !== placeholders(text).join() ||
          tags(reference).join() !== tags(text).join()
        )
          mismatches.push(`${lang}:${key}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("has no '(e)'/'(s)' plural shortcuts and an _other for every _one", () => {
    const bad: string[] = [];
    for (const [lang, entries] of Object.entries(locales)) {
      for (const [key, text] of entries) {
        if (/\p{L}\((e|n|en|s|es|x)\)/u.test(text)) bad.push(`${lang}:${key}`);
        if (key.endsWith("_one") && !entries.has(`${base(key)}_other`))
          bad.push(`${lang}:${key} (no _other)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("contains every literal key the studio translates", () => {
    const known = new Set([...locales.de.keys()].map(base));
    const unknown = new Set<string>();
    for (const file of sourceFiles(STUDIO)) {
      const text = readFileSync(file, "utf8");
      const keys = [
        ...text.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g),
        ...text.matchAll(/i18nKey="([A-Za-z0-9_.]+)"/g),
      ];
      for (const match of keys)
        if (!known.has(match[1]))
          unknown.add(`${match[1]} (${file.slice(STUDIO.length + 1)})`);
    }
    expect([...unknown]).toEqual([]);
  });

  it.each([
    ["MESSAGES", "server"],
    ["STAGES", "jobs.stage"],
    ["TITLES", "jobs.title"],
  ])("translates every key of studio.py %s", (dict, prefix) => {
    const keys = studioPyKeys(dict);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !locales.de.has(`${prefix}.${k}`))).toEqual([]);
  });
});

describe("initialLanguage", () => {
  it("prefers the remembered choice, then the browser, then German", () => {
    expect(initialLanguage("fr", ["en-US"])).toBe("fr");
    expect(initialLanguage(null, ["en-GB", "de"])).toBe("en");
    expect(initialLanguage("xx", ["fr-CA"])).toBe("fr");
    expect(initialLanguage(null, ["es-ES", "it"])).toBe("de");
    expect(initialLanguage(null, [])).toBe("de");
  });
});
