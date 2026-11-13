# CloudLabs Operations Console Redesign

## Intent

Turn the workshop console from a generic, colour-heavy dashboard into a calm, table-first operations workspace. Preserve every live workflow and its dense triage capability.

## Goals

- Remove the CSS square preceding the CloudLabs wordmark; do not invent a replacement logo.
- Use a graphite-and-paper system with one restrained selection/action hue.
- Reserve semantic colour for state only, with no glow, gradients, alert fills, decorative icon tiles, or pill-driven chrome.
- Recompose the shell, summary, filters, table, and inspector into a deliberately connected workspace.
- Retain existing application behavior, accessibility, responsive behavior, and test selectors.

## Non-goals

- No server, domain, data, routing, or workflow changes.
- No fabricated logo, imagery, metrics, or copy.
- No test changes that weaken behavior assertions.

## Design

The app keeps a single desktop shell: a type-only wordmark and session controls at the top; an inline operational summary beneath; then a continuous queue workspace with filtering and a table on the left, plus the existing inspector on the right. Hairlines, spacing, and type create grouping rather than rounded surfaces, shadows, colour blocks, or icons.

The palette uses warm paper and graphite neutrals, a muted blue selection/action token, and subdued accessible failure, warning, and healthy tokens. State is communicated by text and a narrow leading rule rather than repeated saturated fills or generic glyphs. The font stack is Aptos/Segoe UI with tabular figures only where data calls for them.

## Files

- Modify `src/client/App.tsx`: retain semantic structure and behavior; remove the generated wordmark and status glyph treatment.
- Modify `src/client/tokens.css`: replace the visual tokens with the restrained operational system and shared scale.
- Modify `src/client/styles.css`: rebuild the app screen composition from tokens, including focus and reduced-motion support.
- Modify `DESIGN.md`: replace the obsolete Cal.com-derived design guidance with this system.
- Modify `test/e2e/dashboard.test.mjs`: add a browser assertion for the type-only wordmark and absence of generated status glyphs.

No files are deleted and no server or test behavior is changed.

## Acceptance criteria

- The CloudLabs wordmark has no CSS square/pseudo-logo.
- Status labels render without `.status-icon` glyphs.
- Existing functional, responsive, keyboard, loading, empty, error, and reprovision flows still pass their tests.
- Type-check, unit tests, browser tests, build, and Hallmark lint pass.
