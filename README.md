# CloudLabs Workshop Operations Dashboard

A local dashboard for an instructor running a live Azure workshop with 120 learners, each on their own lab environment. One screen answers four questions: which environments are healthy, who is stuck, what is failing, and what the session has cost so far.

The backend serves a seeded set of 120 environments and keeps moving them through their states while it runs. The frontend polls it every five seconds. Nothing connects to a real Azure subscription.

## What is on the screen

- **Summary panel.** Failed, stuck, active, estimated spend and average completion, plus a small bar showing how the 120 environments split by state.
- **State chips.** Each chip shows a count and filters the table.
- **The table.** Failed environments come first, then stuck ones, then everything else. Each row shows state, learner, lab, step progress out of eight, time on the current step, spend and the last event. Comfortable and compact row heights are both available, and the table scrolls inside its own frame so all 120 rows are reachable.
- **Where the class is.** How many learners are on each of the eight steps, and how many of those are stuck.
- **Inspector.** For the selected row: step history, runtime, plan and hourly rate, spend to date and reprovision count.
- **Reprovision.** A failed environment can be sent back to provisioning. The server changes the state, and the next poll shows it.
- **Filter box.** Type a sentence such as "everyone stuck on step 4 over 20 min" or "failed environments with quota errors" and press Enter. The result appears as removable chips, with a count of matching environments.
- **Keyboard.** `/` focuses the filter box and Esc clears it. `j` and `k` move between rows, Enter opens a row, and `r` reprovisions the selected failed row.

## Requirements

I ran this with Node.js 22.22.0 and npm 10.9.4. `package.json` requires Node.js 22.18 or newer.

## Setup and run

From the repository root, install the locked dependencies:

```sh
npm ci
```

In the first terminal, start the backend:

```sh
npm run dev:api
```

In a second terminal, start the frontend:

```sh
npm run dev:web
```

Open http://127.0.0.1:5173. The backend listens at http://127.0.0.1:3001, and its OpenAPI document is at http://127.0.0.1:3001/api/openapi.json.

If port 3001 or 5173 is already in use, use these PowerShell commands in place of the two start commands. Set the same `API_PORT` in both terminals, and point the backend's allowed origin at the frontend port you pick.

Backend terminal:

```powershell
$env:API_PORT = "3102"
$env:CORS_ORIGINS = "http://127.0.0.1:5174"
npm run dev:api
```

Frontend terminal:

```powershell
$env:API_PORT = "3102"
npm run dev:web -- --port 5174 --strictPort
```

Then open http://127.0.0.1:5174.

## Environment variables

| Variable | Default when unset | What it does |
| --- | --- | --- |
| `API_PORT` | `3001` | Changes the backend listen port. |
| `CORS_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | Allowed browser origins, comma-separated. |

The AI filter has its own settings for the model provider (Gemini or a local Ollama model), the credentials and the timeout. `.env.example` lists every variable name with no values. Set the ones you need in the terminal that runs the backend. With none set, the server makes no model request and the filter uses the rules parser.

## How the server and the screen split the work

The server does the calculating: spend (hourly rate times runtime), stuck detection, filtering, sorting, severity ranking, state transitions, drift and the session totals. The browser sends filter parameters and draws the response. The rules live in `src/server/domain.ts` and have unit tests. `DECISIONS.md` explains why.

## The AI filter

The filter turns a sentence into a structured query. It does not answer questions, and the model never sees environment data. The table always comes from the API.

1. The browser sends the sentence to `POST /api/ai/filter`.
2. The server asks the model (Gemini through its v1beta `generateContent` call, or Ollama through `/api/chat`) to return JSON only. The request includes the schema and the real state, lab and failure-reason values.
3. The server validates the reply against the strict schema in `src/shared/filter-query.ts`. Unknown fields are dropped, numbers are clamped into range, and bad values are rejected.
4. If the model is not configured, errors, times out, or returns invalid output, the server uses the rules parser instead and says why in the response. Repeated failures open a circuit breaker so a dead model does not slow every query. Requests are rate limited per client.

The screen shows "Parsed by model", "Parsed locally", or "Model unavailable, parsed locally". The dashboard never depends on this box. Every filter also works from the chips and the search field.

To measure the parser:

```sh
npm run eval:ai
```

It runs 20 sentences against the rules parser, and against the model too when a key is set. The rules parser scores 20 of 20. I have not run the model eval, because I had no working key.

## Tests

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
node scripts/contrast-ratios.mjs
```

