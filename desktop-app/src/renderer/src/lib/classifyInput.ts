/**
 * Heuristic detection of whether a free-text input is an **address** (→ add
 * location) or a **question for the AI** (→ chat). Deliberately rule-based
 * and without network/LLM: runs synchronously on every keystroke.
 *
 * Base rule: when signals are missing, it guesses `'address'`, because the
 * places search also resolves plain place names ("Cologne"), whereas chat
 * expects a deliberate phrasing.
 */
export type InputKind = "address" | "question";

/** Question words at the start of a sentence (interrogatives + commands), de + en. */
const QUESTION_STARTERS = [
  "wie",
  "was",
  "welche",
  "welcher",
  "welches",
  "wo",
  "woran",
  "warum",
  "wieso",
  "weshalb",
  "wann",
  "wer",
  "zeige",
  "zeig",
  "liste",
  "finde",
  "gib",
  "nenne",
  "vergleiche",
  "how",
  "what",
  "which",
  "show",
  "list",
  "find",
  "compare",
  "where",
  "why",
  "when",
  "who",
];

/** Domain terms that clearly indicate a portfolio question. */
const DOMAIN_TERMS = [
  "risiko",
  "risk",
  "hagel",
  "hail",
  "auslastung",
  "eal",
  "pml",
  "portfolio",
  "kumul",
  "exposure",
  "standorte",
];

/** Street suffixes (also as part of a compound word, e.g. a name ending in "strasse"). */
const STREET_SUFFIX =
  /(stra(ss|ß)e|str\.|weg|platz|allee|gasse|ring|damm|ufer|chaussee)\b/i;
/** Five-digit German postal code. */
const POSTAL_CODE = /\b\d{5}\b/;
/** House-number pattern: a word followed by a number (optionally with a letter). */
const HOUSE_NUMBER = /\p{L}+\s+\d+[a-z]?\b/iu;

/**
 * Classifies `text`. Empty input counts as `'address'` (neutral default, so
 * address autocomplete stays the default path).
 */
export function classifyInput(text: string): InputKind {
  const trimmed = text.trim();
  if (!trimmed) return "address";

  const lower = trimmed.toLowerCase();

  // Strong question signals always win.
  if (trimmed.endsWith("?")) return "question";

  const firstWord = lower.split(/\s+/)[0].replace(/[^\p{L}]/gu, "");
  if (QUESTION_STARTERS.includes(firstWord)) return "question";

  if (DOMAIN_TERMS.some((term) => new RegExp(`\\b${term}`, "i").test(lower)))
    return "question";

  // Address signals.
  if (
    STREET_SUFFIX.test(trimmed) ||
    POSTAL_CODE.test(trimmed) ||
    HOUSE_NUMBER.test(trimmed)
  ) {
    return "address";
  }

  // Ambiguous → address (see base rule above).
  return "address";
}
