# Accessibility

Target: **WCAG 2.2 level AA**, the web baseline of EN 301 549 V4.1.1 (the
European ICT accessibility standard, which also covers desktop software).
This page records what is in place, how it is checked, and what is still open.
It is not a conformance report (ACR/VPAT); one needs a manual audit first.

## In place

- Built on Radix UI primitives: dialogs, menus, tabs, selects, switches and
  checkboxes have keyboard support, focus management and ARIA roles.
- Every icon-only button has an accessible name; visible text is part of the
  name where both exist (WCAG 2.5.3).
- Visible focus rings (`focus-visible`) on all interactive elements.
- `<html lang>` follows the interface language (de/en/fr), so screen readers
  pick the right pronunciation.
- Dashboard tiles and the parts of an AI dashboard can be moved one place
  earlier or later with buttons (keyboard or a single click), next to drag
  and drop (WCAG 2.1.1, 2.5.7).
- **Windows contrast themes** (forced colours): the open tab, the chosen
  toggle and the current page in the sidebar use the system highlight
  colour; map markers and legend swatches keep their colours, because the
  colour is the information there.
- **Reduce motion** (OS setting) ends CSS animations and transitions at once
  and turns off Leaflet's zoom, fade and marker animations (WCAG 2.3.3).
- Live regions: analysis progress, the resume notice and update status are
  `role="status"`; failed analyses, a failed save, AI errors and invalid
  inputs (vehicle count, website, scenario sentence) are `role="alert"`
  (WCAG 4.1.3). The chat is a `role="log"` that announces an answer once it
  is complete (`aria-busy` while tokens stream in).
- Charts use Recharts' accessibility layer (keyboard focus and arrow keys
  between data points).
- Text colours meet 4.5:1 in light and dark themes (`--muted-foreground` was
  darkened for this; success texts use `emerald-700` in the light theme).

## How it is checked

- **Lint:** `eslint-plugin-jsx-a11y` (recommended rules) on every renderer
  component, part of `npm run lint`. Deliberate exceptions are documented in
  `desktop-app/eslint.config.js`.
- **End-to-end:** `desktop-app/e2e/accessibility.spec.ts` runs axe-core
  against every page and settings tab in the light and the dark theme, tagged
  WCAG 2.0/2.1/2.2 A and AA, and fails on any serious or critical violation.
  `desktop-app/e2e/populated.spec.ts` does the same on the pages with an
  analysed portfolio (map with markers, dashboard with tiles, charts and
  table, every tab of the detail dialog) and walks the main flows with the
  keyboard: opening and paging the detail dialog, its tabs, moving a tile.
  Both run in CI and before every release.
- **One exception in the axe run:** overlapping map markers can leave less
  than 24 px of free target area. WCAG 2.5.8 exempts a target whose function
  another control on the page offers; every location is also in the list
  next to the map (`desktop-app/e2e/axe.ts`).

Automated tools find roughly a third to a half of all WCAG issues. They do
not judge keyboard flows, reading order or whether names make sense.

## Reviewed in November 2026

- **Pages with data** went through axe for the first time. Found and fixed:
  the dashboard tabs pointed at a panel that did not exist
  (`aria-controls`), the "critical" badge had 2.9:1 in the dark theme, the
  "n active" badge of the layer panel 4.1:1, Leaflet's attribution link
  differed from its text by colour only, and the key figures of the hail
  history put a button directly into a description list.
- **200 % zoom** (1280 × 800 window, so 640 × 400 CSS px): no page and not
  the detail dialog scrolls sideways or places a control outside the
  window; the sidebar folds into its button. The 10–11 px badges are then
  20–22 px. Checked by measuring the layout, not by reading every text.
- **Forced colours** were checked in Chromium's emulation, not on Windows
  itself.

## Known gaps

- **Map:** markers are reachable with the keyboard, but drawing or correcting
  a lot boundary needs a pointer. The locations list next to the map offers
  the same selection and details without the map.
- **Screen readers:** no structured test with NVDA, JAWS or VoiceOver yet.
- **Windows contrast themes** have not been tried on a Windows machine with
  the real themes.

A manual audit against EN 301 549 (screen reader, keyboard-only walk-through
of every flow, contrast themes on Windows) is the next step before an
Accessibility Conformance Report can be published.
