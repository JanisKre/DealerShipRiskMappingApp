export type DashboardTileId =
  | "summary"
  | "risk"
  | "pml"
  | "insights"
  | "coverage"
  | "seasonal"
  | "clusters"
  | "table";

export const DEFAULT_TILE_ORDER: DashboardTileId[] = [
  "summary",
  "risk",
  "pml",
  "insights",
  "coverage",
  "seasonal",
  "clusters",
  "table",
];

export const TILE_DEFINITIONS: Array<{
  id: DashboardTileId;
  labelKey: string;
}> = [
  { id: "summary", labelKey: "dashboard.tiles.summary" },
  { id: "risk", labelKey: "dashboard.tiles.risk" },
  { id: "pml", labelKey: "dashboard.tiles.pml" },
  { id: "insights", labelKey: "dashboard.tiles.insights" },
  { id: "coverage", labelKey: "dashboard.tiles.coverage" },
  { id: "seasonal", labelKey: "dashboard.tiles.seasonal" },
  { id: "clusters", labelKey: "dashboard.tiles.clusters" },
  { id: "table", labelKey: "dashboard.tiles.table" },
];

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
  | { action: "show" | "hide"; ids: DashboardTileId[] }
  | { action: "reset" };

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

const TILE_ALIASES: Array<{ id: DashboardTileId; words: string[] }> = [
  {
    id: "summary",
    words: ["kpi", "kpis", "summary", "zusammenfassung", "kennzahlen"],
  },
  {
    id: "risk",
    words: [
      "risk",
      "risiko",
      "risks",
      "risiken",
      "distribution",
      "verteilung",
      "repartition",
    ],
  },
  {
    id: "pml",
    words: ["pml", "maximum loss", "höchstschaden", "hochstschaden"],
  },
  {
    id: "insights",
    words: ["anomal", "alert", "warnung", "outlier", "ausreißer", "ausreisser"],
  },
  {
    id: "coverage",
    words: [
      "coverage",
      "abdeckung",
      "concentration",
      "konzentration",
      "peril",
      "gefahr",
    ],
  },
  {
    id: "seasonal",
    words: ["season", "saison", "seasonal", "saisonal", "saisonnier"],
  },
  { id: "clusters", words: ["cluster", "akkumulation", "accumulation"] },
  {
    id: "table",
    words: ["table", "tabelle", "locations", "standorte", "sites"],
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
  const action = SHOW_WORDS.test(input)
    ? "show"
    : HIDE_WORDS.test(input)
      ? "hide"
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
