# Decisions

## Data model

Each lab is one `Environment` record (`src/server/model.ts`): learner, lab, SKU and hourly rate, one of five states (`provisioning`, `ready`, `in_use`, `failed`, `deprovisioned`), provisioning, step and end timestamps, the current step out of eight, completed-step history, accrued spend, reprovision count and an error. `toEnvironmentView` derives time on step, spend, completion and a severity rank when the API reads a record.

Stuck means 20 minutes or more on the current step (`stuckThresholdSeconds` in `src/shared/config.ts`). Failed and deprovisioned labs never count. I chose a fixed threshold over "slower than the other learners" because an instructor can predict it and a test can pin it down. It ignores steps that are slow by design, and the server already returns the median time per step for a later fix.

## Why the logic is on the server

Spend math, stuck detection, filtering, sorting, severity ranking, transitions, drift and session totals live in `src/server/domain.ts`. The browser sends filter parameters and draws the response, so the summary panel and the table cannot disagree and no client can compute a different spend. The pure functions have unit tests, and `api.test.ts` covers the endpoints, including a state change that shows up on the next fetch. Reprovision goes through `transitionEnvironment`, so the allowed changes live in one place.

## How the AI feature fails safely

I chose the natural-language filter. A sentence becomes a structured query, never an answer. The model sees only the schema, the real state, lab and failure-reason values, and the sentence. It never sees environment data, so it cannot invent rows or numbers.

`POST /api/ai/filter` (`src/server/api.ts`, adapters in `src/server/ai.ts`) asks Gemini or Ollama for JSON. I validate the reply against a strict shared schema (`src/shared/filter-query.ts`) built from the same constants the API uses. Unknown fields are dropped, numbers are clamped, bad values are rejected, and search text is a plain substring match.

When the model is not configured, errors, times out, or returns invalid output, the server uses a rules parser and returns `source: "rules"` with a reason. Repeated failures open a circuit breaker, so a dead model does not slow every query, and requests are rate limited per client. The screen says "Parsed by model", "Parsed locally" or "Model unavailable, parsed locally", and shows the result as removable chips that share the manual filter state. Nothing waits on the model.

I ran 98 unit and API tests, 19 Playwright tests and a 20-sentence eval (rules parser: 20/20). I tested the model path with an injected fake model, and against Gemini with an invalid key, which fell back as designed. I had no working key or local Ollama model, so the model's own accuracy is unmeasured.

## What I would do next

1. Run the eval against a real model, then tune the prompt from the misses.
2. Persist environment state so a restart keeps reprovision actions.
3. Replace polling with server-sent events.
4. Add authentication before this touches a real workshop.
