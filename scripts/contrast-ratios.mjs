const colors = {
  page: "#F6F5F2",
  panel: "#FFFFFF",
  hover: "#F0EFEB",
  selected: "#E8E6DF",
  text: "#16181D",
  secondary: "#5B616B",
  accent: "#254D46",
  white: "#FFFFFF",
  failed: "#A82E25",
  stuck: "#775000",
  healthy: "#356448",
  provisioning: "#4C657B",
  deprovisioned: "#62666A",
};

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => Number.parseInt(part, 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const textPairs = [
  ["Text on page", colors.text, colors.page],
  ["Text on panel", colors.text, colors.panel],
  ["Text on hover", colors.text, colors.hover],
  ["Text on selected", colors.text, colors.selected],
  ["Secondary on page", colors.secondary, colors.page],
  ["Secondary on panel", colors.secondary, colors.panel],
  ["Secondary on hover", colors.secondary, colors.hover],
  ["Secondary on selected", colors.secondary, colors.selected],
  ...["failed", "stuck", "healthy", "provisioning", "deprovisioned"].map((status) => [
    `White label on ${status}`,
    colors.white,
    colors[status],
  ]),
  ["White action text on accent", colors.white, colors.accent],
];

const nonTextPairs = [
  ...["failed", "stuck", "healthy", "provisioning", "deprovisioned"].flatMap((status) =>
    ["page", "panel", "hover", "selected"].map((background) => [
      `${status} marker on ${background}`,
      colors[status],
      colors[background],
    ]),
  ),
  ...["page", "panel", "hover", "selected"].map((background) => [
    `Focus ring on ${background}`,
    colors.accent,
    colors[background],
  ]),
];

const results = [
  ...textPairs.map(([label, foreground, background]) => ({
    label,
    ratio: contrastRatio(foreground, background),
    minimum: 4.5,
  })),
  ...nonTextPairs.map(([label, foreground, background]) => ({
    label,
    ratio: contrastRatio(foreground, background),
    minimum: 3,
  })),
];

console.log("Contrast check (WCAG relative luminance)");
console.log("Check".padEnd(38), "Ratio".padStart(7), "Min".padStart(6));
for (const result of results) {
  const passed = result.ratio >= result.minimum;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${result.label}`.padEnd(38),
    `${result.ratio.toFixed(2)}:1`.padStart(7),
    `${result.minimum.toFixed(1)}:1`.padStart(6),
  );
}
if (results.some((result) => result.ratio < result.minimum)) process.exitCode = 1;

