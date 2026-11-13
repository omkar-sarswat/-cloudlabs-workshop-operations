import { describe, expect, it } from "vitest";
import { dashboardConfig } from "../shared/config.ts";
import { createDriftController } from "./drift.ts";
import { isStuck, seedEnvironments } from "./domain.ts";
import type { Environment } from "./model.ts";

function environment(state: Environment["state"] = "provisioning", stepStartedAt = "2026-11-12T05:00:00.000Z"): Environment {
  return {
    id: "LAB-004",
    learnerName: "Morgan Diaz 01",
    learnerEmail: "morgan.diaz+004@workshop.example",
    labName: "Cloud networking",
    sku: "network-standard",
    hourlyRateUsd: dashboardConfig.estimatedCostPerHourUsd,
    state,
    startedAt: "2026-11-12T05:00:00.000Z",
    provisionedAt: null,
    stepStartedAt,
    currentStep: 0,
    stepCount: 8,
    stepHistory: [],
    reprovisionCount: 0,
    spendAccruedUsd: 0,
    refreshPending: false,
    error: null,
    endedAt: null,
  };
}

describe("server drift", () => {
  it("updates the shared store on simulation ticks and reports changed rows", () => {
    const store = new Map([["LAB-001", { ...environment("provisioning", "2026-11-12T05:59:40.000Z"), id: "LAB-001" }]]);
    let currentTime = new Date("2026-11-12T06:00:00.000Z");
    const controller = createDriftController(store, () => currentTime);

    expect(controller.advance()).toBe(0);
    expect(store.get("LAB-001")?.state).toBe("provisioning");
    expect(controller.advance()).toBe(0);
    expect(controller.advance()).toBe(0);
    currentTime = new Date("2026-11-12T06:00:20.000Z");
    expect(controller.advance()).toBe(1);
    expect(store.get("LAB-001")).toMatchObject({
      state: "ready",
      currentStep: 1,
      stepStartedAt: currentTime.toISOString(),
      stepHistory: [{ stepIndex: 0, durationSeconds: 40 }],
    });
  });

  it("keeps a stuck row visible until a scheduled recovery tick", () => {
    const store = new Map([["LAB-004", environment("in_use")]]);
    let currentTime = new Date("2026-11-12T06:00:00.000Z");
    const controller = createDriftController(store, () => currentTime);

    expect(controller.advance()).toBe(0);
    expect(store.get("LAB-004")?.currentStep).toBe(0);
    const recoveryTick = dashboardConfig.stuckRecoveryTickModulo - 3;
    for (let tick = 2; tick < recoveryTick; tick += 1) {
      currentTime = new Date(currentTime.getTime() + 5_000);
      controller.advance();
    }
    currentTime = new Date(currentTime.getTime() + 5_000);
    expect(controller.advance()).toBe(1);
    expect(store.get("LAB-004")?.currentStep).toBe(1);
    expect(store.get("LAB-004")?.stepHistory).toHaveLength(1);
  });

  it("lets selected stalled steps become visible as stuck before recovering", () => {
    const currentTime = { value: new Date("2026-11-12T06:00:00.000Z") };
    const stepStartedAt = new Date(currentTime.value.getTime() - dashboardConfig.stepAdvanceAfterSeconds * 1_000).toISOString();
    const store = new Map([["LAB-004", environment("in_use", stepStartedAt)]]);
    const controller = createDriftController(store, () => currentTime.value);
    const ticksUntilStuck = Math.ceil(
      (dashboardConfig.stuckThresholdSeconds - dashboardConfig.stepAdvanceAfterSeconds)
      / (dashboardConfig.simulationIntervalMs / 1_000),
    );

    for (let tick = 1; tick <= ticksUntilStuck; tick += 1) {
      currentTime.value = new Date(currentTime.value.getTime() + dashboardConfig.simulationIntervalMs);
      controller.advance();
    }

    expect(isStuck(store.get("LAB-004")!, currentTime.value)).toBe(true);

    const visibleTicks = Math.ceil(dashboardConfig.stuckMinimumVisibleSeconds / (dashboardConfig.simulationIntervalMs / 1_000));
    let recoveryTick = ticksUntilStuck + visibleTicks;
    while ((recoveryTick + 3) % dashboardConfig.stuckRecoveryTickModulo !== 0) recoveryTick += 1;
    for (let tick = ticksUntilStuck + 1; tick < recoveryTick; tick += 1) {
      currentTime.value = new Date(currentTime.value.getTime() + dashboardConfig.simulationIntervalMs);
      controller.advance();
    }
    expect(isStuck(store.get("LAB-004")!, currentTime.value)).toBe(true);

    currentTime.value = new Date(currentTime.value.getTime() + dashboardConfig.simulationIntervalMs);
    controller.advance();
    expect(store.get("LAB-004")?.currentStep).toBe(1);
  });

  it("keeps provisioning and ready populated with a steady staggered refresh rate", () => {
    const currentTime = { value: new Date("2026-11-12T06:00:00.000Z") };
    const store = new Map(Array.from({ length: dashboardConfig.environmentCount }, (_, index) => {
      const id = "LAB-" + String(index + 1).padStart(3, "0");
      const phase = (index % (dashboardConfig.stepAdvanceAfterSeconds / (dashboardConfig.simulationIntervalMs / 1_000)))
        * (dashboardConfig.simulationIntervalMs / 1_000);
      const stepStartedAt = new Date(currentTime.value.getTime() - phase * 1_000).toISOString();
      return [id, { ...environment("in_use", stepStartedAt), id } satisfies Environment];
    }));
    const controller = createDriftController(store, () => currentTime.value);
    const zeroTicks = { provisioning: 0, ready: 0 };
    const maxZeroTicks = { provisioning: 0, ready: 0 };

    for (let tick = 1; tick <= 120; tick += 1) {
      currentTime.value = new Date(currentTime.value.getTime() + dashboardConfig.simulationIntervalMs);
      controller.advance();
      const counts = [...store.values()].reduce((result, item) => {
        result[item.state] += 1;
        return result;
      }, { provisioning: 0, ready: 0, in_use: 0, failed: 0, deprovisioned: 0 });
      for (const state of ["provisioning", "ready"] as const) {
        zeroTicks[state] = counts[state] === 0 ? zeroTicks[state] + 1 : 0;
        maxZeroTicks[state] = Math.max(maxZeroTicks[state], zeroTicks[state]);
      }
    }

    expect(maxZeroTicks.provisioning).toBeLessThanOrEqual(4);
    expect(maxZeroTicks.ready).toBeLessThanOrEqual(4);
  });

  it("does not leave the seeded session without stuck learners for long", () => {
    const currentTime = { value: new Date("2026-11-12T06:00:00.000Z") };
    const store = new Map(seedEnvironments(currentTime.value).map((item) => [item.id, item]));
    const controller = createDriftController(store, () => currentTime.value);
    let zeroTicks = 0;
    let maxZeroTicks = 0;

    for (let tick = 1; tick <= 1_200; tick += 1) {
      currentTime.value = new Date(currentTime.value.getTime() + dashboardConfig.simulationIntervalMs);
      controller.advance();
      const stuckCount = [...store.values()].filter((item) => isStuck(item, currentTime.value)).length;
      zeroTicks = stuckCount === 0 ? zeroTicks + 1 : 0;
      maxZeroTicks = Math.max(maxZeroTicks, zeroTicks);
    }

    expect(maxZeroTicks).toBeLessThanOrEqual(90);
  });

  it("keeps the seeded session cycling through provisioning and ready", () => {
    const currentTime = { value: new Date("2026-11-12T06:00:00.000Z") };
    const store = new Map(seedEnvironments(currentTime.value).map((item) => [item.id, item]));
    const controller = createDriftController(store, () => currentTime.value);
    const zeroTicks = { provisioning: 0, ready: 0 };
    const maxZeroTicks = { provisioning: 0, ready: 0 };

    for (let tick = 1; tick <= 300; tick += 1) {
      currentTime.value = new Date(currentTime.value.getTime() + dashboardConfig.simulationIntervalMs);
      controller.advance();
      const counts = [...store.values()].reduce((result, item) => {
        result[item.state] += 1;
        return result;
      }, { provisioning: 0, ready: 0, in_use: 0, failed: 0, deprovisioned: 0 });
      for (const state of ["provisioning", "ready"] as const) {
        zeroTicks[state] = counts[state] === 0 ? zeroTicks[state] + 1 : 0;
        maxZeroTicks[state] = Math.max(maxZeroTicks[state], zeroTicks[state]);
      }
    }

    expect(maxZeroTicks.provisioning).toBeLessThanOrEqual(4);
    expect(maxZeroTicks.ready).toBeLessThanOrEqual(4);
  });

  it("starts and stops its interval without changing failed rows", () => {
    const store = new Map([["LAB-004", environment("failed")]]);
    const controller = createDriftController(store, () => new Date("2026-11-12T06:00:00.000Z"));
    controller.start(1_000);
    controller.stop();
    expect(store.get("LAB-004")?.state).toBe("failed");
  });
});
