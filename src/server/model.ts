import type { EnvironmentState } from "../shared/config.ts";

export interface CompletedStep {
  stepIndex: number;
  durationSeconds: number;
}

export interface Environment {
  id: string;
  learnerName: string;
  learnerEmail: string;
  labName: string;
  sku: string;
  hourlyRateUsd: number;
  state: EnvironmentState;
  startedAt: string;
  provisionedAt: string | null;
  stepStartedAt: string;
  currentStep: number;
  stepCount: number;
  stepHistory: CompletedStep[];
  reprovisionCount: number;
  spendAccruedUsd: number;
  refreshPending: boolean;
  error: string | null;
  endedAt: string | null;
}

export interface SessionSummary {
  total: number;
  active: number;
  failed: number;
  stuck: number;
  completed: number;
  stateCounts: Record<EnvironmentState, number>;
  steps: Array<{ step: number; learners: number; stuck: number; typicalDurationSeconds: number | null }>;
  averageCompletionPercent: number;
  spendUsd: number;
  updatedAt: string;
}

export interface EnvironmentView extends Environment {
  timeOnStepSeconds: number;
  spendUsd: number;
  completionPercent: number;
  priorityGroup: "failed" | "stuck" | "other";
  lastEvent: { description: string; at: string };
}
