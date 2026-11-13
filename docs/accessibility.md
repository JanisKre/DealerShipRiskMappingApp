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
- **Reduce motion** (OS setting) ends CSS animations and transitions at once
  and turns off Leaflet's zoom, fade and marker animations (WCAG 2.3.3).
- Live regions: analysis progress and update status are `role="status"`; the
  chat is a `role="log"` that announces an answer once it is complete
  (`aria-busy` while tokens stream in).
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
  It runs in CI and before every release.

Automated tools find roughly a third to a half of all WCAG issues. They do
not judge keyboard flows, reading order or whether names make sense.

## Known gaps

- **Map:** markers are reachable with the keyboard, but drawing or correcting
  a lot boundary needs a pointer. The locations list next to the map offers
  the same selection and details without the map.
- **Dashboard tiles** and the parts of AI dashboards are reordered by drag
  and drop only; the tile menu can show and hide tiles but not move them, and
  an AI dashboard can also be rearranged by asking the chat.
- **Small text:** several badges and hints use 10–11 px text. Contrast is
  sufficient, but readability at 200 % zoom has not been reviewed.
- **Screen readers:** no structured test with NVDA, JAWS or VoiceOver yet.
- The empty-state pages are tested; pages with an imported portfolio
  (tables, detail dialog, charts with data) are covered by lint only.

A manual audit against EN 301 549 (keyboard-only walk-through, screen reader,
200 % zoom, Windows high-contrast mode) is the next step before an
Accessibility Conformance Report can be published.
