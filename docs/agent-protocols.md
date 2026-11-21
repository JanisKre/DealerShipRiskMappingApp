# Agent protocols

The app speaks four agent protocols. All of them are optional, switched off
until the user enables them under **Settings → AI**, and none is needed for
any feature of the app.

| Protocol                                | Role of the app                                                               | Where                                                            | Needs an AI provider |
| --------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------- |
| MCP (Model Context Protocol), server    | Other assistants read the portfolio through four read-only tools              | Agent gateway, `/mcp`                                            | No                   |
| MCP, remote control                     | With its own switch: six more tools that operate the app window               | Agent gateway, `/mcp`                                            | No                   |
| MCP Apps (`io.modelcontextprotocol/ui`) | The `portfolio_summary` tool brings its own view, rendered in the host's chat | Agent gateway, resource `ui://dealership-risk/portfolio-summary` | No                   |
| MCP, client                             | The chat may call read-only tools of servers the user connected               | Settings → AI → External MCP servers                             | Yes (the chat)       |
| A2A (Agent2Agent 1.0)                   | Other agents discover the app through an agent card and send it messages      | Agent gateway, `/.well-known/agent-card.json`, `/a2a`            | No                   |
| AG-UI                                   | The portfolio chat as an event stream for a custom front end                  | Agent gateway, `/ag-ui`                                          | Yes                  |

## Agent gateway

One HTTP server in the main process (`src/main/services/agent-gateway/`).

- **Loopback only.** It binds to `127.0.0.1` (default port 47821) and is not
  reachable from the network.
- **Off by default.** Nothing listens until "Enable access" is switched on;
  each protocol has its own switch (MCP on, A2A and AG-UI off).
- **Token.** Every route except the public agent card needs
  `Authorization: Bearer <token>`. The token is created the first time the
  gateway is enabled, stored in the OS keychain (`safeStorage`) and can be
  replaced in the settings.
- **Browser protection.** A web page can make a browser send requests to a
  local port. The gateway therefore rejects requests whose `Host` is not this
  computer and port (DNS rebinding) and requests with a non-local `Origin`,
  and sends CORS headers to local origins only (`checkGatewayRequest` in
  `src/shared/agent-gateway.ts`, tested in `gateway.test.ts`).
- **Read-only unless control is allowed.** No route writes data itself;
  request bodies are JSON, capped at 1 MB. With "Allow operating the app"
  switched on (off by default) the MCP server can ask the window to open a
  portfolio, show a location, change the page or start and stop an
  analysis (see Remote control).

### What is passed on

Location name, postcode and town, insured/prospect status, hail zone and its
source, vehicle count and its source, hail EAL, exposure, boundary source,
confidence and review status, image date, analysis date, the provenance of
each input (source, method, confidence, fallback, limitations) and the
weakest assumptions.

Never passed on: underwriting notes, change history, street addresses,
coordinates, lot geometry.

Every result carries the method and limitations of the screening model, and
a location without a vehicle count has `hailEalEur: null`, not `0`. A tool
that reads this data may send it to its own AI model; that is outside the
app's control and stated in the settings.

### MCP server

Streamable HTTP, stateless: one JSON response per `POST /mcp`, no
server-initiated stream. Two eras of the protocol are served on the same
route:

