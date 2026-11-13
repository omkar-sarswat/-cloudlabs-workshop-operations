export const dashboardConfig = {
  appTitle: "Workshop operations",
  apiPort: 3001,
  webPort: 5173,
  environmentCount: 120,
  environmentIdDigits: 3,
  stepNames: [
    "Connect to the lab",
    "Open the portal",
    "Create a resource group",
    "Deploy the network",
    "Configure access",
    "Run the workload",
    "Check the results",
    "Complete the lab",
  ],
  stuckThresholdSeconds: 20 * 60,
  longProvisioningThresholdSeconds: 10 * 60,
  estimatedCostPerHourUsd: 0.12,
  seedRuntimeBaseSeconds: 10 * 60,
  seedRuntimeSpanSeconds: 70 * 60,
  seedRuntimeScatterMultiplier: 7919,
  seedFreshStepAgeBaseSeconds: 45,
  seedFreshStepAgeSpanSeconds: 14 * 60,
  seedFreshStepAgeScatterMultiplier: 7919,
  seedStuckOverageBaseSeconds: 60,
  seedStuckOverageSpanSeconds: 2 * 60 * 60,
  seedStuckAgeScatterMultiplier: 1543,
  seedCompletedStepDurationBaseSeconds: 6 * 60,
  seedCompletedStepDurationSpanSeconds: 7 * 60,
  seedCompletedStepScatterMultiplier: 1877,
  seedEndedAgeWindowMinutes: 12,
  seedStatusModulo: {
    failed: 17,
    deprovisioned: 23,
    provisioning: 7,
    ready: 5,
  },
  seedStuckModulo: 11,
  seedStuckRemainder: 3,
  // Hold each stuck learner for five minutes, then recover on a staggered five-minute schedule.
  stuckMinimumVisibleSeconds: 5 * 60,
  stuckRecoveryTickModulo: 60,
  stepAdvanceAfterSeconds: 8 * 60,
  // A deterministic share of learners stalls long enough to keep stuck work visible.
  simulatedStepStallRatePercent: 20,
  // Every unfinished step returns through provisioning and ready, so both states keep cycling.
  stepCompletionProvisioningRatePercent: 100,
  stepCompletionRateWindowTicks: 100,
  // Two additional in-use environments enter provisioning per five-second tick, spread by ID.
  inUseRefreshesPerTick: 2,
  simulationIntervalMs: 5_000,
  provisioningReadyTickModulo: 4,
  readyInUseTickModulo: 5,
  pollIntervalMs: 5_000,
  atRiskPollIntervalMs: 30_000,
  maxJsonBodyBytes: 8 * 1024,
  corsMaxAgeSeconds: 600,
  searchDebounceMs: 250,
  maxSearchLength: 80,
  maxFilterMinutes: 525_600,
  atRiskSummaryLimit: 5,
  atRiskScore: { failed: 100, stuck: 50, slowProvisioning: 25 },
  maxLearnerNameLength: 100,
  maxLearnerEmailLength: 150,
  maxLabNameLength: 100,
  maxIssueLength: 300,
  maxRiskReasons: 3,
  recordingDurationSeconds: 75,
} as const;

export const environmentStates = [
  "provisioning",
  "ready",
  "in_use",
  "failed",
  "deprovisioned",
] as const;

export const labNames = [
  "Cloud networking",
  "Identity and access",
  "Deploy a web app",
  "Secure storage",
] as const;

export const failureReasons = [
  "Deployment timed out",
  "Quota limit reached",
  "Network rule validation failed",
  "Credential check failed",
] as const;

export type EnvironmentState = (typeof environmentStates)[number];

export const statePriority: Record<EnvironmentState, number> = {
  failed: 0,
  provisioning: 1,
  in_use: 2,
  ready: 3,
  deprovisioned: 4,
};
