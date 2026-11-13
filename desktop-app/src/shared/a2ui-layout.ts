import {
  A2uiSurfaceSchema,
  surfaceIssues,
  type A2uiComponent,
  type A2uiSurface,
} from "./a2ui";

/**
 * Moving the parts of an AI dashboard by drag and drop. The surface is a tree
 * of Columns and Rows; a moved component takes the place of the one it was
 * dropped on, like a tile of the standard dashboard. A move that would break
 * the catalog rules (a full Row, a Row inside a Row, a component inside
 * itself) is refused and returns null.
 */

type Layout = Extract<A2uiComponent, { component: "Column" | "Row" }>;

function isLayout(c: A2uiComponent | undefined): c is Layout {
  return c?.component === "Column" || c?.component === "Row";
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
 * Moves `dragged` to the place of `target`. Within one parent the two swap
 * order as in the standard dashboard (`moveDashboardTile`); into another
 * parent, `dragged` goes in front of `target`. A Row or Column left empty is
 * removed. Returns the new surface, or null when the move is not allowed or
 * changes nothing.
 */
export function moveA2uiComponent(
  surface: A2uiSurface,
  dragged: string,
  target: string,
): A2uiSurface | null {
  if (dragged === target || dragged === "root" || target === "root") {
    return null;
  }
  const byId = new Map(surface.components.map((c) => [c.id, c]));
  const moving = byId.get(dragged);
  if (!moving || !byId.has(target)) return null;
  if (contains(byId, dragged, target)) return null;
  const from = parentOf(surface.components, dragged);
  const to = parentOf(surface.components, target);
  if (!from || !to) return null;
  // Rows hold cards side by side; a layout inside a Row nests grids.
  if (to.component === "Row" && isLayout(moving)) return null;
  if (from.id !== to.id && to.children.length >= MAX_CHILDREN[to.component]) {
    return null;
  }

  const children = new Map<string, string[]>(
    surface.components.flatMap((c) =>
      isLayout(c) ? [[c.id, [...c.children]]] : [],
    ),
  );
  const source = children.get(from.id)!;
  const destination = children.get(to.id)!;
  if (from.id === to.id) {
    const fromIndex = source.indexOf(dragged);
    const toIndex = source.indexOf(target);
    source.splice(fromIndex, 1);
    source.splice(toIndex, 0, dragged);
  } else {
    source.splice(source.indexOf(dragged), 1);
    destination.splice(destination.indexOf(target), 0, dragged);
  }

  // Drop layouts the move left empty, up to (never including) the root.
  const removed = new Set<string>();
  let emptied = [...children].find(
    ([id, list]) => id !== "root" && list.length === 0 && !removed.has(id),
  );
  while (emptied) {
    const [id] = emptied;
    removed.add(id);
    for (const list of children.values()) {
      const index = list.indexOf(id);
      if (index >= 0) list.splice(index, 1);
    }
    emptied = [...children].find(
      ([other, list]) =>
        other !== "root" && list.length === 0 && !removed.has(other),
    );
  }

  const components = surface.components
    .filter((c) => !removed.has(c.id))
    .map((c) => (isLayout(c) ? { ...c, children: children.get(c.id)! } : c));
  const next = { ...surface, components };
  if (!A2uiSurfaceSchema.safeParse(next).success) return null;
  if (surfaceIssues(components).length > 0) return null;
  return next;
}

/**
 * Where a drop on `hovered` lands. Parts swap places with their siblings
 * first, as tiles do: a table dropped on a key figure of the row above takes
 * the place of that row, not a place inside it. Only when no part around
 * `hovered` is a sibling of `dragged` does it go into `hovered`'s row or
 * column.
 */
export function dropTarget(
  surface: A2uiSurface,
  dragged: string,
  hovered: string,
): string {
  const parent = parentOf(surface.components, dragged)?.id;
  let current: string | undefined = hovered;
  while (current && current !== "root") {
    const up = parentOf(surface.components, current)?.id;
    if (up === parent) return current;
    current = up;
  }
  return hovered;
}
