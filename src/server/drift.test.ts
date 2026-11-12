import { describe, expect, it } from "vitest";
import { createDriftController } from "./drift.ts";
import type { Environment } from "./model.ts";

function environment(state: Environment["state"] = "provisioning"): Environment {
  return {
    id: "LAB-004",
    learnerName: "Morgan Diaz 01",
    learnerEmail: "morgan.diaz+004@workshop.example",
    labName: "Cloud networking",
    state,
    startedAt: "2026-11-12T05:00:00.000Z",
    stepStartedAt: "2026-11-12T05:00:00.000Z",
    currentStep: 0,
    stepCount: 8,
    error: null,
    endedAt: null,
  };
}

describe("server drift", () => {
  it("updates the shared store on simulation ticks and reports changed rows", () => {
    const store = new Map([["LAB-004", environment()]]);
    let currentTime = new Date("2026-11-12T06:00:00.000Z");
    const controller = createDriftController(store, () => currentTime);

    expect(controller.advance()).toBe(0);
    expect(store.get("LAB-004")?.state).toBe("provisioning");
    expect(controller.advance()).toBe(0);
    expect(controller.advance()).toBe(0);
    currentTime = new Date("2026-11-12T06:00:20.000Z");
    expect(controller.advance()).toBe(1);
    expect(store.get("LAB-004")).toMatchObject({ state: "ready", currentStep: 1, stepStartedAt: currentTime.toISOString() });
  });

  it("starts and stops its interval without changing failed rows", () => {
    const store = new Map([["LAB-004", environment("failed")]]);
    const controller = createDriftController(store, () => new Date("2026-11-12T06:00:00.000Z"));
    controller.start(1_000);
    controller.stop();
    expect(store.get("LAB-004")?.state).toBe("failed");
  });
});
