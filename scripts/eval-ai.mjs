import { parseRulesFilterText } from "../src/shared/filter-query.ts";
import { AiFilterService, createAiFilterAdapter } from "../src/server/ai.ts";

const samples = [
  ["everyone stuck on step 4 over 20 min", { states: ["in_use"], stuck: true, step: 4, minutesOnStep: { min: 20 } }],
  ["failed environments with quota errors", { states: ["failed"], failureReasonContains: "Quota limit reached" }],
  ["show ready labs", { states: ["ready"] }],
  ["stuck on step 2", { states: ["in_use"], stuck: true, step: 2 }],
  ["deprovisioned learners", { states: ["deprovisioned"] }],
  ["all in use", { states: ["in_use"] }],
  ["provisioning with network issues", { states: ["provisioning"], failureReasonContains: "Network rule validation failed" }],
  ["failed on step 6", { states: ["failed"], step: 6 }],
  ["under 15 min on step 3", { step: 3, minutesOnStep: { max: 15 } }],
  ["over 40 minutes", { minutesOnStep: { min: 40 } }],
  ["learner x-42", { search: "x-42" }],
  ["Cloud networking lab", { lab: "Cloud networking" }],
  ["credential checks failed", { failureReasonContains: "Credential check failed" }],
  ["step 8 complete", { step: 8 }],
  ["stalled learners in cloud networking", { states: ["in_use"], stuck: true, lab: "Cloud networking" }],
  ["show failed labs with deployment timeout", { states: ["failed"], failureReasonContains: "Deployment timed out" }],
  ["lab secure storage in use", { states: ["in_use"], lab: "Secure storage" }],
  ["everybody on step 1 before 10 minutes", { step: 1, minutesOnStep: { max: 10 } }],
  ["quota limit issue", { failureReasonContains: "Quota limit reached" }],
  ["in use and stuck", { states: ["in_use"], stuck: true }],
];

const matchesExpected = (actual, expected) => {
  const actualEntries = Object.entries(actual).filter(([, value]) => value !== undefined);
  if (actualEntries.length !== Object.keys(expected).length) return false;
  return Object.entries(expected).every(([key, value]) => {
  const actualValue = actual[key];
  if (Array.isArray(value)) return JSON.stringify(actualValue ?? []) === JSON.stringify(value);
  if (value && typeof value === "object") return JSON.stringify(actualValue ?? {}) === JSON.stringify(value);
  return actualValue === value;
  });
};

const reportAccuracy = (mode, correct, total) => {
  console.log(`AI ${mode} parser accuracy: ${correct}/${total} (${((correct / total) * 100).toFixed(1)}%)`);
};

const reportMismatch = (mode, sentence, expected, actual) => {
  if (!matchesExpected(actual, expected)) {
    console.log(`${mode} mismatch: ${JSON.stringify(sentence)} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
};

let rulesCorrect = 0;
for (const [sentence, expected] of samples) {
  const actual = parseRulesFilterText(sentence);
  if (matchesExpected(actual, expected)) rulesCorrect += 1;
  else reportMismatch("rules", sentence, expected, actual);
}

reportAccuracy("rules", rulesCorrect, samples.length);

const apiKey = process.env.AI_FILTER_API_KEY || process.env.GEMINI_API_KEY;
if (apiKey) {
  const provider = process.env.AI_FILTER_PROVIDER || "rules";
  const adapter = createAiFilterAdapter(
    provider,
    apiKey,
    process.env.AI_FILTER_MODEL || process.env.GEMINI_MODEL,
    process.env.AI_FILTER_BASE_URL,
  );
  if (!adapter) {
    console.log(`AI model parser accuracy: not run (provider "${provider}" does not use a configured API key)`);
  } else {
    const service = new AiFilterService(
      parseRulesFilterText,
      adapter,
      Number(process.env.AI_FILTER_TIMEOUT_MS ?? 3_000),
    );
    let modelCorrect = 0;
    for (const [sentence, expected] of samples) {
      const actual = await service.parse(sentence, "eval-ai");
      if (matchesExpected(actual.query, expected)) modelCorrect += 1;
      else reportMismatch("model", sentence, expected, actual.query);
    }
    reportAccuracy("model", modelCorrect, samples.length);
  }
} else {
  console.log("AI model parser accuracy: not run (no API key configured)");
}
