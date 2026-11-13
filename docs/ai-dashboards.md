# AI dashboards (A2UI)

In the portfolio chat, a request such as “Baue mir ein Dashboard zu allen
Standorten ab Zone 4” builds a dashboard; with an AI dashboard on screen,
“Wechsle zu Hagelzone 2” or “Füge eine Tabelle der Top 10 nach Exposure
hinzu” changes it. Dashboards are saved and shown as tabs next to the
standard overview (“+ Neues Dashboard” opens the assistant with a sentence
to complete); they apply to whichever portfolio is open.

## Recognising requests

Clear wording is recognised locally: a build verb with “Dashboard/Übersicht”
creates one; on the dashboard page, with an AI dashboard open, an imperative
change (“wechsle”, “ändere”, “füge … hinzu”, “zeig stattdessen”, …) edits it.
When the wording is not clear and a dashboard is open (or the message is
about dashboards), one short AI call routes it: new dashboard, change, or
ordinary question. The ordinary chat is told it cannot change anything in the
app and must never claim it did.

## Protocol

The model answers with one [A2UI](https://a2ui.org) v1.0 message:
`createSurface` for a new dashboard or `updateComponents` for a change (with
two app extensions: `deleteIds` and `title`). Components are a flat list with
one `root`, children referenced by id.

The catalog (`src/shared/a2ui.ts`, id
`https://dealership-risk-mapping.app/a2ui/catalogs/dashboard/v1`) is locked to
`Column`, `Row`, `Heading`, `Text`, `KpiCard`, `BarChart`, `PieChart` and
`Table`. Data is attached only through four catalog functions — `aggregate`,
`ranking`, `breakdown`, `locations` — with a measure (count, hail EAL,
exposure, vehicles), an optional grouping (hail zone, business type, sales
partner, sub-portfolio, group) and an optional, strictly validated filter.

The app does not use the `@a2ui/react` package yet (pre-1.0, requires Zod 3);
it renders the catalog with its own components. Stored dashboards are A2UI
surfaces, so a later switch keeps them valid.

## Safety and provenance

- **No figures from the model.** The renderer evaluates the functions on the
  portfolio (`src/shared/a2ui-data.ts`); titles and texts that contain amounts
  or percentages are rejected.
- **Validated in the main process.** Every answer is checked with Zod and the
  tree rules (one root, known children, no cycles, at most 40 components,
  depth 5). Issues go back to the model once for a repair; otherwise the
  request fails with a message in the chat. No HTML, scripts or external
  resources can be expressed.
- **What the model sees:** the request, the catalog, the number of locations,
  the distinct sales partners, sub-portfolios and groups, and — for a change —
  the current dashboard structure. No location values, notes or addresses.
- **Selection on every card.** Each card names the filter it shows and the
  number of locations it covers; the page states that values are screening
  estimates computed by the app (hail EAL with placeholder values).
- **Without an AI provider** a request creates a deterministic starter
  template, which can be adapted once a provider is set up.

Tests: `a2ui.test.ts`, `a2ui-data.test.ts`, `llm.service.test.ts`
(generation and repair loop), `chatAssist.test.ts` (intent) and
`e2e/ai-dashboard.spec.ts` (chat → dashboard → change, with a local mock
model).
