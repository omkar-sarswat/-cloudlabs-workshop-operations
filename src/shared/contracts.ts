import { z } from "zod";
import { dashboardConfig, environmentStates } from "./config.ts";

export const environmentIdSchema = z.string().regex(new RegExp(`^LAB-\\d{${dashboardConfig.environmentIdDigits}}$`));
const maximumAtRiskScore = Object.values(dashboardConfig.atRiskScore).reduce((total, weight) => total + weight, 0);

export const environmentSchema = z.object({
  id: environmentIdSchema,
  learnerName: z.string().min(1).max(dashboardConfig.maxLearnerNameLength),
  learnerEmail: z.string().email().max(dashboardConfig.maxLearnerEmailLength),
  labName: z.string().min(1).max(dashboardConfig.maxLabNameLength),
  state: z.enum(environmentStates),
  startedAt: z.iso.datetime(),
  stepStartedAt: z.iso.datetime(),
  currentStep: z.number().int().min(0).max(dashboardConfig.stepNames.length),
  stepCount: z.number().int().min(1).max(dashboardConfig.stepNames.length),
  error: z.string().max(dashboardConfig.maxIssueLength).nullable(),
  endedAt: z.iso.datetime().nullable(),
  timeOnStepSeconds: z.number().int().min(0),
  spendUsd: z.number().min(0),
  completionPercent: z.number().int().min(0).max(100),
}).strict();

export const sessionSummarySchema = z.object({
  total: z.number().int().min(0),
  active: z.number().int().min(0),
  failed: z.number().int().min(0),
  completed: z.number().int().min(0),
  averageCompletionPercent: z.number().int().min(0).max(100),
  spendUsd: z.number().min(0),
  updatedAt: z.iso.datetime(),
}).strict();

export const sortKeySchema = z.enum(["learner", "state", "step", "time", "spend"]);
export const sortDirectionSchema = z.enum(["asc", "desc"]);

export const environmentQuerySchema = z.object({
  state: z.enum(["all", ...environmentStates]).default("all"),
  q: z.string().max(dashboardConfig.maxSearchLength).default(""),
  sort: sortKeySchema.default("state"),
  direction: sortDirectionSchema.default("asc"),
  riskOnly: z.preprocess(
    (value) => value === "true" ? true : value === "false" ? false : value,
    z.boolean().default(false),
  ),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(dashboardConfig.environmentCount).default(dashboardConfig.environmentCount),
}).strict();

export const environmentPageSchema = z.object({
  items: z.array(environmentSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
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
export type AtRiskDto = z.infer<typeof atRiskItemSchema>;
export type AtRiskResponse = z.infer<typeof atRiskResponseSchema>;
