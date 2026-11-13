import { z } from "zod";
import { dashboardConfig, environmentStates, labNames } from "./config.ts";
import { filterQuerySchema } from "./filter-query.ts";

export const environmentIdSchema = z.string().regex(new RegExp(`^LAB-\\d{${dashboardConfig.environmentIdDigits}}$`));
const maximumAtRiskScore = Object.values(dashboardConfig.atRiskScore).reduce((total, weight) => total + weight, 0);

export const environmentSchema = z.object({
  id: environmentIdSchema,
  learnerName: z.string().min(1).max(dashboardConfig.maxLearnerNameLength),
  learnerEmail: z.string().email().max(dashboardConfig.maxLearnerEmailLength),
  labName: z.string().min(1).max(dashboardConfig.maxLabNameLength),
  sku: z.string().min(1).max(64),
  hourlyRateUsd: z.number().min(0),
  state: z.enum(environmentStates),
  startedAt: z.iso.datetime(),
  provisionedAt: z.iso.datetime().nullable(),
  stepStartedAt: z.iso.datetime(),
  currentStep: z.number().int().min(0).max(dashboardConfig.stepNames.length),
  stepCount: z.number().int().min(1).max(dashboardConfig.stepNames.length),
  stepHistory: z.array(z.object({
    stepIndex: z.number().int().min(0).max(dashboardConfig.stepNames.length - 1),
    durationSeconds: z.number().int().min(0),
  }).strict()).max(dashboardConfig.stepNames.length),
  reprovisionCount: z.number().int().min(0),
  spendAccruedUsd: z.number().min(0),
  refreshPending: z.boolean(),
  error: z.string().max(dashboardConfig.maxIssueLength).nullable(),
  endedAt: z.iso.datetime().nullable(),
  timeOnStepSeconds: z.number().int().min(0),
  spendUsd: z.number().min(0),
  completionPercent: z.number().int().min(0).max(100),
  priorityGroup: z.enum(["failed", "stuck", "other"]),
  lastEvent: z.object({ description: z.string().min(1).max(dashboardConfig.maxIssueLength), at: z.iso.datetime() }).strict(),
}).strict();

export const sessionSummarySchema = z.object({
  total: z.number().int().min(0),
  active: z.number().int().min(0),
  failed: z.number().int().min(0),
  stuck: z.number().int().min(0),
  completed: z.number().int().min(0),
  stateCounts: z.object({
    provisioning: z.number().int().min(0),
    ready: z.number().int().min(0),
    in_use: z.number().int().min(0),
    failed: z.number().int().min(0),
    deprovisioned: z.number().int().min(0),
  }).strict(),
  steps: z.array(z.object({
    step: z.number().int().min(1).max(dashboardConfig.stepNames.length),
    learners: z.number().int().min(0),
    stuck: z.number().int().min(0),
    typicalDurationSeconds: z.number().int().min(0).nullable(),
  }).strict()).length(dashboardConfig.stepNames.length),
  averageCompletionPercent: z.number().int().min(0).max(100),
  spendUsd: z.number().min(0),
  updatedAt: z.iso.datetime(),
}).strict();

export const sortKeySchema = z.enum(["severity", "learner", "state", "step", "time", "spend"]);
export const sortDirectionSchema = z.enum(["asc", "desc"]);

export const environmentQuerySchema = z.object({
  state: z.enum(["all", ...environmentStates]).default("all"),
  states: z.preprocess(
    (value) => typeof value === "string" ? value.split(",") : value,
    z.array(z.enum(environmentStates)).default([]),
  ),
  q: z.string().max(dashboardConfig.maxSearchLength).default(""),
  minutesMin: z.coerce.number().int().min(0).max(dashboardConfig.maxFilterMinutes).optional(),
  minutesMax: z.coerce.number().int().min(0).max(dashboardConfig.maxFilterMinutes).optional(),
  failureReasonContains: z.string().trim().min(1).max(dashboardConfig.maxIssueLength).optional(),
  lab: z.enum(labNames).optional(),
  sort: sortKeySchema.default("state"),
  direction: sortDirectionSchema.default("asc"),
  riskOnly: z.preprocess(
    (value) => value === "true" ? true : value === "false" ? false : value,
    z.boolean().default(false),
  ),
  stuckOnly: z.preprocess(
    (value) => value === "true" ? true : value === "false" ? false : value,
    z.boolean().default(false),
  ),
  step: z.coerce.number().int().min(1).max(dashboardConfig.stepNames.length).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(dashboardConfig.environmentCount).default(dashboardConfig.environmentCount),
}).strict();

export const environmentPageSchema = z.object({
  items: z.array(environmentSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  groups: z.object({
    failed: z.number().int().min(0),
    stuck: z.number().int().min(0),
    other: z.number().int().min(0),
  }).strict(),
  updatedAt: z.iso.datetime(),
}).strict();

export const transitionRequestSchema = z.object({
  state: z.enum(environmentStates),
}).strict();

export const atRiskItemSchema = z.object({
  id: environmentSchema.shape.id,
  learnerName: environmentSchema.shape.learnerName,
  state: environmentSchema.shape.state,
  score: z.number().int().min(1).max(maximumAtRiskScore),
  reasons: z.array(z.string().min(1).max(dashboardConfig.maxIssueLength)).min(1).max(dashboardConfig.maxRiskReasons),
}).strict();

export const filterCommandSchema = z.object({
  state: z.enum(["all", ...environmentStates]).default("all"),
  stuckOnly: z.boolean().default(false),
  search: z.string().max(dashboardConfig.maxSearchLength).default(""),
  step: z.number().int().min(1).max(dashboardConfig.stepNames.length).nullable().default(null),
  source: z.enum(["ai", "rules", "model"]).default("rules"),
  reason: z.enum(["not configured", "timeout", "invalid output", "unavailable", "cooling down"]).optional(),
}).strict();

export const aiFilterResponseSchema = z.union([
  filterCommandSchema,
  z.object({
    query: filterQuerySchema,
    source: z.enum(["model", "rules", "ai"]).default("rules"),
    reason: z.enum(["not configured", "timeout", "invalid output", "unavailable", "cooling down"]).optional(),
  }).strict(),
]);

export const atRiskResponseSchema = z.object({
  items: z.array(atRiskItemSchema).max(dashboardConfig.atRiskSummaryLimit),
  source: z.enum(["ai", "rules"]),
  updatedAt: z.iso.datetime(),
}).strict();

export const problemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().min(1),
  instance: z.string().min(1),
}).strict();

export type EnvironmentDto = z.infer<typeof environmentSchema>;
export type EnvironmentQuery = z.infer<typeof environmentQuerySchema>;
export type FilterCommand = z.infer<typeof filterCommandSchema>;
export type AtRiskDto = z.infer<typeof atRiskItemSchema>;
export type AtRiskResponse = z.infer<typeof atRiskResponseSchema>;
