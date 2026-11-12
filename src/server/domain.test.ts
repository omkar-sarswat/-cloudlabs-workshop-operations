import { describe, expect, it } from "vitest";
import {
  advanceEnvironment,
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

const now = new Date("2026-11-12T06:00:00.000Z");

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "lab-001",
    learnerName: "Avery Kim",
    learnerEmail: "avery.kim@example.test",
    labName: "Cloud networking",
    state: "in_use",
    startedAt: new Date("2026-11-12T05:00:00.000Z").toISOString(),
    stepStartedAt: new Date("2026-11-12T05:20:00.000Z").toISOString(),
    currentStep: 3,
    stepCount: 8,
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

  it("calculates UTC runtime spend and detects a long-running step", () => {
    const item = environment();
    expect(calculateSpendUsd(item, now)).toBe(0.12);
    expect(isStuck(item, now)).toBe(true);
    expect(isStuck(environment({ stepStartedAt: "2026-11-12T05:55:00.000Z" }), now)).toBe(false);
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
    expect(sortEnvironments(rows, "learner", "asc", now).map((row) => row.learnerName)).toEqual(["Ari Jones", "Bea Li", "Cal Reed"]);
    expect(sortEnvironments(rows, "spend", "desc", now)[0]?.id).toBe("a");
  });

  it("aggregates summary counts, completion and spend", () => {
    const rows = [
      environment({ state: "in_use", currentStep: 4 }),
      environment({ id: "ready", state: "ready", currentStep: 2, startedAt: "2026-11-12T05:30:00.000Z" }),
      environment({ id: "failed", state: "failed", currentStep: 1, startedAt: "2026-11-12T05:30:00.000Z" }),
      environment({ id: "done", state: "deprovisioned", currentStep: 8, startedAt: "2026-11-12T05:30:00.000Z" }),
    ];

    expect(buildSessionSummary(rows, now)).toEqual({
      total: 4,
      active: 2,
      failed: 1,
      completed: 1,
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
      environment: expect.objectContaining({ state: "provisioning", error: null, stepStartedAt: now.toISOString() }),
    });
    expect(transitionEnvironment(retried.ok ? retried.environment : failed, "provisioning", now)).toEqual({
      ok: true,
      changed: false,
      environment: retried.ok ? retried.environment : failed,
    });
    expect(transitionEnvironment(environment({ state: "ready" }), "failed", now)).toEqual({ ok: false, reason: "conflict" });
  });

  it("advances the simulated environment on explicit ticks without mutating the input", () => {
    const original = environment({ state: "provisioning", currentStep: 0, stepStartedAt: "2026-11-12T05:00:00.000Z" });
    const updated = advanceEnvironment(original, now, 4);

    expect(updated).not.toBe(original);
    expect(original.state).toBe("provisioning");
    expect(updated.state).toBe("ready");
    expect(updated.currentStep).toBe(1);
    expect(updated.stepStartedAt).toBe(now.toISOString());
  });
});
