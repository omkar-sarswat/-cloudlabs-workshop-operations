import {
  dashboardConfig,
  environmentStates,
  statePriority,
  type EnvironmentState,
} from "../shared/config.ts";
import type { Environment, EnvironmentView, SessionSummary } from "./model.ts";

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

const planSkus: Record<(typeof labNames)[number], string> = {
  "Cloud networking": "network-standard",
  "Identity and access": "identity-standard",
  "Deploy a web app": "app-standard",
  "Secure storage": "storage-standard",
};

const failureReasons = [
  "Deployment timed out",
  "Quota limit reached",
  "Network rule validation failed",
  "Credential check failed",
] as const;

export type EnvironmentSortKey = "severity" | "learner" | "state" | "step" | "time" | "spend";
export type SortDirection = "asc" | "desc";

export interface EnvironmentFilters {
  state: EnvironmentState | "all";
  states?: readonly EnvironmentState[];
  search: string;
  riskOnly: boolean;
  stuckOnly?: boolean;
  step?: number;
  minutesOnStep?: { min?: number; max?: number };
  failureReasonContains?: string;
  lab?: string;
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

function seedStepHistory(index: number, count: number, totalSeconds: number) {
  if (count === 0) return [];
  const weights = Array.from({ length: count }, (_, stepIndex) =>
    dashboardConfig.seedCompletedStepDurationBaseSeconds
      + ((index * dashboardConfig.seedCompletedStepScatterMultiplier + stepIndex * 53)
        % dashboardConfig.seedCompletedStepDurationSpanSeconds),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight, stepIndex) => ({
    stepIndex,
    durationSeconds: Math.floor(totalSeconds * weight / totalWeight),
  }));
}

