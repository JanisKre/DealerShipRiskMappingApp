export type DashboardTileId =
  "summary" | "clusters" | "zones" | "topLocations" | "insights" | "table";

export const DEFAULT_TILE_ORDER: DashboardTileId[] = [
  "summary",
  "clusters",
  "zones",
  "topLocations",
  "insights",
  "table",
];

const WIDE_TILES: ReadonlySet<DashboardTileId> = new Set([
  "summary",
  "clusters",
  "table",
]);

/**
 * Grid classes per visible tile. Wide tiles take a full row; narrow tiles
 * share rows (two per row from @3xl, three from @5xl). The last narrow tile
 * of a run stretches over the free columns of its row, so hiding a tile
 * never leaves a half-empty row behind.
 */
export function tileSpans(
  visible: readonly DashboardTileId[],
): Map<DashboardTileId, string> {
  const spans = new Map<DashboardTileId, string>();
  let run: DashboardTileId[] = [];
  const flush = (): void => {
    run.forEach((id, index) => {
      const last = index === run.length - 1;
      const two =
        last && run.length % 2 === 1 ? "@3xl:col-span-2" : "@3xl:col-span-1";
      const rest = run.length % 3;
      const three = !last
        ? "@5xl:col-span-1"
        : rest === 1
          ? "@5xl:col-span-3"
          : rest === 2
            ? "@5xl:col-span-2"
            : "@5xl:col-span-1";
      spans.set(id, `${two} ${three}`);
    });
    run = [];
  };
  for (const id of visible) {
    if (WIDE_TILES.has(id)) {
      flush();
      spans.set(id, "@3xl:col-span-2 @5xl:col-span-3");
    } else {
      run.push(id);
    }
  }
  flush();
  return spans;
}

export const TILE_DEFINITIONS: Array<{
  id: DashboardTileId;
  labelKey: string;
}> = [
  { id: "summary", labelKey: "dashboard.tiles.summary" },
  { id: "clusters", labelKey: "dashboard.tiles.clusters" },
  { id: "zones", labelKey: "dashboard.tiles.zones" },
  { id: "topLocations", labelKey: "dashboard.tiles.topLocations" },
  { id: "insights", labelKey: "dashboard.tiles.insights" },
  { id: "table", labelKey: "dashboard.tiles.table" },
];

/**
 * Stored tile layout: the visible tiles in order, plus every tile id that
 * existed when it was saved. A tile the user hid is in `known` but not in
 * `order` and stays hidden; only tiles added by a later version (not in
 * `known`) are appended. The old format, a bare array, brought every hidden
 * tile back on the next visit.
 */
type StoredTileLayout = { order: string[]; known: string[] };

export function serializeTileLayout(order: DashboardTileId[]): string {
  const layout: StoredTileLayout = { order, known: DEFAULT_TILE_ORDER };
  return JSON.stringify(layout);
}

export function parseTileLayout(raw: string | null): DashboardTileId[] {
  if (raw == null) return DEFAULT_TILE_ORDER;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return DEFAULT_TILE_ORDER;
  }
  const all = new Set<string>(DEFAULT_TILE_ORDER);
  const isTile = (id: unknown): id is DashboardTileId =>
    typeof id === "string" && all.has(id);
  let order: unknown[];
  let known: Set<unknown>;
  if (Array.isArray(stored)) {
    // Bare array (before hidden tiles were kept): the current tile set.
    order = stored;
    known = all;
  } else if (
    stored != null &&
    typeof stored === "object" &&
    Array.isArray((stored as StoredTileLayout).order)
  ) {
    order = (stored as StoredTileLayout).order;
    const k = (stored as StoredTileLayout).known;
    known = new Set(Array.isArray(k) ? k : DEFAULT_TILE_ORDER);
  } else {
    return DEFAULT_TILE_ORDER;
  }
  const visible = [...new Set(order.filter(isTile))];
  return [
    ...visible,
    ...DEFAULT_TILE_ORDER.filter(
      (id) => !visible.includes(id) && !known.has(id),
    ),
  ];
}

export function moveDashboardTile(
  order: DashboardTileId[],
  dragged: DashboardTileId,
  target: DashboardTileId,
): DashboardTileId[] {
  if (dragged === target) return order;
  const from = order.indexOf(dragged);
  const to = order.indexOf(target);
  if (from < 0 || to < 0) return order;

  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, dragged);
  return next;
}

export type DashboardCommand =
  { action: "show" | "hide"; ids: DashboardTileId[] } | { action: "reset" };

export function applyDashboardCommand(
  order: DashboardTileId[],
  command: DashboardCommand,
): DashboardTileId[] {
  if (command.action === "reset") return DEFAULT_TILE_ORDER;
  if (command.action === "show") {
    return [...order, ...command.ids.filter((id) => !order.includes(id))];
  }
  return order.filter((id) => !command.ids.includes(id));
}

const ALL_WORDS = /\b(all|alle|tous|toutes)\b/i;
const RESET_WORDS =
  /\b(reset|zuruck|zurücksetzen|zurück|réinitialiser|reinitialiser)\b/i;
const SHOW_WORDS =
  /\b(show|add|include|display|zeige|anzeigen|hinzufügen|hinzufugen|einblenden|ajoute|ajouter|affiche|afficher)\b/i;
const HIDE_WORDS =
  /\b(hide|remove|exclude|verstecke|ausblenden|entferne|entfernen|supprimer|masquer)\b/i;
/** German separable verbs: "Blende die Tabelle aus / ein". */
const SPLIT_HIDE = /\bblende\b.*\baus\b/i;
const SPLIT_SHOW = /\bblende\b.*\bein\b/i;

const TILE_ALIASES: Array<{ id: DashboardTileId; words: string[] }> = [
  {
    id: "summary",
    words: ["kpi", "kpis", "summary", "zusammenfassung", "kennzahlen"],
  },
  {
    id: "clusters",
    words: ["cluster", "kumul", "akkumulation", "accumulation", "cumul"],
  },
  {
    id: "zones",
    words: ["zone", "distribution", "verteilung", "repartition"],
  },
  {
    id: "topLocations",
    words: ["top", "ranking", "rangliste", "classement"],
  },
  {
    id: "insights",
    words: [
      "prüfhinweis",
      "pruefhinweis",
      "hinweis",
      "review",
      "anomal",
      "alert",
      "warnung",
      "a verifier",
    ],
  },
  {
    id: "table",
    words: ["table", "tabelle", "tableau", "location list", "standortliste"],
  },
];

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Recognizes explicit layout commands without blocking normal AI questions. */
export function parseDashboardCommand(input: string): DashboardCommand | null {
  if (
    RESET_WORDS.test(input) &&
    /dashboard|layout|kachel|tile|tableau/i.test(input)
  ) {
    return { action: "reset" };
  }
  const action =
    SPLIT_HIDE.test(input) || HIDE_WORDS.test(input)
      ? "hide"
      : SPLIT_SHOW.test(input) || SHOW_WORDS.test(input)
        ? "show"
        : null;
  if (!action) return null;

  const normalized = normalize(input);
  const ids = ALL_WORDS.test(input)
    ? DEFAULT_TILE_ORDER
    : TILE_ALIASES.filter(({ words }) =>
        words.some((word) => normalized.includes(normalize(word))),
      ).map(({ id }) => id);
  return ids.length > 0 ? { action, ids: [...new Set(ids)] } : null;
}
