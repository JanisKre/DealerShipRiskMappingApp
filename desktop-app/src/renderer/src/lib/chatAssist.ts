import type { ChatMessage } from "@shared/types";

/**
 * Pure helpers behind the portfolio chat: location links in answers, local
 * chat commands, the condensed long-term memory and conversation titles.
 * Kept free of React and stores so they are unit-tested on their own.
 */

/** Scheme of the in-app location links the Markdown renderer turns into buttons. */
export const LOCATION_LINK_SCHEME = "drm-location:";

type NamedLocation = { id: string; name: string };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Code spans/blocks and existing Markdown links are never rewritten. */
const PROTECTED = /(```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]*\]\([^)\s]*\))/g;

/**
 * Turns every mention of a portfolio location in an answer into a Markdown
 * link `[Name](drm-location:<id>)`, so the chat can open it. Longest names
 * win ("Autohaus Dresden Reick" before "Autohaus Dresden"); names shorter
 * than four characters are ignored to avoid linking ordinary words.
 */
export function linkifyLocations(
  text: string,
  locations: NamedLocation[],
): string {
  const byName = new Map<string, string>();
  for (const { id, name } of locations) {
    const key = name.trim().toLowerCase();
    if (key.length >= 4 && !byName.has(key)) byName.set(key, id);
  }
  if (byName.size === 0) return text;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${[...byName.keys()]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  return text
    .split(PROTECTED)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(pattern, (match) => {
            const id = byName.get(match.toLowerCase());
            return id ? `[${match}](${LOCATION_LINK_SCHEME}${id})` : match;
          }),
    )
    .join("");
}

/** Undoes {@link linkifyLocations}: "[Name](drm-location:id)" → "Name". */
export function stripLocationLinks(text: string): string {
  return text.replace(
    new RegExp(
      `\\[([^\\]\\n]+)\\]\\(${escapeRegExp(LOCATION_LINK_SCHEME)}[^)\\s]+\\)`,
      "g",
    ),
    "$1",
  );
}

/** A request the chat handles itself, without asking the AI. */
export type ChatAction =
  | { type: "open"; id: string; name: string }
  | { type: "showOnMap"; id: string; name: string }
  | { type: "export"; format: "pdf" | "excel" | "csv" }
  | { type: "layer"; layer: "accumulationClusters" | "hailZones" }
  /** Build a new AI dashboard, or change the one that is shown. */
  | { type: "dashboard"; mode: "create" | "edit"; prompt: string };

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ");
}

/** The location whose name occurs in `text`, longest name first. */
function findLocation(
  text: string,
  locations: NamedLocation[],
): NamedLocation | null {
  const candidates = [...locations]
    .filter((l) => l.name.trim().length >= 4)
    .sort((a, b) => b.name.length - a.name.length);
  return (
    candidates.find((l) => text.includes(l.name.trim().toLowerCase())) ?? null
  );
}

// German, English and French: the offline command chips are translated.
const SHOW = /^(zeig(e)?|show|blende|affiche(r)?|montre(r)?)\b/;
const OPEN = /^(öffne|oeffne|open|ouvre|ouvrir)\b/;
const EXPORT = /^(exportier(e)?|export|erstell(e)?|create|exporte(r)?)\b/;
const ON_MAP = /\b(auf der karte|on the map|in der karte|sur la carte)\b/;
const CLUSTERS = /\b(kumulation(en)?|cluster|accumulations?|cumuls?)\b/;
const HAIL_ZONES = /\b(hagelzonen|hail zones|zones de grêle)\b/;

/** Whole-word match that also works for umlauts (`\b` is ASCII-only). */
function words(pattern: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, "u");
}
const L = "\\p{L}*";
const DASHBOARD_NOUN = words(
  `dashboards?|übersicht|uebersicht|auswertung|cockpit|tableau de bord`,
);
const BUILD_VERB = words(
  `bau(e|t)?|erstell(e|t)?|mach(e|t)?|generier(e|t)?|entwirf|entwerfe|leg(e)?|build|create|make|generate|design|crée|créer|construis`,
);
const EDIT_VERB = words(
  `füg${L}|fueg${L}|ergänz${L}|ergaenz${L}|entfern${L}|lösch${L}|loesch${L}|änder${L}|aender${L}|ersetz${L}|tausch${L}|benenn${L}|sortier${L}|wechsl${L}|wechsel${L}|umstell${L}|stell${L} .* um|filter${L}|beschränk${L}|beschraenk${L}|stattdessen|statt|nur noch|add|remove|delete|replace|change|rename|swap|switch|instead|ajoute${L}|supprime${L}|remplace${L}|modifie${L}|uniquement`,
);
const QUESTION = words(
  `^(wie|was|warum|wieso|kann|können|how|what|why|can|comment|pourquoi)`,
);
const NEW_HINT = words(`neu(e|es|en)?|new|nouveau|nouvelle|weiteres|another`);

/** Whether a message talks about dashboards at all (worth routing). */
export function mentionsDashboard(prompt: string): boolean {
  return DASHBOARD_NOUN.test(normalize(prompt));
}

/**
 * "Bau mir ein Dashboard zu Zone 4+" builds a new AI dashboard; with an AI
 * dashboard on screen, "füge eine Tabelle hinzu" changes it. Questions
 * ("Wie baue ich ein Dashboard?") stay with the AI as normal chat.
 */
export function parseDashboardIntent(
  prompt: string,
  options: { canEdit: boolean },
): { mode: "create" | "edit" } | null {
  const text = normalize(prompt);
  if (!text || QUESTION.test(text) || prompt.trim().endsWith("?")) return null;
  const isNew = NEW_HINT.test(text);
  // With an AI dashboard on screen an imperative change ("wechsle zu Zone 2",
  // "füge eine Tabelle hinzu") is about that dashboard.
  if (options.canEdit && !isNew && EDIT_VERB.test(text))
    return { mode: "edit" };
  if (DASHBOARD_NOUN.test(text) && BUILD_VERB.test(text))
    return { mode: "create" };
  return null;
}

/**
 * Recognises short commands such as "öffne Autohaus Sinemus", "zeige
 * Autohaus Michael auf der Karte", "zeige Kumulationen auf der Karte" or
 * "exportiere den PDF-Bericht". Only imperative sentences starting with the
 * verb count, so questions ("Wo gibt es Kumulationen?") still go to the AI.
 */
export function parseChatAction(
  prompt: string,
  locations: NamedLocation[],
  options: { canEditDashboard?: boolean } = {},
): ChatAction | null {
  const text = normalize(prompt);
  if (!text) return null;

  const dashboard = parseDashboardIntent(prompt, {
    canEdit: options.canEditDashboard ?? false,
  });
  if (dashboard)
    return { type: "dashboard", mode: dashboard.mode, prompt: prompt.trim() };

  if (EXPORT.test(text)) {
    if (/\bpdf\b/.test(text)) return { type: "export", format: "pdf" };
    if (/\b(excel|xlsx)\b/.test(text))
      return { type: "export", format: "excel" };
    if (/\bcsv\b/.test(text)) return { type: "export", format: "csv" };
    return null;
  }

  if (SHOW.test(text)) {
    const location = findLocation(text, locations);
    if (location && ON_MAP.test(text))
      return { type: "showOnMap", id: location.id, name: location.name };
    if (!location && CLUSTERS.test(text))
      return { type: "layer", layer: "accumulationClusters" };
    if (!location && HAIL_ZONES.test(text))
      return { type: "layer", layer: "hailZones" };
    if (location) return { type: "open", id: location.id, name: location.name };
    return null;
  }

  if (OPEN.test(text)) {
    const location = findLocation(text, locations);
    return location
      ? { type: "open", id: location.id, name: location.name }
      : null;
  }
  return null;
}

/** Most messages the chat request may carry (see the IPC schema). */
export const CHAT_REQUEST_MESSAGES = 20;
const MEMORY_LINE_CHARS = 240;
const MEMORY_MAX_CHARS = 4_000;

/**
 * Splits a long conversation into the recent messages sent verbatim and a
 * condensed note of everything older, so earlier turns are not simply
 * forgotten once the request limit is reached. The recent part always starts
 * with a user message; the note keeps the newest older lines within
 * {@link MEMORY_MAX_CHARS}.
 */
export function condenseHistory(
  messages: ChatMessage[],
  keep = CHAT_REQUEST_MESSAGES,
): { recent: ChatMessage[]; note: string | null } {
  const chat = messages.filter((m) => m.role !== "system");
  if (chat.length <= keep) return { recent: chat, note: null };
  let split = chat.length - keep;
  while (split < chat.length && chat[split].role !== "user") split++;
  const older = chat.slice(0, split);
  const lines = older.map((m) => {
    const flat = m.content.replace(/\s+/g, " ").trim();
    const short =
      flat.length > MEMORY_LINE_CHARS
        ? `${flat.slice(0, MEMORY_LINE_CHARS).trimEnd()}…`
        : flat;
    return `${m.role === "user" ? "User" : "Assistant"}: ${short}`;
  });
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (size + lines[i].length + 1 > MEMORY_MAX_CHARS) break;
    kept.unshift(lines[i]);
    size += lines[i].length + 1;
  }
  return {
    recent: chat.slice(split),
    note: kept.length ? kept.join("\n") : null,
  };
}

const GREETINGS = new Set([
  "hallo",
  "hi",
  "hey",
  "moin",
  "servus",
  "hello",
  "test",
  "bonjour",
  "salut",
  "guten morgen",
  "guten tag",
  "guten abend",
]);

/** True for openers like "hallo" that make a useless conversation title. */
export function isGreeting(text: string): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
  return t.length < 3 || GREETINGS.has(t);
}

/**
 * Conversation title: the first user message that is a real question (not a
 * greeting), first line, at most ~40 characters. Falls back to the first
 * user message, or `fallback` when there is none.
 */
export function deriveConversationTitle(
  messages: ChatMessage[],
  fallback: string,
): string {
  const users = messages.filter((m) => m.role === "user");
  const firstLine = (m: ChatMessage): string =>
    m.content.split("\n")[0]?.trim() ?? "";
  const pick = users.find((m) => !isGreeting(firstLine(m))) ?? users[0];
  const line = pick ? firstLine(pick) : "";
  if (!line) return fallback;
  return line.length > 40 ? `${line.slice(0, 40).trimEnd()}…` : line;
}
