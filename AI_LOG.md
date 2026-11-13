# AI log

## Tools I used

- **GitHub Copilot in VS Code (agent mode).** Most of the repo work ran here: it edited code, ran commands and tests, and took screenshots with Playwright.
- **Codex (OpenAI).** I used it early on. It edited `DESIGN.md`, `tokens.css` and the contrast script, then its Windows command sandbox failed with "setup refresh had errors", so it could not run commands or tests. I moved the rest of the work to Copilot.
- **Claude, in a chat window outside the repo.** I used it to turn the assignment PDF into prompts for the coding assistants, to read my screenshots and tell me what looked wrong, to research table density, status color and what makes a screen look generated, to audit the assistants' reports, and to rewrite these three notes.
- **Agent skills.** In the Copilot session the assistant read Taste Skill (`design-taste-frontend`) and `make-interfaces-feel-better`, which I installed with `npx skills add`. It also read three Bencium skills (controlled UX designer, impact designer and code conventions). In Codex's config I enabled Superpowers, Karpathy guidelines, Matt Pocock's skills, Trail of Bits differential-review, Taste Skill and Impeccable. Codex's sandbox failed early, so I cannot say how much those influenced the work.
- **Radix Colors**, installed with npm, for the color tokens, so each color has a fixed job (background, border, text) instead of a hex value picked by eye.

## How I worked

I did not ask for the whole screen at once. I had the assistant write `DESIGN.md` first (tokens, type roles, a layout sketch), build from `tokens.css`, and take screenshots at several widths after each change. I looked at the screenshots myself and sent back specific fixes, usually a list of what overlapped, looked cramped or looked wrong. The backend came first, with tests, and the screen went on top of it.

## Where the assistant did the work

- The environment model, server calculations, drift behavior and API tests in `src/server/` and `src/shared/`.
- The React dashboard, table, inspector, design tokens and responsive styles in `src/client/`.
- The AI filter: the shared query schema and rules parser, the Gemini and Ollama adapters with timeout, circuit breaker and rate limit, the API route, the browser behavior (Enter to parse, chips, source labels, match count) and its tests.
- The Vitest and Playwright checks, the eval script and the screenshot capture script.
- First drafts of the README and decision notes.

## Where I rejected its output

1. **The first screen looked like a default admin template.** Rows were tall, the detail panel sat empty until I clicked a row, progress showed as thin bars with percentages, states were in a dropdown, and the at-risk list was five cramped columns. I had each one removed or replaced.
2. **Tinted row groups and muddy colors.** A pink block over failed rows, a beige block over stuck rows, brown text for "stuck" and a colored stripe down the side. I replaced them with white rows, small shape markers with text labels, and plain group headers.
3. **Step column overlap.** The progress ticks collided with the "n/8" text, and the learner name touched the ID. I sent both back until nothing overlapped.
4. **Data that looked fake.** Twenty-two of about sixty active learners were stuck, many showed the same time on step, and the session drained until Ready and Provisioning sat at zero. I asked for rarer stuck cases with spread-out durations, and a round 3 review led to staggered drift transitions.
5. **Wrong values on some rows.** Provisioning rows showed step progress like 7/8, and failed rows showed a running timer. I changed them to a dash and to "failed at step N".
6. **Mistakes that came from my own instructions.** I told Codex to cap the page width, which left wide empty bands on large monitors, so I removed the cap and aligned everything to 24px margins. I also asked for Plan and Started columns that added noise, and for a state bar that stretched across the whole panel. I removed the columns and put SKU and rate in the inspector. Running now shows only at 1920px and wider.
7. **Summary layouts.** I rejected several: figures clustered on the left, figures spread too far apart, and five gray boxes, which is the stat-card look the assignment warns against. I settled on a six-cell panel with five aligned figures and the Environments bar in the last cell.
8. **The first AI filter was only a rules parser.** It had no model behind it, which does not meet the assignment. I first believed the model filter was finished. An audit then found that `/api/ai/filter` called the model and rebuilt its answer from the rules parser anyway, so the model could never change the table. Codex fixed that and added a regression test that fails if the bug returns. I also sent back its reports twice, because they listed files without test counts or results, and I made it name the proof for each step.
9. **Smaller problems from screenshot reviews:** clipped Provisioning text, ellipsized lab text, a sub-hour time without padding, a missing separator before the stuck duration, and a queue that did not fit at 1280x720. I changed the column sizing, text rules, formatter and spacing.
10. **Row selection** was hard to see and felt delayed. I moved the click target to the whole row and added a check that selection updates without waiting for a transition.

## What I checked myself

- `npm run typecheck` passed. `npm test` passed: 98 tests in 6 files. `npm run test:e2e` passed: 19 tests.
- `npm run eval:ai`: the rules parser scored 20 of 20 on 20 sentences, and I did not change the expected answers. The model eval did not run, because no key was configured.
- With no provider set, the endpoint returned `source: "rules"` with the reason "not configured", and the screen showed "Parsed locally".
- With a deliberately invalid Gemini key, a direct request to Gemini returned HTTP 400. The endpoint returned `source: "rules"` with the reason "unavailable", and the screen showed "Model unavailable, parsed locally".
- The other failure cases (timeout, invalid JSON, wrong types, an unreachable provider, a call that never returns, and the circuit breaker opening and closing) are covered by tests with an injected fake client.
- `node scripts/contrast-ratios.mjs`, when I last ran it, exited with failures: Provisioning measured 2.86:1 on hover and 2.66:1 on selected rows, and the Deprovisioned gray (step 5) measured 1.32:1 against white.

## What I did not do

I never ran the filter against a working model. I had no Gemini key and no local Ollama model, so the model's accuracy is unmeasured and its success path is tested only with a fake client. An earlier version of the repo had a screen recording and a script for it. I removed both and rely on screenshots, which the assignment accepts. Codex wrote most of the code, and I reviewed its behavior through the running screen, the tests and the screenshots, not by reading every line.
