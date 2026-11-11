import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown";

const html = (text: string): string =>
  renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown", () => {
  it("renders bold inside a sentence (chat answer from the screenshot)", () => {
    expect(
      html("Die Skala umfasst **6 Hagelzonen** (1 = geringste)."),
    ).toContain(
      '<p>Die Skala umfasst <strong class="font-semibold">6 Hagelzonen</strong> (1 = geringste).</p>',
    );
  });

  it("renders italic, strikethrough and inline code", () => {
    const out = html("*kursiv*, _auch_, ~~alt~~ und `code`");
    expect(out).toContain("<em>kursiv</em>");
    expect(out).toContain("<em>auch</em>");
    expect(out).toContain("<s>alt</s>");
    expect(out).toMatch(/<code[^>]*>code<\/code>/);
  });

  it("nests italic in bold and leaves snake_case alone", () => {
    expect(html("**sehr *wichtig***")).toContain(
      '<strong class="font-semibold">sehr <em>wichtig</em></strong>',
    );
    expect(html("field max_tokens_value")).toContain("max_tokens_value");
    expect(html("field max_tokens_value")).not.toContain("<em>");
  });

  it("keeps a multiplication sign or lone asterisk as text", () => {
    expect(html("2 * 3 = 6")).toBe(
      '<div class="space-y-2 text-sm leading-relaxed"><p>2 * 3 = 6</p></div>',
    );
  });

  it("renders bullet and numbered lists, nested by indentation", () => {
    const out = html("1. Erster\n2. Zweiter\n   - Unterpunkt\n3. Dritter");
    expect(out).toMatch(
      /<ol start="1"[^>]*><li>Erster<\/li><li>Zweiter<ul[^>]*><li>Unterpunkt<\/li><\/ul><\/li><li>Dritter<\/li><\/ol>/,
    );
  });

  it("formats inside list items", () => {
    expect(html("- **Zone 2**: drei Standorte")).toContain(
      '<li><strong class="font-semibold">Zone 2</strong>: drei Standorte</li>',
    );
  });

  it("renders headings, quotes, rules and code blocks", () => {
    const out = html("### Titel\n> Hinweis\n\n---\n```\nconst a = 1;\n```");
    expect(out).toMatch(/<h4[^>]*>Titel<\/h4>/);
    expect(out).toMatch(/<blockquote[^>]*>Hinweis<\/blockquote>/);
    expect(out).toContain("<hr");
    expect(out).toMatch(/<pre[^>]*><code>const a = 1;<\/code><\/pre>/);
  });

  it("renders GFM tables", () => {
    const out = html("| Standort | EAL |\n|---|---:|\n| **A** | 1.200 € |");
    expect(out).toMatch(/<th[^>]*>Standort<\/th>/);
    expect(out).toMatch(/<td[^>]*><strong[^>]*>A<\/strong><\/td>/);
  });

  it("joins wrapped lines of a paragraph with a line break", () => {
    expect(html("Zeile eins\nZeile zwei")).toContain(
      "<p>Zeile eins<br/>Zeile zwei</p>",
    );
  });

  it("shows a link as its text with the URL as tooltip, never as an anchor", () => {
    const out = html("[GDV](https://www.gdv.de)");
    expect(out).not.toContain("<a");
    expect(out).toContain('title="https://www.gdv.de"');
  });

  it("escapes HTML in model output", () => {
    const out = html('<img src=x onerror="alert(1)"> **fett**');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("copes with unfinished markup while streaming", () => {
    expect(html("Die **Zone")).toContain("<p>Die **Zone</p>");
    expect(html("```\nhalb")).toMatch(/<pre[^>]*><code>halb<\/code><\/pre>/);
  });
});
