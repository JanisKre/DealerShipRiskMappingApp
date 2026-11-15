# Optional AI features

The app works completely without AI. Every feature below is first a fixed,
rule-based function that is always available; an AI provider (Anthropic,
OpenAI, a custom URL or a local runtime) only adds a layer on top that
**explains, orders or proposes**. Without a configured provider the AI
buttons are not shown and nothing is sent anywhere.

Rules every AI layer follows:

- **No figures from the model.** Amounts, EALs, counts and dates are computed
  by the app. Explanations receive them as fenced facts and may only quote
  them; notes with amounts or percentages are discarded.
- **Only actions the app already has.** The AI picks among existing controls
  (re-analyse, correct a boundary, apply a column assignment, apply a
  scenario). Anything with an effect waits for the user's click.
- **Validated answers.** Structured answers are parsed with Zod in the main
  process, unknown ids, tools and fields are dropped, and a broken answer is
  sent back once for a correction (`completeJson` in
  `src/main/services/llm-agents.service.ts`). If it still fails, the fixed
  result stays.
- **Data minimisation.** Underwriting notes never leave the app. What each
  feature sends is listed below and in `PRIVACY.md`.
- **No native tool calling needed.** Planning is a JSON answer, so the
  features also work with local models.

| Feature                        | Without AI                                                                                                                                                                                                                                                     | Optional AI layer                                                                                                                                                                                                           | Sent to the provider                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Review queue                   | Open review points by hail EAL; fixed recommended action per reason (correct boundary, re-analyse on newer imagery, read underwriting notices) with its button in the review strip                                                                             | "AI order" (`llm:reviewPlan`) reorders the queue and adds a short note per location                                                                                                                                         | Opaque id, reasons, hail zone, EAL rank, image age, boundary source and confidence, vehicle source. No names, addresses, notes or amounts |
| Change report (dashboard tile) | On request: newer imagery sharp enough for vehicle counting (0.25 m or finer, captured after the counted image), radar hail cells within 1 km after the analysis date, open review points                                                                      | "Summarise" (`llm:stream`, `explain`/`changes`)                                                                                                                                                                             | The computed report lines (location names, dates, counts)                                                                                 |
| Chat                           | Detail dialog shows evidence, sources and limitations                                                                                                                                                                                                          | Before an answer about a named or the selected location, `llm:chatTools` picks up to five read-only lookups (evidence, DWD station hail history, radar hail, imagery); the app runs them and passes the results to the chat | Location ids and names for the planner; the lookup results (no notes, no street address) for the answer                                   |
| Import                         | Columns the parser does not recognise can be assigned by hand to an unfilled field; the file is parsed again                                                                                                                                                   | "AI suggestion" (`llm:columnMapping`) prefills the assignment                                                                                                                                                               | Column names and local type hints only (text, number, amount, latitude, longitude, postcode, URL, yes/no). Never a cell value             |
| Scenario                       | Draw a corridor on the map                                                                                                                                                                                                                                     | One sentence → `llm:scenarioDraft` extracts places, width and intensity; the app geocodes and shows the draft before applying it                                                                                            | The sentence                                                                                                                              |
| Questions for the dealership   | Fixed questions picked by rules (always; estimated stock; hail zone 4+; boundary to check; old image), copied as text                                                                                                                                          | "Write as a message" rewords the same questions in the same order                                                                                                                                                           | Dealership name and the question text                                                                                                     |
| Portfolio comparison           | Location-by-location diff incl. added and removed locations (`shared/portfolio-diff.ts`)                                                                                                                                                                       | "Explain the changes"                                                                                                                                                                                                       | Totals and the 15 largest changes (names, vehicles, EAL, zone)                                                                            |
| Weakest assumptions            | "Schwächste Annahmen" in the detail dialog: fixed rules rank where the result is most likely wrong (no count, fallback boundary, old image, untypical stock, estimated zone, placeholder parameters) and in which direction (`shared/assumption-challenge.ts`) | "Write the counter-argument" (`llm:stream`, `explain`/`challenge`) words the same points                                                                                                                                    | Location name and the listed weak points. No amounts                                                                                      |
| Memo with checked figures      | The EAL derivation, sources and limitations in the detail dialog                                                                                                                                                                                               | `llm:evidenceMemo` writes a note; every number in it is checked against the app's facts and sentences with any other number are removed before display (`shared/evidence-memo.ts`, `shared/number-check.ts`)                | Location name, the numbered facts (vehicles, zone, EAL, exposure, boundary source, dates) and the weak points. No notes                   |
| Aerial image check             | Vehicle count, boundary and imagery details in the detail dialog; the dealer question on hail protection                                                                                                                                                       | `llm:siteCheck` (vision model): hail nets, canopies, parking structure, share in the open; optionally on up to four archived images for "since when"                                                                        | The aerial image of the lot with the boundary drawn on it. No name, no address                                                            |
| Boundary second opinion        | Boundary review flags and manual correction on the map                                                                                                                                                                                                         | `llm:boundaryOpinion` (vision model): plausible, too large, too small, wrong place                                                                                                                                          | The aerial image with the boundary drawn on it                                                                                            |
| Dealership reply               | The underwriter reads the reply and writes notes                                                                                                                                                                                                               | `llm:questionnaireAnswers` assigns passages to the questions; only answers whose quote is literally in the reply are shown (`shared/questionnaire-answers.ts`)                                                              | The questions asked and the pasted reply                                                                                                  |
| Event watch                    | Locations a real hail event reached, as a list to copy (`shared/event-notice.ts`)                                                                                                                                                                              | "Draft a message to the dealerships" (`llm:stream`, `explain`/`eventNotice`)                                                                                                                                                | Event name, location names, dates, hail class, distance. No amounts                                                                       |
| External lookups in the chat   | —                                                                                                                                                                                                                                                              | With a connected MCP server, `mcp:chatLookup` picks up to two read-only tools                                                                                                                                               | The question and the tool descriptions to the AI provider; the tool arguments to that server                                              |

