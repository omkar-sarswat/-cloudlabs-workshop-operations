import { z } from "zod";
import { dashboardConfig, environmentStates, failureReasons, labNames } from "./config.ts";

export const sortKeySchema = z.enum(["severity", "learner", "state", "step", "time", "spend"]);
export const sortDirectionSchema = z.enum(["asc", "desc"]);
export const filterFailureReasonSchema = z.enum([
  "not configured",
  "timeout",
  "invalid output",
  "unavailable",
  "cooling down",
]);

export const filterQuerySchema = z.object({
  states: z.array(z.enum(environmentStates)).optional(),
  stuck: z.boolean().optional(),
  step: z.number().int().min(1).max(dashboardConfig.stepNames.length).optional(),
  minutesOnStep: z.object({
    min: z.number().int().min(0).max(dashboardConfig.maxFilterMinutes).optional(),
    max: z.number().int().min(0).max(dashboardConfig.maxFilterMinutes).optional(),
  }).strict().refine((value) => {
    if (value.min === undefined || value.max === undefined) return true;
    return value.min <= value.max;
  }, { message: "minutesOnStep.min must be <= minutesOnStep.max" }).optional(),
  failureReasonContains: z.string().trim().min(1).max(dashboardConfig.maxIssueLength).optional(),
  lab: z.enum(labNames).optional(),
  search: z.string().trim().max(dashboardConfig.maxSearchLength).optional(),
  sort: sortKeySchema.optional(),
  direction: sortDirectionSchema.optional(),
}).strict();

export type FilterQuery = z.infer<typeof filterQuerySchema>;
export type FilterFailureReason = z.infer<typeof filterFailureReasonSchema>;

export function normalizeFilterQuery(value: unknown): FilterQuery | null {
  const parsed = filterQuerySchema.safeParse(value);
  if (!parsed.success) return null;
  const query = parsed.data;
  if (query.states && query.states.length === 0) {
    return { ...query, states: undefined };
  }
  if (query.minutesOnStep) {
    const { min, max } = query.minutesOnStep;
    if (min !== undefined && max !== undefined && min > max) {
      return null;
    }
  }
  return query;
}

