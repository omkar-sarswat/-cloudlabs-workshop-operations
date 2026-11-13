import { describe, expect, it } from "vitest";
import {
  advanceEnvironment,
  buildStepDistribution,
  buildSessionSummary,
  calculateSpendUsd,
  filterEnvironments,
  isStuck,
  seedEnvironments,
  sortEnvironments,
  toEnvironmentView,
  transitionEnvironment,
} from "./domain.ts";
import type { Environment } from "./model.ts";
import { dashboardConfig } from "../shared/config.ts";

const now = new Date("2026-11-12T06:00:00.000Z");

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "lab-001",
    learnerName: "Avery Kim",
    learnerEmail: "avery.kim@example.test",
    labName: "Cloud networking",
    sku: "network-standard",
    hourlyRateUsd: dashboardConfig.estimatedCostPerHourUsd,
    state: "in_use",
    startedAt: new Date("2026-11-12T05:00:00.000Z").toISOString(),
    provisionedAt: new Date("2026-11-12T05:01:00.000Z").toISOString(),
    stepStartedAt: new Date("2026-11-12T05:20:00.000Z").toISOString(),
    currentStep: 3,
    stepCount: 8,
    stepHistory: [
      { stepIndex: 0, durationSeconds: 480 },
      { stepIndex: 1, durationSeconds: 510 },
      { stepIndex: 2, durationSeconds: 450 },
    ],
    reprovisionCount: 0,
    spendAccruedUsd: 0,
    refreshPending: false,
    error: null,
    endedAt: null,
    ...overrides,
  };
}

