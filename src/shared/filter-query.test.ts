import { describe, expect, it } from "vitest";
import { parseRulesFilterText, type FilterQuery } from "./filter-query.ts";

describe("parseRulesFilterText", () => {
  const cases: Array<[string, FilterQuery]> = [
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
    ["stcuk on step 4 for at least 20 minutes", { states: ["in_use"], stuck: true, step: 4, minutesOnStep: { min: 20 } }],
    ["stuckk step 2", { states: ["in_use"], stuck: true, step: 2 }],
    ["quoto error", { failureReasonContains: "Quota limit reached" }],
    ["netwrok issues", { failureReasonContains: "Network rule validation failed" }],
    ["faild labs", { states: ["failed"] }],
    ["provisionng environment", { states: ["provisioning"] }],
    ["below 20 minutes on step 5", { step: 5, minutesOnStep: { max: 20 } }],
    ["between 10 and 25 minutes", { minutesOnStep: { min: 10, max: 25 } }],
    ["secure storage lab", { lab: "Secure storage" }],
    ["search learner x-42", { search: "x-42" }],
    ["quota error in cloud networking", { failureReasonContains: "Quota limit reached", lab: "Cloud networking" }],
    ["failed labs with quota errors on step 5", { states: ["failed"], failureReasonContains: "Quota limit reached", step: 5 }],
    ["blocked on step 3", { states: ["in_use"], stuck: true, step: 3 }],
    ["more than 1000000 minutes", { minutesOnStep: { min: 525_600 } }],
    ["deployment timed out", { failureReasonContains: "Deployment timed out" }],
    ["network error", { failureReasonContains: "Network rule validation failed" }],
    ["step 99", { step: 8 }],
    ["step 0", { step: 1 }],
    ["between 30 and 10 minutes", { minutesOnStep: { min: 10, max: 30 } }],
    ["sort by spend descending", { sort: "spend", direction: "desc" }],
    ["order by learner ascending", { sort: "learner", direction: "asc" }],
  ];

  it.each(cases)("parses %s to the expected query", (sentence, expected) => {
    expect(parseRulesFilterText(sentence)).toEqual(expected);
  });
});
