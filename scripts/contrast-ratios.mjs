import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/client/tokens.css", import.meta.url), "utf8");
const tokens = Object.fromEntries([...source.matchAll(/^\s*(--[\w-]+):\s*(#[\da-fA-F]{6});/gm)].map(([, key, value]) => [key, value.toUpperCase()]));
function get(name) {
  if (!tokens[name]) throw new Error(`Missing color token ${name}`);
  return tokens[name];
}
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((pair) => Number.parseInt(pair, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function ratio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const surfaces = [
  ["page", "--color-page"], ["panel and rows", "--color-panel"],
  ["hover row", "--color-hover"], ["selected row", "--color-selected"],
  ["bar track", "--color-bar-track"],
];
const marks = [
  ["failed red", "--color-failed"], ["stuck amber", "--color-stuck"],
  ["healthy green", "--color-healthy"], ["provisioning mark", "--color-provisioning"],
];
const textPairs = [
  ...surfaces.flatMap(([surface, background]) => [
    [`Ink on ${surface}`, "--color-text", background],
    [`Secondary text on ${surface}`, "--color-secondary", background],
  ]),
  ["White action label on ink action", "--color-white", "--color-text"],
];
const shapePairs = [
  ...surfaces.slice(0, 4).flatMap(([surface, background]) => [
    ...marks.map(([name, foreground]) => [`${name} on ${surface}`, foreground, background]),
    [`Focus ring on ${surface}`, "--color-text", background],
  ]),
  ["Bar fill on bar track", "--color-bar-fill", "--color-bar-track"],
  ["Failed segment on bar track", "--color-failed", "--color-bar-track"],
  ["Amber segment on bar track", "--color-stuck", "--color-bar-track"],
  ["Healthy segment on bar track", "--color-healthy", "--color-bar-track"],
  ["Ready segment on white page", "--color-ready-segment", "--color-panel"],
  ["In-use segment on white page", "--color-in-use-segment", "--color-panel"],
  ["Deprovisioned segment on white page", "--color-neutral-segment", "--color-panel"],
];
const acceptedContrastExceptions = new Set([
  "Ready segment on white page",
  "Deprovisioned segment on white page",
]);
const adjacentSegments = [
  ["Failed / Provisioning", "--color-failed", "--color-provisioning"],
  ["Provisioning / Ready", "--color-provisioning", "--color-ready-segment"],
  ["Ready / In use", "--color-ready-segment", "--color-in-use-segment"],
  ["In use / Deprovisioned", "--color-in-use-segment", "--color-neutral-segment"],
];
const checks = [
  ...textPairs.map(([label, foreground, background]) => ({ label, ratio: ratio(get(foreground), get(background)), minimum: 4.5 })),
  ...shapePairs.map(([label, foreground, background]) => ({ label, ratio: ratio(get(foreground), get(background)), minimum: 3 })),
];
console.log("Contrast check (WCAG relative luminance; palette read from tokens.css)");
console.log("Foreground / background".padEnd(46), "Ratio".padStart(7), "Min".padStart(6));
for (const check of checks) {
  const passes = check.ratio >= check.minimum;
  const accepted = acceptedContrastExceptions.has(check.label);
  const status = passes ? "PASS" : accepted ? "WARN" : "FAIL";
  console.log(`${status} ${check.label}`.padEnd(46), `${check.ratio.toFixed(2)}:1`.padStart(7), `${check.minimum.toFixed(1)}:1`.padStart(6));
  if (accepted && !passes) console.log("  Accepted: the requested Radix step takes priority for this aria-hidden segment.");
}
console.log("\nAdjacent composition segment contrast");
for (const [label, first, second] of adjacentSegments) {
  console.log(`${label.padEnd(30)} ${ratio(get(first), get(second)).toFixed(2)}:1`);
}
if (checks.some((check) => check.ratio < check.minimum && !acceptedContrastExceptions.has(check.label))) process.exitCode = 1;