describe("workshop domain", () => {
  it("seeds the configured number of stable, valid environments", () => {
    const first = seedEnvironments(now);
    const second = seedEnvironments(now);

    expect(first).toHaveLength(120);
    expect(first).toEqual(second);
    expect(new Set(first.map((item) => item.id)).size).toBe(120);
    expect(first.some((item) => item.state === "failed")).toBe(true);
    expect(first.every((item) => item.currentStep >= 0 && item.currentStep <= item.stepCount)).toBe(true);
  });

  it("seeds a stable time-on-step spread with a long stuck tail and real step history", () => {
    const first = seedEnvironments(now);
    const second = seedEnvironments(now);
    const active = first.filter((item) => item.state !== "failed" && item.state !== "deprovisioned");
    const ages = active.map((item) => toEnvironmentView(item, now).timeOnStepSeconds);

    expect(first).toEqual(second);
    expect(new Set(ages).size).toBeGreaterThan(20);
    expect(ages.some((age) => age < 120)).toBe(true);
    expect(ages.some((age) => age >= dashboardConfig.stuckThresholdSeconds * 3)).toBe(true);
    expect(active.some((item) => isStuck(item, now))).toBe(true);
    expect(first.every((item) => item.stepHistory.length === item.currentStep)).toBe(true);
  });

  it("calculates UTC runtime spend and detects a long-running step", () => {
    const item = environment();
    expect(calculateSpendUsd(item, now)).toBe(0.12);
    expect(isStuck(item, now)).toBe(true);
    expect(isStuck(environment({ stepStartedAt: "2026-11-12T05:55:00.000Z" }), now)).toBe(false);
  });

  it("keeps spend monotonic when a failed environment is reprovisioned", () => {
    const failed = environment({ state: "failed", endedAt: "2026-11-12T05:50:00.000Z", spendAccruedUsd: 0.3 });
    const before = calculateSpendUsd(failed, now);
    const result = transitionEnvironment(failed, "provisioning", now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calculateSpendUsd(result.environment, now)).toBeGreaterThanOrEqual(before);
  });

  it("aggregates learners and stuck learners by current step", () => {
    const rows = [
      environment({ id: "LAB-001", state: "in_use", currentStep: 3, stepStartedAt: "2026-11-12T05:20:00.000Z" }),
      environment({ id: "LAB-002", state: "ready", currentStep: 3, stepStartedAt: "2026-11-12T05:55:00.000Z" }),
      environment({ id: "LAB-003", state: "failed", currentStep: 2 }),
      environment({ id: "LAB-004", state: "deprovisioned", currentStep: 8 }),
    ];
    const result = buildStepDistribution(rows, now);
    expect(result).toHaveLength(8);
    expect(result[2]).toEqual({ step: 3, learners: 1, stuck: 0, typicalDurationSeconds: 450 });
    expect(result[3]).toEqual({ step: 4, learners: 2, stuck: 1, typicalDurationSeconds: null });
    expect(result[7]).toEqual({ step: 8, learners: 0, stuck: 0, typicalDurationSeconds: null });
  });

  it("reports the median completed duration for each step", () => {
    const rows = [
      environment({ id: "LAB-001", stepHistory: [{ stepIndex: 0, durationSeconds: 300 }] }),
      environment({ id: "LAB-002", stepHistory: [{ stepIndex: 0, durationSeconds: 500 }] }),
    ];

    expect(buildStepDistribution(rows, now)[0]?.typicalDurationSeconds).toBe(400);
  });

  it("describes the last event with an event reason, not the current state", () => {
    const failed = toEnvironmentView(environment({ state: "failed", error: "Deployment timed out" }), now);
    const active = toEnvironmentView(environment({ state: "in_use" }), now);
    expect(failed.lastEvent.description).toBe("Deployment timed out");
    expect(active.lastEvent.description).toBe("Started step 4");
  });

  it("serializes per-row elapsed time, spend, and completion on the server", () => {
    expect(toEnvironmentView(environment(), now)).toMatchObject({
      timeOnStepSeconds: 2_400,
      spendUsd: 0.12,
      completionPercent: 38,
    });
  });

  it("filters and sorts server-side candidate rows", () => {
    const rows = [
      environment({ id: "b", learnerName: "Bea Li", state: "ready", currentStep: 2, stepStartedAt: "2026-11-12T05:55:00.000Z" }),
      environment({ id: "a", learnerName: "Ari Jones", state: "failed", currentStep: 1, error: "Quota exceeded" }),
      environment({ id: "c", learnerName: "Cal Reed", state: "in_use", currentStep: 4, stepStartedAt: "2026-11-12T05:30:00.000Z" }),
    ];

    expect(filterEnvironments(rows, { state: "failed", search: "ari", riskOnly: false }, now).map((row) => row.id)).toEqual(["a"]);
    expect(filterEnvironments(rows, { state: "all", search: "", riskOnly: true }, now).map((row) => row.id)).toEqual(["a", "c"]);
    expect(filterEnvironments(rows, { state: "all", search: "", riskOnly: false, stuckOnly: true }, now).map((row) => row.id)).toEqual(["c"]);
    expect(filterEnvironments(rows, { state: "all", search: "", riskOnly: false, step: 5 }, now).map((row) => row.id)).toEqual(["c"]);
    expect(sortEnvironments(rows, "learner", "asc", now).map((row) => row.learnerName)).toEqual(["Ari Jones", "Bea Li", "Cal Reed"]);
    expect(sortEnvironments(rows, "spend", "desc", now)[0]?.id).toBe("a");
  });

  it("sorts failed rows first, stuck rows second, and other states after them", () => {
    const rows = [
      environment({ id: "ready", state: "ready", stepStartedAt: "2026-11-12T05:55:00.000Z" }),
      environment({ id: "stuck", state: "in_use", stepStartedAt: "2026-11-12T05:30:00.000Z" }),
      environment({ id: "failed", state: "failed", stepStartedAt: "2026-11-12T05:55:00.000Z" }),
    ];

    expect(sortEnvironments(rows, "severity", "asc", now).map((row) => row.id)).toEqual(["failed", "stuck", "ready"]);
  });

  it("aggregates summary counts, completion and spend", () => {
    const rows = [
      environment({ state: "in_use", currentStep: 4 }),
      environment({ id: "ready", state: "ready", currentStep: 2, startedAt: "2026-11-12T05:30:00.000Z", stepStartedAt: "2026-11-12T05:55:00.000Z" }),
      environment({ id: "failed", state: "failed", currentStep: 1, startedAt: "2026-11-12T05:30:00.000Z" }),
      environment({ id: "done", state: "deprovisioned", currentStep: 8, startedAt: "2026-11-12T05:30:00.000Z" }),
    ];

    expect(buildSessionSummary(rows, now)).toEqual({
      total: 4,
      active: 2,
      failed: 1,
      stuck: 1,
      completed: 1,
      stateCounts: { provisioning: 0, ready: 1, in_use: 1, failed: 1, deprovisioned: 1 },
      steps: [
        { step: 1, learners: 0, stuck: 0, typicalDurationSeconds: 480 },
        { step: 2, learners: 1, stuck: 0, typicalDurationSeconds: 510 },
        { step: 3, learners: 1, stuck: 0, typicalDurationSeconds: 450 },
        { step: 4, learners: 0, stuck: 0, typicalDurationSeconds: null },
        { step: 5, learners: 1, stuck: 1, typicalDurationSeconds: null },
        { step: 6, learners: 0, stuck: 0, typicalDurationSeconds: null },
        { step: 7, learners: 0, stuck: 0, typicalDurationSeconds: null },
        { step: 8, learners: 0, stuck: 0, typicalDurationSeconds: null },
      ],
      averageCompletionPercent: 47,
      spendUsd: 0.3,
      updatedAt: now.toISOString(),
    });
  });

  it("allows a retry from failed, treats the repeated retry as a no-op, and rejects other transitions", () => {
    const failed = environment({ state: "failed", error: "Quota exceeded" });
    const retried = transitionEnvironment(failed, "provisioning", now);

    expect(retried).toEqual({
      ok: true,
      changed: true,
      environment: expect.objectContaining({ state: "provisioning", error: null, stepStartedAt: now.toISOString(), stepHistory: [], reprovisionCount: 1 }),
    });
    expect(transitionEnvironment(retried.ok ? retried.environment : failed, "provisioning", now)).toEqual({
      ok: true,
      changed: false,
      environment: retried.ok ? retried.environment : failed,
    });
    expect(transitionEnvironment(environment({ state: "ready" }), "failed", now)).toEqual({ ok: false, reason: "conflict" });
  });

  it("advances the simulated environment on explicit ticks without mutating the input", () => {
    const original = environment({ state: "provisioning", currentStep: 0, stepHistory: [], stepStartedAt: "2026-11-12T05:00:00.000Z" });
    const updated = advanceEnvironment(original, now, 4);

    expect(updated).not.toBe(original);
    expect(original.state).toBe("provisioning");
    expect(updated.state).toBe("ready");
    expect(updated.currentStep).toBe(1);
    expect(updated.stepStartedAt).toBe(now.toISOString());
    expect(updated.stepHistory).toEqual([{ stepIndex: 0, durationSeconds: 3_600 }]);
  });

  it("holds a stuck step until a scheduled recovery tick, then records its duration", () => {
    const stuck = environment({ stepStartedAt: "2026-11-12T05:30:00.000Z" });
    const waiting = advanceEnvironment(stuck, now, 1);
    const recovered = advanceEnvironment(stuck, now, dashboardConfig.stuckRecoveryTickModulo);

    expect(waiting).toBe(stuck);
    expect(recovered).not.toBe(stuck);
    expect(recovered.currentStep).toBe(stuck.currentStep + 1);
    expect(recovered.stepHistory.at(-1)).toEqual({ stepIndex: stuck.currentStep, durationSeconds: 1_800 });
  });

  it("refreshes two staggered in-use environments into provisioning without advancing progress", () => {
    const original = {
      ...environment({
        state: "in_use",
        currentStep: 4,
        stepHistory: [{ stepIndex: 0, durationSeconds: 420 }],
        stepStartedAt: new Date(now.getTime() - dashboardConfig.stepAdvanceAfterSeconds * 1_000).toISOString(),
      }),
      id: "LAB-032",
    };
    const refreshed = advanceEnvironment(original, now, 1);

    expect(refreshed).toMatchObject({
      state: "provisioning",
      currentStep: 5,
      stepHistory: [
        { stepIndex: 0, durationSeconds: 420 },
        { stepIndex: 4, durationSeconds: dashboardConfig.stepAdvanceAfterSeconds },
      ],
      stepStartedAt: now.toISOString(),
      refreshPending: true,
    });
  });

  it("cycles scheduled in-use environments through provisioning without resetting step time", () => {
    const stepStartedAt = new Date(now.getTime() - 60_000).toISOString();
    const original = {
      ...environment({
        state: "in_use",
        currentStep: 3,
        stepHistory: [{ stepIndex: 0, durationSeconds: 420 }],
        stepStartedAt,
      }),
      id: "LAB-002",
    };
    const refreshed = advanceEnvironment(original, now, 1);

    expect(refreshed).toMatchObject({
      state: "provisioning",
      currentStep: 3,
      stepHistory: original.stepHistory,
      stepStartedAt,
      refreshPending: true,
    });
  });

  it("holds selected step completions until they become stuck and recover", () => {
    const original = environment({
      id: "LAB-001",
      state: "in_use",
      currentStep: 0,
      stepHistory: [],
      stepStartedAt: new Date(now.getTime() - dashboardConfig.stepAdvanceAfterSeconds * 1_000).toISOString(),
    });
    const held = advanceEnvironment(original, now, 1);
    const stuck = { ...original, stepStartedAt: new Date(now.getTime() - (dashboardConfig.stuckThresholdSeconds + dashboardConfig.stuckMinimumVisibleSeconds) * 1_000).toISOString() };
    const waiting = advanceEnvironment(stuck, now, 1);
    const recovered = advanceEnvironment(stuck, now, dashboardConfig.stuckRecoveryTickModulo);

    expect(held).toBe(original);
    expect(isStuck(waiting, now)).toBe(true);
    expect(recovered).toMatchObject({ state: "provisioning", currentStep: 1, refreshPending: true });
  });

  it("returns a refreshed environment to ready without completing another step", () => {
    const original = {
      ...environment({ state: "provisioning", currentStep: 3, stepHistory: [{ stepIndex: 0, durationSeconds: 420 }] }),
      refreshPending: true,
    } as Environment;
    const ready = advanceEnvironment(original, now, dashboardConfig.provisioningReadyTickModulo);

    expect(ready).toMatchObject({
      state: "ready",
      currentStep: 3,
      stepHistory: [{ stepIndex: 0, durationSeconds: 420 }],
      refreshPending: true,
    });
  });

  it("returns refreshed ready environments to in-use without resetting step time", () => {
    const original = {
      ...environment({ state: "ready", currentStep: 3, stepHistory: [{ stepIndex: 0, durationSeconds: 420 }] }),
      refreshPending: true,
    } as Environment;
    const inUse = advanceEnvironment(original, now, dashboardConfig.readyInUseTickModulo);

    expect(inUse).toMatchObject({
      state: "in_use",
      currentStep: 3,
      stepStartedAt: original.stepStartedAt,
      stepHistory: original.stepHistory,
      refreshPending: false,
    });
  });
});
