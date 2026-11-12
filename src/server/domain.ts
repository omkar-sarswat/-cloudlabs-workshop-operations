import {
  dashboardConfig,
  environmentStates,
  statePriority,
  type EnvironmentState,
} from "../shared/config.ts";
import type { Environment, SessionSummary } from "./model.ts";

const learners = [
  ["Avery Kim", "avery.kim"],
  ["Jordan Patel", "jordan.patel"],
  ["Morgan Diaz", "morgan.diaz"],
  ["Taylor Reed", "taylor.reed"],
  ["Casey Nguyen", "casey.nguyen"],
  ["Riley Chen", "riley.chen"],
  ["Quinn Brooks", "quinn.brooks"],
  ["Cameron Shah", "cameron.shah"],
  ["Jamie Park", "jamie.park"],
  ["Drew Foster", "drew.foster"],
] as const;

const labNames = [
  "Cloud networking",
  "Identity and access",
  "Deploy a web app",
  "Secure storage",
] as const;

const failureReasons = [
  "Deployment timed out",
  "Quota limit reached",
  "Network rule validation failed",
  "Credential check failed",
] as const;

export type EnvironmentSortKey = "learner" | "state" | "step" | "time" | "spend";
export type SortDirection = "asc" | "desc";

export interface EnvironmentFilters {
  state: EnvironmentState | "all";
  search: string;
  riskOnly: boolean;
}

export interface TransitionResult {
  ok: true;
  changed: boolean;
  environment: Environment;
}

export interface TransitionConflict {
  ok: false;
  reason: "conflict";
}

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function secondsBetween(start: string, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - Date.parse(start)) / 1000));
}

function seedState(index: number): EnvironmentState {
  const { failed, deprovisioned, provisioning, ready } = dashboardConfig.seedStatusModulo;
  if (index % failed === 0) return "failed";
  if (index % deprovisioned === 0) return "deprovisioned";
  if (index % provisioning === 0) return "provisioning";
  if (index % ready === 0) return "ready";
  return "in_use";
}

export function seedEnvironments(now: Date): Environment[] {
  return Array.from({ length: dashboardConfig.environmentCount }, (_, index) => {
    const [learnerName, emailPrefix] = learners[index % learners.length]!;
    const state = seedState(index + 1);
    const runtimeSeconds = dashboardConfig.seedRuntimeBaseSeconds
      + ((index * 7919) % dashboardConfig.seedRuntimeSpanSeconds);
    const startedAt = new Date(now.getTime() - runtimeSeconds * 1000).toISOString();
    const isSeededStuck = index % dashboardConfig.seedStuckModulo === dashboardConfig.seedStuckRemainder;
    const stepStartedAt = new Date(now.getTime() - (isSeededStuck ? dashboardConfig.stuckThresholdSeconds + 600 : 90) * 1000).toISOString();
    const currentStep = state === "deprovisioned"
      ? dashboardConfig.stepNames.length
      : Math.min(dashboardConfig.stepNames.length - 1, Math.floor(runtimeSeconds / dashboardConfig.stepAdvanceAfterSeconds));
    const endedAt = state === "failed" || state === "deprovisioned"
      ? new Date(now.getTime() - (index % 12) * 60_000).toISOString()
      : null;

    return {
      id: `LAB-${String(index + 1).padStart(3, "0")}`,
      learnerName: `${learnerName} ${String(Math.floor(index / learners.length) + 1).padStart(2, "0")}`,
      learnerEmail: `${emailPrefix}+${String(index + 1).padStart(3, "0")}@workshop.example`,
      labName: labNames[index % labNames.length]!,
      state,
      startedAt,
      stepStartedAt,
      currentStep,
      stepCount: dashboardConfig.stepNames.length,
      error: state === "failed" ? failureReasons[index % failureReasons.length]! : null,
      endedAt,
    } satisfies Environment;
  });
}

export function isStuck(environment: Environment, now: Date): boolean {
  if (environment.state === "failed" || environment.state === "deprovisioned") return false;
  return secondsBetween(environment.stepStartedAt, now) >= dashboardConfig.stuckThresholdSeconds;
}

export function calculateSpendUsd(environment: Environment, now: Date): number {
  const started = Date.parse(environment.startedAt);
  const end = environment.endedAt ? Math.min(now.getTime(), Date.parse(environment.endedAt)) : now.getTime();
  const elapsedHours = Math.max(0, end - started) / 3_600_000;
  return roundMoney(elapsedHours * dashboardConfig.estimatedCostPerHourUsd);
}

