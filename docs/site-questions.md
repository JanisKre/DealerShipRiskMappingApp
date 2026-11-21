# Site questions

A fixed checklist per location, in the detail dialog (tab "Gelände",
"Standort-Fragen"). It works without AI: the underwriter answers, or enters
what the dealer stated. An image model may answer the same questions on the
aerial image; a decision model also returns a probability per answer.

The answers are observations next to the result. **They change neither the
vehicle count, the boundary nor the hail EAL**: the model counts every
vehicle on the lot as exposed (`risk-model.md`), and only the underwriter
decides otherwise. A reduction for confirmed hail protection would be a
separate change to the risk model with its own methodology note.

## Questions

| Id                  | Question                                                         | Answers                        |
| ------------------- | ---------------------------------------------------------------- | ------------------------------ |
| `hailNet`           | Are hail nets stretched over parking areas?                      | yes, no, unclear               |
| `canopy`            | Are vehicles parked under carports or canopies?                  | yes, no, unclear               |
| `parkingStructure`  | Is there a parking deck or multi-storey car park on the lot?     | yes, no, unclear               |
| `openAirShare`      | How many vehicles stand in the open?                             | few, about half, most, unclear |
| `boundaryFits`      | Does the lot boundary fit the operating area?                    | yes, no, unclear               |
| `construction`      | Is there construction on the lot?                                | yes, no, unclear               |
| `dealershipVisible` | Does the aerial image show a dealership or vehicle storage site? | yes, no, unclear               |

A model is also asked first whether the image can be judged at all
(clouds, snow, shadow, blur). If not, every answer of that run is
"unclear". `boundaryFits` is asked only when the boundary is drawn on the
image. The wording sent to the models is in `MODEL_INSTRUCTIONS`
(`src/shared/site-questions.ts`).

## Which answer is shown

Every answer keeps its source, time and, for a model, the engine, model,
image date and image source. Per question the app keeps one answer of the
underwriter, one of the dealer and one per engine; a new one replaces the
old one in its slot. Shown is the underwriter's answer, else the dealer's,
else the newest model answer. The others are listed underneath.

"Hail protection" in the filter and the export sums up the three protection
questions: **seen** if any is yes, **not seen** if all three are no,
**not answered** if none is answered, else **unclear**.

## Engines

Settings → AI → "Standort-Fragen". "Automatic" follows the AI provider: with
OpenAI it uses the OpenAI Decisions API, with Claude or a custom URL the AI
model, with a local runtime a local decision model in Ollama if one is
chosen, else the local AI model.

| Engine               | Endpoint                                                 | Probabilities | Image leaves the computer     |
| -------------------- | -------------------------------------------------------- | ------------- | ----------------------------- |
| OpenAI Decisions     | `POST https://api.openai.com/v1/decisions`, `gpt-6-luna` | yes           | yes                           |
| Gemini Decisions     | `POST …/v1beta/decisions`, `gemini-decision-1`           | yes           | yes                           |
| SystemOne / Jev      | `POST <server>/v1/systemone` (TypeSafe Jev by default)   | yes           | only for a server elsewhere   |
| Open model in Ollama | `POST http://localhost:11434/v1/systemone`               | yes           | no                            |
| AI model (fallback)  | the configured chat model, as JSON                       | no            | as with the other AI features |

- **Anthropic** has no decision endpoint on the pages read (November 2026).
  With Claude the fallback answers in words, without probabilities.
- **Open source.** The settings offer three open-weight decision models that
  read images, downloaded into a local Ollama: Liquid AI `d1:2b` (about
  2 GB, LFM Open License v1.0), Cloudflare `clef-flash` (9B, Apache 2.0) and
  `clef` (27B, Apache 2.0). Only these names can be pulled from the app; any
  other installed decision model can be entered by name. Self-hosted
  servers in the SystemOne format (SGLang with Clef, `laya-serve`) are set
  as a SystemOne server on `localhost`.
- **Keys.** OpenAI uses the key of the AI settings. Google and SystemOne
  keys are stored in the OS keychain. The environment (`GEMINI_API_KEY`,
  `GOOGLE_API_KEY`, `TYPESAFE_AI_API_KEY`) is read only for the vendor's own
  endpoint; a local server never receives a cloud key.
- **Addresses.** A SystemOne server must use HTTPS or run on this computer;
  Ollama must run on this computer. Both are checked when saved and before
  every request.
- Every request is filed in the AI record book as `decisions:<engine>`.

The request formats follow each vendor's documentation as read in November
2026 (`src/main/services/decision.service.ts`). They are covered by tests
against recorded shapes, **not yet checked against the live services**.

## Probabilities and thresholds

A decision endpoint scores the options; the app stores the probabilities as
returned. Neither OpenAI nor Google publishes calibration figures, and both
advise setting thresholds on one's own labelled examples. The app does that:

- **Until something is measured**, a yes/no probability counts as "yes" from
  0.8 and as "no" up to 0.2; between the two it is "unclear". The
  probability itself is not shown.
- **"Comparison with your answers"** in the settings compares each engine's
  probabilities with the answers of the underwriter (or else the dealer) on
  the same questions in the open portfolio: number of comparisons, Brier
  score, share right and share "unclear" with the default thresholds.
- From **20 comparisons with at least 5 yes and 5 no**, it suggests the
  lowest "yes" threshold above which at least 90 % of the answers are yes,
  and the highest "no" threshold below it under which at least 90 % are no.
  A suggestion is used only after "Adopt thresholds"; from then on the
  probability is shown next to the answer.
- `openAirShare` has no threshold: the most likely level is shown when it
  has at least 0.6, else "unclear".

Thresholds measured on one portfolio may not hold for another (other
regions, other image sources). They are stored per engine and model, with
the number of comparisons and the date.

## Where the answers are used

- **Dashboard filter "Hail protection"** (seen, not seen, unclear, not
  answered).
- **Portfolio run**: dashboard menu → "Check site questions for all" asks
  the engine about every analysed location it has not answered yet, highest
  hail EAL first, up to 200 per run, stoppable between locations.
- **Export**: CSV and Excel carry the shown answer per question, hail
  protection in one word and who gave the answers.
- **Dealer questions**: protection seen only by a model, a boundary answered
  as not fitting, and reported construction each select a question.
- **MCP** `get_location` includes the answered questions with their source.
- The existing aerial image check also files its findings as answers of the
  AI model.

## Limitations

- Image models miss hail nets, mistake roofs for canopies and misjudge a
  boundary. An answer is only as current as the image it was given; the
  image date is stored with it.
- The probabilities of a decision model are the vendor's scores, not
  measured frequencies, until thresholds are adopted from your own answers.
- The comparison uses the open portfolio only. A person's answer is taken as
  right; a wrong label makes the suggestion wrong too.
- The open models are listed with their size and licence as Ollama and
  Hugging Face state them; check the licence before commercial use.
