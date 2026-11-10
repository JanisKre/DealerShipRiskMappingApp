/**
 * Shared look of a section's main action in the map layer panel: an outline
 * button that turns primary while its mode is active. Long German labels wrap
 * instead of overflowing the narrow panel.
 */
export const PANEL_ACTION_CLASS =
  "h-auto min-h-8 w-full whitespace-normal py-1.5 text-center leading-tight";

/** Small explanatory line under a panel action (why it is disabled, what to do). */
export const PANEL_HINT_CLASS =
  "mt-1.5 text-[11px] leading-snug text-muted-foreground";

/** One look for every select and input in the map panels. */
export const PANEL_CONTROL_CLASS = "h-8 w-full bg-background px-2.5 text-sm";

/** Field label inside the map panels. */
export const PANEL_LABEL_CLASS = "text-xs";