export function filterEnvironments(
  environments: Environment[],
  filters: EnvironmentFilters,
  now: Date,
): Environment[] {
  const needle = filters.search.trim().toLocaleLowerCase();
  return environments.filter((environment) => {
    if (filters.state !== "all" && environment.state !== filters.state) return false;
    if (filters.riskOnly && environment.state !== "failed" && !isStuck(environment, now)) return false;
    if (!needle) return true;
    return [environment.id, environment.learnerName, environment.learnerEmail, environment.labName, environment.error ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(needle));
  });
}

function sortValue(environment: Environment, key: EnvironmentSortKey, now: Date): number | string {
  switch (key) {
    case "learner": return environment.learnerName.toLocaleLowerCase();
    case "state": return statePriority[environment.state];
    case "step": return environment.currentStep / environment.stepCount;
    case "time": return secondsBetween(environment.stepStartedAt, now);
    case "spend": return calculateSpendUsd(environment, now);
  }
}

export function sortEnvironments(
  environments: Environment[],
  key: EnvironmentSortKey,
  direction: SortDirection,
  now: Date,
): Environment[] {
  return [...environments].sort((left, right) => {
    const leftValue = sortValue(left, key, now);
    const rightValue = sortValue(right, key, now);
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue));
    return comparison === 0
      ? left.id.localeCompare(right.id)
      : direction === "asc" ? comparison : -comparison;
  });
}

export function buildSessionSummary(environments: Environment[], now: Date): SessionSummary {
  const spendCents = environments.reduce((sum, environment) => sum + Math.round(calculateSpendUsd(environment, now) * 100), 0);
  const progress = environments.reduce((sum, environment) => sum + environment.currentStep / environment.stepCount, 0);
  return {
    total: environments.length,
    active: environments.filter(({ state }) => state === "provisioning" || state === "ready" || state === "in_use").length,
    failed: environments.filter(({ state }) => state === "failed").length,
    completed: environments.filter(({ state }) => state === "deprovisioned").length,
    averageCompletionPercent: environments.length === 0 ? 0 : Math.round((progress / environments.length) * 100),
    spendUsd: roundMoney(spendCents / 100),
    updatedAt: now.toISOString(),
  };
}

export function transitionEnvironment(
  environment: Environment,
  target: EnvironmentState,
  now: Date,
): TransitionResult | TransitionConflict {
  if (environment.state === target) return { ok: true, changed: false, environment };
  if (environment.state !== "failed" || target !== "provisioning") return { ok: false, reason: "conflict" };
  return {
    ok: true,
    changed: true,
    environment: {
      ...environment,
      state: "provisioning",
      startedAt: now.toISOString(),
      stepStartedAt: now.toISOString(),
      currentStep: 0,
      error: null,
      endedAt: null,
    },
  };
}

export function advanceEnvironment(environment: Environment, now: Date, tick: number): Environment {
  if (environment.state === "provisioning" && tick % dashboardConfig.provisioningReadyTickModulo === 0) {
    return {
      ...environment,
      state: "ready",
      currentStep: Math.min(environment.stepCount - 1, environment.currentStep + 1),
      stepStartedAt: now.toISOString(),
    };
  }
  if (environment.state === "ready" && tick % dashboardConfig.readyInUseTickModulo === 0) {
    return { ...environment, state: "in_use", stepStartedAt: now.toISOString() };
  }
  if (environment.state === "in_use" && secondsBetween(environment.stepStartedAt, now) >= dashboardConfig.stepAdvanceAfterSeconds) {
    const currentStep = Math.min(environment.stepCount, environment.currentStep + 1);
    const completed = currentStep >= environment.stepCount;
    return {
      ...environment,
      state: completed ? "deprovisioned" : "in_use",
      currentStep,
      stepStartedAt: now.toISOString(),
      endedAt: completed ? now.toISOString() : null,
    };
  }
  return environment;
}

export interface AtRiskEnvironment {
  id: string;
  score: number;
  reasons: string[];
}

export function rankAtRiskEnvironments(environments: Environment[], now: Date, limit: number): AtRiskEnvironment[] {
  return environments
    .map((environment) => {
      const reasons: string[] = [];
      let score = 0;
      if (environment.state === "failed") {
        score += 100;
        reasons.push(environment.error ?? "Environment failed");
      }
      if (isStuck(environment, now)) {
        score += 50;
        reasons.push(`No progress for over ${Math.round(dashboardConfig.stuckThresholdSeconds / 60)} minutes`);
      }
      if (environment.state === "provisioning" && secondsBetween(environment.startedAt, now) >= dashboardConfig.longProvisioningThresholdSeconds) {
        score += 25;
        reasons.push("Provisioning is taking longer than expected");
      }
      return { id: environment.id, score, reasons };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function isEnvironmentState(value: string): value is EnvironmentState {
  return (environmentStates as readonly string[]).includes(value);
}