export function seedEnvironments(now: Date): Environment[] {
  return Array.from({ length: dashboardConfig.environmentCount }, (_, index) => {
    const [learnerName, emailPrefix] = learners[index % learners.length]!;
    const state = seedState(index + 1);
    const nominalRuntimeSeconds = dashboardConfig.seedRuntimeBaseSeconds
      + ((index * dashboardConfig.seedRuntimeScatterMultiplier) % dashboardConfig.seedRuntimeSpanSeconds);
    const currentStep = state === "deprovisioned"
      ? dashboardConfig.stepNames.length
      : Math.min(dashboardConfig.stepNames.length - 1, Math.floor(nominalRuntimeSeconds / dashboardConfig.stepAdvanceAfterSeconds));
    const isSeededStuck = state !== "failed"
      && state !== "deprovisioned"
      && index % dashboardConfig.seedStuckModulo === dashboardConfig.seedStuckRemainder;
    const stepAgeSeconds = isSeededStuck
      ? dashboardConfig.stuckThresholdSeconds
        + dashboardConfig.seedStuckOverageBaseSeconds
        + ((index * dashboardConfig.seedStuckAgeScatterMultiplier) % dashboardConfig.seedStuckOverageSpanSeconds)
      : dashboardConfig.seedFreshStepAgeBaseSeconds
        + ((index * dashboardConfig.seedFreshStepAgeScatterMultiplier) % dashboardConfig.seedFreshStepAgeSpanSeconds);
    const minimumRuntimeSeconds = stepAgeSeconds + currentStep * dashboardConfig.seedCompletedStepDurationBaseSeconds;
    const runtimeSeconds = Math.max(nominalRuntimeSeconds, minimumRuntimeSeconds);
    const startedAt = new Date(now.getTime() - runtimeSeconds * 1000).toISOString();
    const stepStartedAt = new Date(now.getTime() - stepAgeSeconds * 1000).toISOString();
    const labName = labNames[index % labNames.length]!;
    const stepHistory = seedStepHistory(index, currentStep, runtimeSeconds - stepAgeSeconds);
    const endedAt = state === "failed" || state === "deprovisioned"
      ? new Date(now.getTime() - (index % dashboardConfig.seedEndedAgeWindowMinutes) * 60_000).toISOString()
      : null;

    return {
      id: `LAB-${String(index + 1).padStart(3, "0")}`,
      learnerName: `${learnerName} ${String(Math.floor(index / learners.length) + 1).padStart(2, "0")}`,
      learnerEmail: `${emailPrefix}+${String(index + 1).padStart(3, "0")}@workshop.example`,
      labName,
      sku: planSkus[labName],
      hourlyRateUsd: dashboardConfig.estimatedCostPerHourUsd,
      state,
      startedAt,
      provisionedAt: state === "provisioning"
        ? null
        : new Date(now.getTime() - Math.max(0, runtimeSeconds - 120) * 1000).toISOString(),
      stepStartedAt,
      currentStep,
      stepCount: dashboardConfig.stepNames.length,
      stepHistory,
      reprovisionCount: 0,
      spendAccruedUsd: 0,
      refreshPending: false,
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
  return roundMoney(environment.spendAccruedUsd + elapsedHours * environment.hourlyRateUsd);
}

function lastEvent(environment: Environment): { description: string; at: string } {
  if (environment.state === "failed") {
    return { description: environment.error ?? "Environment failed", at: environment.endedAt ?? environment.stepStartedAt };
  }
  if (environment.state === "deprovisioned") {
    return { description: "Lab completed", at: environment.endedAt ?? environment.stepStartedAt };
  }
  if (environment.state === "provisioning") {
    return { description: "Provisioning requested", at: environment.startedAt };
  }
  if (environment.state === "ready") {
    return { description: "Provisioning completed", at: environment.stepStartedAt };
  }
  return { description: `Started step ${Math.min(environment.currentStep + 1, environment.stepCount)}`, at: environment.stepStartedAt };
}

export function toEnvironmentView(environment: Environment, now: Date): EnvironmentView {
  const stuck = isStuck(environment, now);
  return {
    ...environment,
    timeOnStepSeconds: secondsBetween(environment.stepStartedAt, now),
    spendUsd: calculateSpendUsd(environment, now),
    completionPercent: Math.round((environment.currentStep / environment.stepCount) * 100),
    priorityGroup: environment.state === "failed" ? "failed" : stuck ? "stuck" : "other",
    lastEvent: lastEvent(environment),
  };
}

export function filterEnvironments(
  environments: Environment[],
  filters: EnvironmentFilters,
  now: Date,
): Environment[] {
  const needle = filters.search.trim().toLocaleLowerCase();
  const failureReasonNeedle = filters.failureReasonContains?.trim().toLocaleLowerCase();
  return environments.filter((environment) => {
    if (filters.state !== "all" && environment.state !== filters.state) return false;
    if (filters.states?.length && !filters.states.includes(environment.state)) return false;
    if (filters.stuckOnly && !isStuck(environment, now)) return false;
    if (filters.step !== undefined && environment.currentStep !== filters.step - 1) return false;
    if (filters.minutesOnStep) {
      const minutesOnStep = Math.floor(secondsBetween(environment.stepStartedAt, now) / 60);
      if (filters.minutesOnStep.min !== undefined && minutesOnStep < filters.minutesOnStep.min) return false;
      if (filters.minutesOnStep.max !== undefined && minutesOnStep > filters.minutesOnStep.max) return false;
    }
    if (filters.failureReasonContains && !environment.error?.toLocaleLowerCase().includes(failureReasonNeedle ?? "")) return false;
    if (filters.lab && environment.labName !== filters.lab) return false;
    if (filters.riskOnly && environment.state !== "failed" && !isStuck(environment, now)) return false;
    if (!needle) return true;
    return [environment.id, environment.learnerName, environment.learnerEmail, environment.labName, environment.error ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(needle));
  });
}

function sortValue(environment: Environment, key: EnvironmentSortKey, now: Date): number | string {
  switch (key) {
    case "severity":
      if (environment.state === "failed") return 0;
      if (isStuck(environment, now)) return 1;
      return 2 + statePriority[environment.state];
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
  const stateCounts = Object.fromEntries(environmentStates.map((state) => [
    state,
    environments.filter((environment) => environment.state === state).length,
  ])) as Record<EnvironmentState, number>;
  const steps = buildStepDistribution(environments, now);
  return {
    total: environments.length,
    active: environments.filter(({ state }) => state === "provisioning" || state === "ready" || state === "in_use").length,
    failed: environments.filter(({ state }) => state === "failed").length,
    stuck: environments.filter((environment) => isStuck(environment, now)).length,
    completed: environments.filter(({ state }) => state === "deprovisioned").length,
    stateCounts,
    steps,
    averageCompletionPercent: environments.length === 0 ? 0 : Math.round((progress / environments.length) * 100),
    spendUsd: roundMoney(spendCents / 100),
    updatedAt: now.toISOString(),
  };
}

export function buildStepDistribution(environments: Environment[], now: Date): SessionSummary["steps"] {
  return dashboardConfig.stepNames.map((_, index) => {
    const onStep = environments.filter((environment) => environment.currentStep === index);
    const completedDurations = environments
      .flatMap((environment) => environment.stepHistory)
      .filter((step) => step.stepIndex === index)
      .map((step) => step.durationSeconds)
      .sort((left, right) => left - right);
    const middle = Math.floor(completedDurations.length / 2);
    const typicalDurationSeconds = completedDurations.length === 0
      ? null
      : completedDurations.length % 2 === 1
        ? completedDurations[middle]!
        : Math.round((completedDurations[middle - 1]! + completedDurations[middle]!) / 2);
    return {
      step: index + 1,
      learners: onStep.length,
      stuck: onStep.filter((environment) => isStuck(environment, now)).length,
      typicalDurationSeconds,
    };
  });
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
      spendAccruedUsd: calculateSpendUsd(environment, now),
      startedAt: now.toISOString(),
      provisionedAt: null,
      stepStartedAt: now.toISOString(),
      currentStep: 0,
      stepHistory: [],
      reprovisionCount: environment.reprovisionCount + 1,
      refreshPending: false,
      error: null,
      endedAt: null,
    },
  };
}

export function advanceEnvironment(environment: Environment, now: Date, tick: number): Environment {
  const numericId = Number.parseInt(environment.id.slice(-dashboardConfig.environmentIdDigits), 10);
  const phase = Number.isNaN(numericId) ? 0 : numericId - 1;
  const environmentIndex = Math.max(0, phase);
  const completeStep = (state: EnvironmentState): Environment => ({
    ...environment,
    state,
    currentStep: Math.min(environment.stepCount, environment.currentStep + 1),
    stepHistory: environment.currentStep < environment.stepCount
      ? [...environment.stepHistory, {
        stepIndex: environment.currentStep,
        durationSeconds: secondsBetween(environment.stepStartedAt, now),
      }]
      : environment.stepHistory,
    stepStartedAt: now.toISOString(),
    provisionedAt: state === "ready" ? environment.provisionedAt ?? now.toISOString() : environment.provisionedAt,
    endedAt: state === "deprovisioned" ? now.toISOString() : null,
  });

  if (environment.state === "provisioning" && (tick + phase) % dashboardConfig.provisioningReadyTickModulo === 0) {
    return environment.refreshPending
      ? { ...environment, state: "ready", provisionedAt: environment.provisionedAt ?? now.toISOString() }
      : completeStep("ready");
  }
  if (environment.state === "ready" && (tick + phase) % dashboardConfig.readyInUseTickModulo === 0) {
    return environment.refreshPending
      ? { ...environment, state: "in_use", refreshPending: false }
      : { ...environment, state: "in_use", stepStartedAt: now.toISOString() };
  }
  const stallWindow = dashboardConfig.stepCompletionRateWindowTicks;
  const stallThreshold = stallWindow * dashboardConfig.simulatedStepStallRatePercent / 100;
  const selectedForStall = environmentIndex % stallWindow < stallThreshold;
  if (environment.state === "in_use" && secondsBetween(environment.stepStartedAt, now) >= dashboardConfig.stepAdvanceAfterSeconds) {
    const stuck = isStuck(environment, now);
    const stepAgeSeconds = secondsBetween(environment.stepStartedAt, now);
    const minimumVisibleAge = dashboardConfig.stuckThresholdSeconds + dashboardConfig.stuckMinimumVisibleSeconds;
    if (stuck && (
      stepAgeSeconds < minimumVisibleAge
      || (tick + phase) % dashboardConfig.stuckRecoveryTickModulo !== 0
    )) return environment;
    if (!stuck && selectedForStall) return environment;
    const currentStep = Math.min(environment.stepCount, environment.currentStep + 1);
    const completed = currentStep >= environment.stepCount;
    const rateWindow = dashboardConfig.stepCompletionRateWindowTicks;
    const entersProvisioning = tick % rateWindow
      < rateWindow * dashboardConfig.stepCompletionProvisioningRatePercent / 100;
    const nextState = completed ? "deprovisioned" : entersProvisioning ? "provisioning" : "in_use";
    const updated = completeStep(nextState);
    return nextState === "provisioning" ? { ...updated, refreshPending: true } : updated;
  }
  const refreshCycleTicks = Math.ceil(dashboardConfig.environmentCount / dashboardConfig.inUseRefreshesPerTick);
  const refreshSlot = tick % refreshCycleTicks;
  if (
    environment.state === "in_use"
    && !isStuck(environment, now)
    && !(selectedForStall && secondsBetween(environment.stepStartedAt, now) >= dashboardConfig.stepAdvanceAfterSeconds)
    && dashboardConfig.inUseRefreshesPerTick > 0
    && environmentIndex % refreshCycleTicks === refreshSlot
  ) {
    return { ...environment, state: "provisioning", refreshPending: true };
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
        score += dashboardConfig.atRiskScore.failed;
        reasons.push(environment.error ?? "Environment failed");
      }
      if (isStuck(environment, now)) {
        score += dashboardConfig.atRiskScore.stuck;
        reasons.push(`No progress for over ${Math.round(dashboardConfig.stuckThresholdSeconds / 60)} minutes`);
      }
      if (environment.state === "provisioning" && secondsBetween(environment.startedAt, now) >= dashboardConfig.longProvisioningThresholdSeconds) {
        score += dashboardConfig.atRiskScore.slowProvisioning;
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