`npm test` runs 98 unit and API tests across 6 files, covering the domain rules, the endpoints, the AI schema, the fallback paths and the circuit breaker. `npm run test:e2e` runs 19 Playwright tests (in `test/e2e/`) covering viewports, selection, filtering, the AI box with the model down, and reprovision.

## Screenshots

```sh
npm run capture:submission
```

This starts a fresh seeded API and frontend on free ports, waits five minutes so failures and stuck learners exist, and writes these files to `screenshots/submission/`:

- `01-dense-all-120.png`: all 120 environments, comfortable density, 1440x900.
- `02-dense-60s-later.png`: the same screen a minute later. Spend has changed.
- `03-compact-density.png`: compact rows.
- `04-wide-1920.png`: the 1920x1080 layout.
- `05-laptop-1280.png`: the 1280x720 layout.
- `06-failed-and-stuck-groups.png`: the Failed and Stuck groups above the other rows.
- `07-inspector-failed-row.png`: a failed row selected, with step history and Reprovision.
- `08-reprovision-before.png`: a failed environment before Reprovision.
- `09-reprovision-after.png`: the same environment in Provisioning after the next refresh.
- `10-filter-chips-failed.png`: the Failed chip selected.
- `11-ai-filter-chips.png`: a sentence in the AI box, shown as chips with a match count, parsed locally after a failed model call.
- `12-ai-model-unavailable.png`: the "Model unavailable, parsed locally" label with an interpreted query that matches nothing.
- `13-ai-no-match.png`: the no-match explanation with example sentences.
- `14-state-loading.png`: the loading skeleton.
- `15-state-empty.png`: the empty-session state.
- `16-state-error.png`: the error banner with the last loaded rows still on screen.
- `17-keyboard-focus.png`: the visible keyboard focus ring on a row.

There is no screenshot of a live model response, because I did not have a working model.

## Reset the seed

Stop the backend with `Ctrl+C` and start it again with `npm run dev:api`. It rebuilds its in-memory seed of 120 environments with fresh timestamps. It does not read or write a database.

## Design intent

I built the screen so the instructor's eye lands on failed and stuck learners first, with a table that stays readable at all 120 rows and quiet everywhere else.

## Other files

- `DECISIONS.md`: the data model, why the logic is on the server, how the AI feature falls back, and what I would do next.
- `AI_LOG.md`: where I used AI tools and where I rejected their output.
- `DESIGN.md`: the design tokens, type roles and layout rules I gave the assistant.
- `docs/reference/`: design references I took ideas from, and an earlier redesign spec.
- `.env.example`: the AI filter's variable names.
- `scripts/`: the screenshot capture, the AI eval and the contrast check.
- `screenshots/submission/`: the screenshots listed above.

## Known limits

- State lives in memory, so a backend restart resets reprovision actions and drift.
- Spend is an estimate at a configured hourly rate per SKU. These are not Azure billing records.
- The API is polled every five seconds. There is no live push.
- I tested the model path with an injected fake model and with an invalid Gemini key. I did not run it against a working model, so its accuracy is unmeasured.
- The last-event text comes from the current state and step, because I do not keep an event log.
- When I last ran `node scripts/contrast-ratios.mjs`, it reported failing pairs: Provisioning blue at 2.86:1 on hover and 2.66:1 on selected rows, and the light Deprovisioned gray at 1.32:1 against white.
