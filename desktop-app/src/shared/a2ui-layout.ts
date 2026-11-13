import {
  A2uiSurfaceSchema,
  surfaceIssues,
  type A2uiComponent,
  type A2uiSurface,
} from "./a2ui";

/**
 * Moving the parts of an AI dashboard by drag and drop. The surface is a tree
 * of Columns (stacked parts) and Rows (cards side by side). A drop never
 * breaks the catalog rules (at most four cards in a Row, no Row inside a Row,
 * nothing inside itself); a drop that would is refused and returns null.
 */

type Layout = Extract<A2uiComponent, { component: "Column" | "Row" }>;

function isLayout(c: A2uiComponent | undefined): c is Layout {
  return c?.component === "Column" || c?.component === "Row";
}

/** Parts that sit in Rows side by side. */
function isCard(c: A2uiComponent | undefined): boolean {
  return (
    c?.component === "KpiCard" ||
    c?.component === "BarChart" ||
    c?.component === "PieChart" ||
    c?.component === "Table"
  );
}

/** Same limits as the schema: a Row holds at most 4, a Column 12. */
const MAX_CHILDREN: Record<Layout["component"], number> = {
  Row: 4,
  Column: 12,
};

function parentOf(components: A2uiComponent[], id: string): Layout | undefined {
  return components.find(
    (c): c is Layout => isLayout(c) && c.children.includes(id),
  );
}

function contains(
  byId: Map<string, A2uiComponent>,
  ancestor: string,
  id: string,
): boolean {
  const c = byId.get(ancestor);
  if (!isLayout(c)) return false;
  return c.children.some((child) => child === id || contains(byId, child, id));
}

/**
 * Whether `card` belongs in `row`: key figures go with key figures, charts
 * and tables with charts and tables, as the dashboards are built.
 */
function fitsRow(
  byId: Map<string, A2uiComponent>,
  card: A2uiComponent,
  row: Layout,
): boolean {
  const others = row.children
    .filter((id) => id !== card.id)
    .map((id) => byId.get(id));
  if (others.some((c) => !isCard(c))) return false;
  const kpi = card.component === "KpiCard";
  return others.every((c) => (c?.component === "KpiCard") === kpi);
}

/**
 * Puts `dragged` at `index` of `parentId` (counted before it is taken out of
 * its old place), optionally wrapped in a new Row of its own. Layouts left
 * empty are removed. Null when the result breaks a rule.
 */
function relocate(
  surface: A2uiSurface,
  dragged: string,
  parentId: string,
  index: number,
  wrap: boolean,
): A2uiSurface | null {
  const from = parentOf(surface.components, dragged);
  if (!from) return null;
  const children = new Map<string, string[]>(
    surface.components.flatMap((c) =>
      isLayout(c) ? [[c.id, [...c.children]]] : [],
    ),
  );
  const source = children.get(from.id)!;
  const destination = children.get(parentId);
  if (!destination) return null;
  const fromIndex = source.indexOf(dragged);
  source.splice(fromIndex, 1);
  // Within one parent the part takes the target's place, as the tiles of
  // the standard dashboard do (`moveDashboardTile`).
  const at = Math.min(index, destination.length);
  const ids = new Set(surface.components.map((c) => c.id));
  let wrapper: Layout | null = null;
  if (wrap) {
    let id = `row_${dragged}`.slice(0, 48);
    for (let n = 2; ids.has(id); n += 1) id = `row${n}_${dragged}`.slice(0, 48);
    wrapper = { id, component: "Row", children: [dragged] };
    destination.splice(at, 0, id);
  } else {
    destination.splice(at, 0, dragged);
  }

  const removed = new Set<string>();
  for (;;) {
    const emptied = [...children].find(
      ([id, list]) => id !== "root" && list.length === 0 && !removed.has(id),
    );
    if (!emptied) break;
    removed.add(emptied[0]);
    for (const list of children.values()) {
      const i = list.indexOf(emptied[0]);
      if (i >= 0) list.splice(i, 1);
    }
  }

  const components = [
    ...surface.components
      .filter((c) => !removed.has(c.id))
      .map((c) => (isLayout(c) ? { ...c, children: children.get(c.id)! } : c)),
    ...(wrapper ? [wrapper] : []),
  ];
  const next = { ...surface, components };
  if (!A2uiSurfaceSchema.safeParse(next).success) return null;
  if (surfaceIssues(components).length > 0) return null;
  return next;
}

/**
 * Drops `dragged` on the part `hovered` (a card, or a row between its
 * cards). Returns the new surface, `surface` itself when nothing moves, or
 * null when the drop is refused:
 *
 * - within its own row, a card takes the place of the card it is dropped on;
 * - a card dropped on a row of its kind (key figures with key figures,
 *   charts and tables with charts and tables) joins that row there, or at
 *   its end when dropped between the cards;
 * - otherwise the part takes the place of the section around `hovered` on
 *   the page, and a card that leaves a row gets a row of its own, so cards
 *   can be gathered into it again.
 */
export function dropComponent(
  surface: A2uiSurface,
  dragged: string,
  hovered: string,
): A2uiSurface | null {
  if (dragged === hovered) return surface;
  if (dragged === "root") return null;
  const byId = new Map(surface.components.map((c) => [c.id, c]));
  const moving = byId.get(dragged);
  const over = byId.get(hovered);
  if (!moving || !over || contains(byId, dragged, hovered)) return null;
  const from = parentOf(surface.components, dragged);
  if (!from) return null;

  const hoveredParent = parentOf(surface.components, hovered);
  const row =
    over.component === "Row"
      ? over
      : hoveredParent?.component === "Row"
        ? hoveredParent
        : undefined;

  if (row && row.id === from.id) {
    if (hovered === row.id) return surface;
    return relocate(
      surface,
      dragged,
      row.id,
      row.children.indexOf(hovered),
      false,
    );
  }
  if (row && isCard(moving) && fitsRow(byId, moving, row)) {
    if (row.children.length >= MAX_CHILDREN.Row) return null;
    const index =
      hovered === row.id ? row.children.length : row.children.indexOf(hovered);
    return relocate(surface, dragged, row.id, index, false);
  }

  // The section around `hovered` on the page: a sibling of `dragged` first,
  // else the part of the nearest column.
  let target: string | undefined;
  for (let id: string | undefined = hovered; id && id !== "root";) {
    const up = parentOf(surface.components, id);
    if (up?.id === from.id) {
      target = id;
      break;
    }
    if (!target && up?.component === "Column") target = id;
    id = up?.id;
  }
  if (!target) return null;
  const column = parentOf(surface.components, target)!;
  if (column.component !== "Column") return null;
  if (column.id !== from.id && column.children.length >= MAX_CHILDREN.Column) {
    return null;
  }
  const wrap = from.component === "Row" && isCard(moving);
  const index = column.children.indexOf(target);
  return (
    relocate(surface, dragged, column.id, index, wrap) ??
    // Without room for one more component, the card stands on its own.
    (wrap ? relocate(surface, dragged, column.id, index, false) : null)
  );
}
