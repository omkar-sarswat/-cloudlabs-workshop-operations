# Dashboard design reference

## Intent

I designed the dashboard for an instructor scanning a live workshop: failed and stuck environments come first, and the remaining rows stay in one scrollable table.

## Layout

I use a 24px viewport margin without a content-width cap. The summary panel, filter row, and table share those edges. The 96px panel has five equal figure cells and one Environments cell. I dock the inspector from 1440px and use a slide-over below that. The table changes to include Running at 1920px. Playwright checks those breakpoints through 3440px.

## Type and color

I use Geist for interface text and Geist Mono for environment IDs. I use Radix gray for the page, panels, borders, hover, selection, and ordinary text. The summary panel and table use white; the page uses gray-2. Failed uses red-9, Provisioning blue-9, Ready green-9, In use gray-9, and Deprovisioned gray-5. The contrast script reads the values from `src/client/tokens.css`.

The latest contrast run measured all checked text pairs at or above 4.5:1. It measured Deprovisioned gray-5 against white at 1.32:1, below the requested 3:1 mark threshold. Provisioning blue-9 measured 2.86:1 on hover gray-3 and 2.66:1 on selected gray-4. I kept the requested token steps and have not treated those checks as passes.

The bar's adjacent-segment luminance ratios were 1.20:1 for Failed/Provisioning, 1.03:1 for Provisioning/Ready, 1.05:1 for Ready/In use, and 2.51:1 for In use/Deprovisioned. The first three pairs are close by this measure, although their hues differ. I record those values rather than claiming they have strong contrast.

## Review

I keep borders for structure and do not use gradients or decorative shadows. The Playwright checks passed the border-plus-shadow and gradient checks at the tested viewport sizes. I captured the current states in `screenshots/submission/`.
