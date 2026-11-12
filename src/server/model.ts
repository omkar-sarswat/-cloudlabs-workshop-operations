import type { EnvironmentState } from "../shared/config.ts";

export interface Environment {
  id: string;
  learnerName: string;
  learnerEmail: string;
  labName: string;
  state: EnvironmentState;
  startedAt: string;
  stepStartedAt: string;
  currentStep: number;
  stepCount: number;
  error: string | null;
  endedAt: string | null;
}

export interface SessionSummary {
  total: number;
  active: number;
  failed: number;
  completed: number;
  averageCompletionPercent: number;
  spendUsd: number;
  updatedAt: string;
}

export interface EnvironmentView extends Environment {
  timeOnStepSeconds: number;
  spendUsd: number;
  completionPercent: number;
}