- **Revision `2026-07-28`** (no handshake). A request that names its
  protocol version in `params._meta` is answered by these rules:
  `server/discover` describes the server, every result carries
  `resultType`, list results carry `ttlMs` and `cacheScope`, an unknown
  method is `404`, an unsupported version `400` with the supported ones. A
  header (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`) that contradicts
  the body is refused with `400`; a missing one is accepted, because the
  server listens on this computer only and nothing in between routes on
  headers.
- **Earlier revisions** (`2025-11-25`, `2025-06-18`, `2025-03-26`,
  `2024-11-05`) start with `initialize` and are served as before.

The tool list and `server/discover` are marked as not cacheable (`ttlMs` 0):
switching remote control on or off changes them and the server sends no
notification.

| Tool                | Returns                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `list_portfolios`   | Saved portfolios; saved comparison states are marked                                                                |
| `portfolio_summary` | Totals, hail zone distribution, ten highest-EAL locations, limitations                                              |
| `list_locations`    | Locations with filters (`minHailZone`, `reviewOnly`), sorting and paging                                            |
| `get_location`      | EAL inputs, provenance, boundary quality, weakest assumptions, limitations; the location by id or by its exact name |

Connect Claude Code (the settings card copies this command with the token):

```bash
claude mcp add --transport http dealership-risk http://127.0.0.1:47821/mcp --header "Authorization: Bearer <token>"
```

The settings card ("Connect to Claude") offers three texts to copy, each
with the token filled in (hidden on screen): a prompt to paste into Claude
Code, which then runs the command itself and shows a first summary; the
command above; and an entry for Claude Desktop's configuration file. Claude
Desktop only starts local programs (stdio), so that entry runs the
`mcp-remote` bridge through `npx` (needs Node.js) pointed at the same URL,
with the header passed in an environment variable. The Claude Desktop entry
has not been tested against Claude Desktop.

### Remote control

Off by default; switched on with "Allow operating the app" in the same
card (needs the MCP server). The server then lists six more tools and
tells the host in its `instructions` to call `get_app_state` first:

| Tool             | Does                                                                                                        | Annotation              |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------- |
| `get_app_state`  | Page, open portfolio (id, name, locations, saved), selected location, analysis progress                     | read-only               |
| `open_portfolio` | Opens a saved portfolio; the open one is saved first. Refused while an analysis runs                        | changes the window      |
| `show_location`  | Selects a location (id or exact name) on the map; with `details`, opens its detail dialog                   | changes the window      |
| `open_view`      | Shows `map`, `dashboard`, `parameters` or `settings`                                                        | changes the window      |
| `start_analysis` | Analyses named locations, or `scope` `unanalysed` (default) or `all`; returns at once, or as a task (below) | destructive, open world |
| `stop_analysis`  | Stops the running analysis after the locations in progress                                                  | changes the window      |

How it works: the main process validates the arguments, sends a command
(`agent:command`) to the window and waits up to 15 s for the answer
(`agent:commandResult`), which it validates again before passing it on
(`src/shared/agent-control.ts`, `agent-gateway/app-control.ts`). The window
runs the command with the same store actions as its buttons
(`renderer/src/lib/agentControl.ts`) and shows a notice for every action.
Commands carry ids and fixed values only: no file paths, URLs or text that
ends up in the data. The state passed on contains no notes, addresses or
coordinates. `start_analysis` is marked destructive because analysing a
location again replaces its automatic boundary, count and estimate;
boundaries and counts the user corrected or confirmed are kept, as with the
button.

The read tools read saved portfolios; the window saves a few seconds after
a change (`saved` in `get_app_state`).

#### The analysis as a task

An analysis takes from seconds to minutes per location. A host that speaks
revision `2026-07-28` and declares the tasks extension
(`io.modelcontextprotocol/tasks`) on its request gets a task from
`start_analysis` instead of the immediate result:

| Call           | Answer                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/call`   | `resultType: "task"` with `taskId`, `status: "working"`, `ttlMs` (12 h) and `pollIntervalMs` (5 s)                                              |
| `tasks/get`    | The task with its progress in `statusMessage` ("Analysing: 12 of 40 locations done."); once the run has ended, `completed` with the tool result |
| `tasks/cancel` | Stops the run after the locations in progress, like `stop_analysis`; the task then ends as `cancelled`. What was analysed so far is kept        |
| `tasks/update` | Acknowledged; the analysis never asks the host for input                                                                                        |

Every other host (an earlier revision, or no declared extension) gets the
immediate result and polls `get_app_state`, as before. A start the window
refuses (an analysis already runs, nothing to analyse) is an ordinary tool
error, never a task. The server advertises the extension in
`server/discover` only while remote control is on.

A task holds no work of its own. The analysis runs in the window; the task
remembers the portfolio and the run it was created for
(`analysis.startedAt` in the app state) and asks the window whenever the
host polls (`agent-gateway/mcp-tasks.ts`). Consequences:

- A task only ever stops its own run. If that run has ended and another
  one was started in the app, `tasks/cancel` stops nothing.
- If the app has moved on when the host polls (another portfolio, a newer
  run), the task ends as `completed` and says that the final counts are no
  longer on screen; the results are in `list_locations`.
- `completed` means the run has ended, not that every location succeeded:
  the result carries the counts (`analysis.done`, `total`, `failed`), and
  the message says when the run was stopped in the app.
- While the window does not answer, the task stays as it was.
- Tasks are kept in memory: at most 32, for 12 hours, until the app quits.
  An unknown or expired id is answered with "task not found" (`-32602`).
- The server sends no task notifications; hosts poll.

### MCP App

`portfolio_summary` declares `_meta.ui.resourceUri`. A host that supports
MCP Apps reads the resource (`text/html;profile=mcp-app`) and renders it in
a sandboxed frame; the view receives the tool result over `postMessage`
(`ui/initialize`, `ui/notifications/tool-result`). The HTML is one
self-contained file without external resources or network access and writes
data with `textContent` only.

### A2A

Agent2Agent 1.0, JSON-RPC binding. `SendMessage` returns a completed task
with a text part and a data part; `GetTask` returns a finished task. There
is no streaming and no push notification. Clients must send
`A2A-Version: 1.0`.

The agent is deterministic: a data part `{"skill": "…"}` names one of
`portfolio-summary`, `top-locations` and `location-evidence`; plain text is
matched by keywords and location names and falls back to the summary. No
language model is involved.

### AG-UI

`POST /ag-ui` takes a `RunAgentInput` and streams `RUN_STARTED`,
`STATE_SNAPSHOT` (the portfolio summary), `TEXT_MESSAGE_*` and
`RUN_FINISHED` or `RUN_ERROR` as server-sent events. Only the user and
assistant turns are taken from the client; the system prompt is the app's
own portfolio chat prompt. `forwardedProps.portfolioId` picks a portfolio.
The run uses the AI provider configured in the app and is recorded in the AI
record book as `gateway:ag-ui`.

## External MCP servers (client)

- Streamable HTTP only: HTTPS, or HTTP on this computer. The app starts no
  local programs.
- A bearer token per server is stored in the OS keychain.
- Before a chat answer, the planner may pick at most two tools. Only tools
  the server annotates `readOnlyHint: true` are offered and called; the
  check is repeated in the main process before every call.
- The arguments of a call (taken from the user's question) go to that
  server. Its answer is untrusted text: it is passed to the chat model
  fenced as data and labelled as an external source.

## Limitations

- Claude Code reports the server as failed ("connection refused") while the
  app is closed or "Enable access" is off; it connects again after a
  restart of the session once the app runs.
- Remote control acts on the window the user is looking at. It does not
  import files, edit boundaries, change settings or delete anything.
- The protocol implementations are hand-written against the specifications
  and covered by unit tests; they have not been tested against every host.
  MCP Apps and A2A 1.0 are recent; host support varies. MCP revision
  `2026-07-28` and the tasks extension are checked against the
  specification text and with requests written for the tests, not yet
  against a host that uses them.
- The A2A agent understands three skills, not free-form questions.
- The gateway exposes saved portfolios. Changes that are not saved yet are
  not visible to other tools.
