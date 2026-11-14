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

| Feature                        | Without AI                                                                                                                                                                                | Optional AI layer                                                                                                                                                                                                           | Sent to the provider                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Review queue                   | Open review points by hail EAL; fixed recommended action per reason (correct boundary, re-analyse on newer imagery, read underwriting notices) with its button in the review strip        | "AI order" (`llm:reviewPlan`) reorders the queue and adds a short note per location                                                                                                                                         | Opaque id, reasons, hail zone, EAL rank, image age, boundary source and confidence, vehicle source. No names, addresses, notes or amounts |
| Change report (dashboard tile) | On request: newer imagery sharp enough for vehicle counting (0.25 m or finer, captured after the counted image), radar hail cells within 1 km after the analysis date, open review points | "Summarise" (`llm:stream`, `explain`/`changes`)                                                                                                                                                                             | The computed report lines (location names, dates, counts)                                                                                 |
| Chat                           | Detail dialog shows evidence, sources and limitations                                                                                                                                     | Before an answer about a named or the selected location, `llm:chatTools` picks up to five read-only lookups (evidence, DWD station hail history, radar hail, imagery); the app runs them and passes the results to the chat | Location ids and names for the planner; the lookup results (no notes, no street address) for the answer                                   |
| Import                         | Columns the parser does not recognise can be assigned by hand to an unfilled field; the file is parsed again                                                                              | "AI suggestion" (`llm:columnMapping`) prefills the assignment                                                                                                                                                               | Column names and local type hints only (text, number, amount, latitude, longitude, postcode, URL, yes/no). Never a cell value             |
| Scenario                       | Draw a corridor on the map                                                                                                                                                                | One sentence → `llm:scenarioDraft` extracts places, width and intensity; the app geocodes and shows the draft before applying it                                                                                            | The sentence                                                                                                                              |
| Questions for the dealership   | Fixed questions picked by rules (always; estimated stock; hail zone 4+; boundary to check; old image), copied as text                                                                     | "Write as a message" rewords the same questions in the same order                                                                                                                                                           | Dealership name and the question text                                                                                                     |
| Portfolio comparison           | Location-by-location diff incl. added and removed locations (`shared/portfolio-diff.ts`)                                                                                                  | "Explain the changes"                                                                                                                                                                                                       | Totals and the 15 largest changes (names, vehicles, EAL, zone)                                                                            |

## Limitations

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

## Implementation

- Agents: `src/main/services/llm-agents.service.ts` (tests:
  `llm-agents.service.test.ts`).
- Pure rules: `src/shared/{review-plan,change-report,import-fields,chat-tools,scenario-draft,dealer-questionnaire,portfolio-diff}.ts`,
  each with a test file.
- Renderer: `components/ai/AiExplanation.tsx` (shared explanation block),
  `dashboard/ChangeReportPanel.tsx`, `dashboard/QuestionnaireSection.tsx`,
  `upload/ColumnAssignment.tsx`, `map/ScenarioFromSentence.tsx`,
  `lib/chatLookups.ts`.
