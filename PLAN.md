# Build plan

1. Define the environment model, deterministic seed, state transitions, spend math, filtering, sorting, session totals, risk rules, and drift. Write behavior tests first.
2. Add the REST API with validated input and output, problem-details errors, OpenAPI JSON, and endpoint tests.
3. Add the server-side drift loop and verify the dashboard data changes over time.
4. Build the dense React table, session summary, state filters, sort controls, and learner detail panel against the API.
5. Add the reprovision action and the loading, empty, error, and dense states. Keep polling from changing scroll position or selection.
6. Add the optional at-risk ranking. Validate model output and fall back to deterministic rules when no key, network, or valid response is available.
7. Review the rendered app with Playwright, check keyboard access and reduced motion, then produce screenshots and a 60–90 second recording script.
8. Finish README.md, DECISIONS.md, and AI_LOG.md; compare the running app against the PDF and record any gaps.

## Test seams

- Pure domain functions: seed shape, state transitions, spend, summary, filter/sort, risk ranking, and drift.
- HTTP boundary: every route, validation failures, not-found behavior, transition conflicts, and model-off fallback.
- Browser: dense view, detail/reprovision flow, filters, polling, loading, empty, and error states.
