import { dashboardConfig } from "../shared/config.ts";
import { advanceEnvironment } from "./domain.ts";
import type { Environment } from "./model.ts";

export interface DriftController {
  advance: () => number;
  start: (intervalMs?: number) => void;
  stop: () => void;
}

export function createDriftController(
  environments: Map<string, Environment>,
  now: () => Date = () => new Date(),
): DriftController {
  let tick = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const advance = (): number => {
    tick += 1;
    const currentTime = now();
    let changed = 0;
    for (const [id, environment] of environments) {
      const updated = advanceEnvironment(environment, currentTime, tick);
      if (updated !== environment) {
        environments.set(id, updated);
        changed += 1;
      }
    }
    return changed;
  };

  return {
    advance,
    start(intervalMs = dashboardConfig.simulationIntervalMs) {
      if (timer) return;
      timer = setInterval(advance, intervalMs);
      timer.unref();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