## AI record book

Every request to an AI provider is written to a local table (`ai_log`): time,
the feature that asked, provider, model, destination host, whether the
destination is this computer, duration, status, and the request and answer
text (each cut at 20 000 characters; images are counted, never stored). The
last 500 entries are kept. **Settings → AI → AI record book** lists them,
exports them as JSON and clears them; the record can be switched off. The
diagnostics report does not contain it.

## Agent protocols

MCP (server, client and an MCP App), A2A and AG-UI are described in
[agent-protocols.md](./agent-protocols.md).

## Limitations

- A vision model can miss hail nets, mistake roofs for canopies and misjudge
  a boundary. The aerial image check and the boundary opinion are
  observations with their image date and model; they change neither the
  vehicle count nor the boundary nor the hail EAL, which counts every
  vehicle on the lot as exposed (`risk-model.md`).
- The figure check proves that a memo quotes only figures the app computed.
  It does not prove that the sentence around a figure is right.
- An answer taken from a dealership's reply is backed by a literal quote; the
  one-sentence summary next to it is the model's and should be read against
  the quote.

- Explanations and notes are language output, not analysis. They can be
  wrong or incomplete even when every figure they quote is right; the table
  or list above them is the result.
- The change report's radar part covers only days on which the app ran (the
  local KONRAD3D archive); a newer image changes the vehicle count only after
  a re-analysis.
- The review order is a suggestion for the sequence of work. It does not
  change which locations need a review.
- A drafted scenario uses the first geocoder hit per place; check the
  corridor on the map before relying on its impact figures, which remain
  screening estimates.

## Testing against a real model

`e2e/ai-live.spec.ts` runs the memo, the dealership reply, the
counter-argument, the image checks and the record book in the built app
against a real model. It is skipped unless `DRM_E2E_LLM_BASE_URL` (an
OpenAI-compatible endpoint on this computer, e.g. Ollama) and
`DRM_E2E_LLM_MODEL` are set; `DRM_E2E_LLM_VISION=1` adds the image checks.
`e2e/agent-gateway.spec.ts` always runs and speaks MCP, A2A and AG-UI to the
running app over HTTP; with `DRM_E2E_CLAUDE_HOST=1` it also connects the
`claude` CLI as an MCP host.

## Implementation

- Agents: `src/main/services/llm-agents.service.ts` (tests:
  `llm-agents.service.test.ts`, `ai-layer.test.ts`), vision in
  `site-check.service.ts`, record book in `ai-log.service.ts`.
- Pure rules: `src/shared/{review-plan,change-report,import-fields,chat-tools,scenario-draft,dealer-questionnaire,portfolio-diff,assumption-challenge,evidence-memo,number-check,site-check,questionnaire-answers,event-notice}.ts`,
  each covered by tests.
- Renderer: `components/ai/AiExplanation.tsx` (shared explanation block),
  `dashboard/ChangeReportPanel.tsx`, `dashboard/QuestionnaireSection.tsx`,
  `upload/ColumnAssignment.tsx`, `map/ScenarioFromSentence.tsx`,
  `lib/chatLookups.ts`, `dashboard/AiInsightSections.tsx`,
  `map/EventNotice.tsx`, `settings/AiIntegrationsCards.tsx`.