function matchStep(text: string): number | null {
  const match = text.match(/(?:step|on step)\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function matchMinutes(text: string): { min?: number; max?: number } | null {
  const clamp = (minutes: string) => Math.min(Number(minutes), dashboardConfig.maxFilterMinutes);
  const over = text.match(/(?:over|more than|at least|greater than)\s+(\d+)\s*(?:min|minute|minutes)\b/i);
  if (over) return { min: clamp(over[1]!) };
  const under = text.match(/(?:under|less than|before|no more than|below)\s+(\d+)\s*(?:min|minute|minutes)\b/i);
  if (under) return { max: clamp(under[1]!) };
  const range = text.match(/(?:between|from)\s+(\d+)\s*(?:and|to)\s+(\d+)\s*(?:min|minute|minutes)/i);
  if (range) {
    const first = clamp(range[1]!);
    const second = clamp(range[2]!);
    return { min: Math.min(first, second), max: Math.max(first, second) };
  }
  const single = text.match(/\b(\d+)\s*(?:min|minute|minutes)\b/i);
  if (single && !/over|under|before|less than|more than|at least|between|from|to|below/i.test(text)) {
    const minutes = clamp(single[1]!);
    return { min: minutes, max: minutes };
  }
  return null;
}

function matchLab(text: string): string | null {
  const lower = text.toLowerCase();
  for (const lab of labNames) {
    if (lower.includes(lab.toLowerCase())) return lab;
  }
  return null;
}

function matchFailureReason(text: string): string | null {
  const lower = text.toLowerCase();
  for (const reason of failureReasons) {
    if (lower.includes(reason.toLowerCase())) return reason;
  }
  if (/\bquota\b/.test(lower)) return "Quota limit reached";
  if (/\bnetwork(?:ing)?\b/.test(lower) && /\b(?:issue|issues|error|errors|fail|failed|failure|validation|rule|problem|problems)\b/.test(lower)) {
    return "Network rule validation failed";
  }
  if (/\bcredentials?\b|\bcredential checks?\b/.test(lower)) return "Credential check failed";
  if (/\bdeployment\b|\bdeploy(?:ment)? timed? ?out\b/.test(lower)) return "Deployment timed out";
  return null;
}

export function parseRulesFilterText(input: string): FilterQuery {
  const text = input.trim().toLowerCase()
    .replace(/\bstcuk\b/g, "stuck")
    .replace(/\bstuckk\b/g, "stuck")
    .replace(/\bquoto\b/g, "quota")
    .replace(/\bnetwrok\b/g, "network")
    .replace(/\bcredentail(s?)\b/g, "credential$1")
    .replace(/\bfaild\b/g, "failed")
    .replace(/\bprovisionng\b/g, "provisioning");
  if (!text) return {};

  const stateText = text.replace(/\b(?:credential|credentials|network|deployment)(?:\s+[\w-]+){0,3}\s+failed\b/g, " ");
  const stuck = /\b(stuck|stalled|hung|not moving|blocked|slow)\b/i.test(text);
  const states = Array.from(new Set(
    environmentStates.filter((value) => stateText.includes(value.replace("_", " "))),
  ));
  const matchedStep = matchStep(text);
  const step = matchedStep === null
    ? null
    : Math.min(Math.max(matchedStep, 1), dashboardConfig.stepNames.length);
  const minutes = matchMinutes(text);
  const lab = matchLab(text);
  let textWithoutLabs = text;
  for (const name of labNames) {
    textWithoutLabs = textWithoutLabs.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  const failureReasonContains = matchFailureReason(textWithoutLabs);
  let searchText = textWithoutLabs;
  searchText = searchText.replace(/\b(?:sort|order)(?:\s+by)?\s+(?:severity|learner|state|step|time|spend)(?:\s+(?:asc|ascending|desc|descending|highest|most|latest|longest|lowest|least|oldest|shortest))?\b/g, " ");
  if (failureReasonContains) {
    searchText = searchText
      .replace(/\bquota(?:\s+(?:limit|error|errors|issue|issues|problem|problems|reached))*\b/gi, " ")
      .replace(/\bnetwork(?:ing)?(?:\s+(?:rule|validation|issue|issues|error|errors|problem|problems|failed))*\b/gi, " ")
      .replace(/\bcredential(?:s)?(?:\s+(?:check|checks|issue|issues|error|errors|failed))*\b/gi, " ")
      .replace(/\bdeployment(?:\s+(?:timed?\s*out|timeout|issue|issues|error|errors|failed))*\b/gi, " ");
  }
  searchText = searchText
    .replace(/\b(?:on\s+)?step\s+\d+\b/gi, " ")
    .replace(/\b(?:over|more than|at least|greater than|under|less than|before|no more than|below)\s+\d+\s*(?:min|minute|minutes)\b/gi, " ")
    .replace(/\bbetween\s+\d+\s*(?:and|to)\s+\d+\s*(?:min|minute|minutes)\b/gi, " ")
    .replace(/\b\d+\s*(?:min|minute|minutes)\b/gi, " ")
    .replace(/\bin[\s_-]+use\b/gi, " ")
    .replace(/\b(?:everyone|everybody|anyone|all|show|find|filter|search|only|the|with|without|for|on|at|and|or|in|over|more|than|at least|greater|less|under|before|no|below|between|from|to|env|environment|environments|learner|learners|lab|labs|step|minutes?|mins?|complete|completed)\b/gi, " ")
    .replace(/\b(?:stuck|stalled|hung|not moving|blocked|slow)\b/gi, " ")
    .replace(/\b(?:provisioning|ready|failed|deprovisioned|in_use)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const query: FilterQuery = {};
  if (states.length > 0) {
    query.states = states as FilterQuery["states"];
  } else if (stuck) {
    query.states = ["in_use"];
  }
  if (stuck) query.stuck = true;
  if (step !== null) query.step = step;
  if (minutes) query.minutesOnStep = minutes;
  if (failureReasonContains) query.failureReasonContains = failureReasonContains;
  if (lab) query.lab = lab as (typeof labNames)[number];
  if (searchText) query.search = searchText;
  const sortMatch = text.match(/\b(?:sort|order)(?:\s+by)?\s+(severity|learner|state|step|time|spend)\b/)
    ?? text.match(/\b(severity|learner|state|step|time|spend)\s+(?:asc|ascending|desc|descending)\b/);
  if (sortMatch) {
    query.sort = sortMatch[1] as FilterQuery["sort"];
    if (/\b(desc|descending|highest|most|latest|longest)\b/.test(text)) query.direction = "desc";
    else if (/\b(asc|ascending|lowest|least|oldest|shortest)\b/.test(text)) query.direction = "asc";
  }
  return query;
}

export function legacyCommandFromQuery(query: FilterQuery, reason?: FilterFailureReason): { state: "all" | "provisioning" | "ready" | "in_use" | "failed" | "deprovisioned"; stuckOnly: boolean; search: string; step: number | null; source: "rules" | "model" | "ai"; reason?: FilterFailureReason } {
  const state = query.states && query.states.length === 1 ? query.states[0] : "all";
  return {
    state: state ?? "all",
    stuckOnly: Boolean(query.stuck),
    search: query.search ?? "",
    step: query.step ?? null,
    source: "rules",
    ...(reason ? { reason } : {}),
  };
}

export function toLegacyFilterCommand(payload: { query?: FilterQuery; state?: string; stuckOnly?: boolean; search?: string; step?: number | null; source?: "model" | "rules" | "ai"; reason?: FilterFailureReason }): { state: "all" | "provisioning" | "ready" | "in_use" | "failed" | "deprovisioned"; stuckOnly: boolean; search: string; step: number | null; source: "rules" | "ai"; reason?: FilterFailureReason } {
  const result = payload.query ?? {};
  const state = payload.state ?? ((result.states && result.states.length === 1) ? result.states[0] : "all");
  return {
    state: (state === "all" || state === "provisioning" || state === "ready" || state === "in_use" || state === "failed" || state === "deprovisioned") ? state : "all",
    stuckOnly: Boolean(payload.stuckOnly ?? result.stuck),
    search: payload.search ?? result.search ?? "",
    step: payload.step ?? result.step ?? null,
    source: payload.source === "model" ? "ai" : (payload.source === "rules" ? "rules" : (payload.source === "ai" ? "ai" : "rules")),
    ...(payload.reason ? { reason: payload.reason } : {}),
  };
}
