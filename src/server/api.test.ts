import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { dashboardConfig } from "../shared/config.ts";
import { createApi } from "./api.ts";
import type { Environment } from "./model.ts";

const now = new Date("2026-11-12T06:00:00.000Z");
const servers: Server[] = [];

function row(
  id: string,
  state: Environment["state"] = "in_use",
  stepStartedAt = "2026-11-12T05:55:00.000Z",
): Environment {
  return {
    id,
    learnerName: `Learner ${id}`,
    learnerEmail: `${id.toLowerCase()}@example.test`,
    labName: "Cloud networking",
    sku: "network-standard",
    hourlyRateUsd: 0.12,
    state,
    startedAt: "2026-11-12T05:00:00.000Z",
    provisionedAt: "2026-11-12T05:01:00.000Z",
    stepStartedAt,
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
    error: state === "failed" ? "Quota limit reached" : null,
    endedAt: null,
  };
}

type LegacyFilterResult = {
  state: string;
  stuckOnly: boolean;
  search: string;
  step: number | null;
  source: "ai" | "rules" | "model";
  reason?: "not configured" | "timeout" | "invalid output" | "unavailable" | "cooling down";
};

type QueryFilterResult = {
  query: { states?: string[]; search?: string; [key: string]: unknown };
  source: "ai" | "rules" | "model";
  reason?: "not configured" | "timeout" | "invalid output" | "unavailable" | "cooling down";
};

async function startApi(rows = [row("LAB-001", "failed"), row("LAB-002", "ready")], filterParser?: (command: string) => Promise<LegacyFilterResult | QueryFilterResult> | LegacyFilterResult | QueryFilterResult) {
  const app = createApi({
    environments: new Map(rows.map((item) => [item.id, item])),
    now: () => now,
    filterParser,
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("workshop REST API", () => {
  it("serves validated, filtered, and sorted environment rows", async () => {
    const base = await startApi();
    const response = await fetch(`${base}/api/environments?state=failed&q=quota&sort=learner&direction=asc`);
    const body = await response.json() as { items: Environment[]; total: number; updatedAt: string };

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items[0]?.id).toBe("LAB-001");
    expect(body.updatedAt).toBe(now.toISOString());
  });

  it("filters stuck rows only and accepts severity sorting", async () => {
    const base = await startApi([
      row("LAB-001", "in_use", "2026-11-12T05:20:00.000Z"),
      row("LAB-002", "in_use"),
      row("LAB-003", "failed"),
    ]);
    const response = await fetch(`${base}/api/environments?stuckOnly=true&sort=severity`);
    const body = await response.json() as { items: Environment[]; total: number };

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items.map((item) => item.id)).toEqual(["LAB-001"]);
  });

  it("returns server groups, step distribution, and filters a selected step", async () => {
    const base = await startApi([
      row("LAB-001", "failed"),
      row("LAB-002", "in_use", "2026-11-12T05:20:00.000Z"),
      row("LAB-003", "ready"),
    ]);
    const [allResponse, stepResponse, summaryResponse] = await Promise.all([
      fetch(`${base}/api/environments`),
      fetch(`${base}/api/environments?step=4`),
      fetch(`${base}/api/session-summary`),
    ]);
    const all = await allResponse.json() as {
      items: Array<{ id: string; priorityGroup: string; lastEvent: { description: string } }>;
      groups: { failed: number; stuck: number; other: number };
    };
    const selectedStep = await stepResponse.json() as { items: Array<{ id: string }>; total: number };
    const summary = await summaryResponse.json() as { steps: Array<{ step: number; learners: number; stuck: number; typicalDurationSeconds: number | null }> };
    expect(all.groups).toEqual({ failed: 1, stuck: 1, other: 1 });
    expect(all.items.map((item) => item.priorityGroup)).toEqual(["failed", "stuck", "other"]);
    expect(all.items[0]?.lastEvent.description).toBe("Quota limit reached");
    expect(selectedStep.items.map((item) => item.id)).toEqual(["LAB-001", "LAB-002", "LAB-003"]);
    expect(summary.steps[3]).toEqual({ step: 4, learners: 3, stuck: 1, typicalDurationSeconds: null });
  });

  it("applies structured AI filters against the real environment fields", async () => {
    const base = await startApi([
      row("LAB-001", "failed", "2026-11-12T05:20:00.000Z"),
      row("LAB-002", "failed", "2026-11-12T05:45:00.000Z"),
      row("LAB-003", "in_use", "2026-11-12T05:20:00.000Z"),
    ]);
    const response = await fetch(
      `${base}/api/environments?states=failed&minutesMin=20&minutesMax=40&failureReasonContains=Quota&lab=Cloud%20networking&sort=spend&direction=desc`,
    );
    const body = await response.json() as { items: Array<{ id: string }>; total: number };

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items.map(({ id }) => id)).toEqual(["LAB-001"]);
  });

  it("returns RFC 9457 problems for invalid query and malformed request bodies", async () => {
    const base = await startApi();
    const invalidQuery = await fetch(`${base}/api/environments?state=surprise`);
    const queryProblem = await invalidQuery.json() as { type: string; status: number; instance: string };
    expect(invalidQuery.status).toBe(400);
    expect(invalidQuery.headers.get("content-type")).toContain("application/problem+json");
    expect(queryProblem.type).toContain("about:blank");
    expect(queryProblem.status).toBe(400);
    expect(queryProblem.instance).toBe("/api/environments");

    const malformed = await fetch(`${base}/api/environments/LAB-002`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{bad json",
    });
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("content-type")).toContain("application/problem+json");
  });

  it("provides a session aggregate and an OpenAPI document", async () => {
    const base = await startApi();
    const [summaryResponse, openApiResponse] = await Promise.all([
      fetch(`${base}/api/session-summary`),
      fetch(`${base}/api/openapi.json`),
    ]);
    const summary = await summaryResponse.json() as {
      total: number;
      active: number;
      failed: number;
      stuck: number;
      stateCounts: Record<string, number>;
    };
    const openApi = await openApiResponse.json() as { openapi: string; paths: Record<string, unknown> };

    expect(summary).toMatchObject({
      total: 2,
      active: 1,
      failed: 1,
      stuck: 0,
      stateCounts: { provisioning: 0, ready: 1, in_use: 0, failed: 1, deprovisioned: 0 },
    });
    expect(openApi.openapi).toMatch(/^3\./);
    expect(openApi.paths).toHaveProperty("/environments/{id}");
    expect(openApi.paths).toHaveProperty("/ai/at-risk");
  });

  it("reprovisions a failed lab, is safe to repeat, and rejects invalid transitions", async () => {
    const base = await startApi();
    const request = () => fetch(`${base}/api/environments/LAB-001`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "provisioning" }),
    });
    const first = await request();
    const firstBody = await first.json() as { state: string; error: string | null };
    const repeated = await request();
    expect(first.status).toBe(200);
    expect(firstBody).toMatchObject({ state: "provisioning", error: null });
    expect(repeated.status).toBe(200);

    const conflict = await fetch(`${base}/api/environments/LAB-002`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "failed" }),
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as { status: number }).status).toBe(409);
  });

  it("reports missing records and unknown routes as problem details", async () => {
    const base = await startApi();
    const missing = await fetch(`${base}/api/environments/LAB-999`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "provisioning" }),
    });
    const unknown = await fetch(`${base}/api/not-a-route`);
    expect(missing.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toContain("application/problem+json");
  });

  it("serves deterministic at-risk results when no model ranker is configured", async () => {
    const base = await startApi([row("LAB-001", "failed"), row("LAB-002", "in_use")]);
    const response = await fetch(`${base}/api/ai/at-risk`);
    const body = await response.json() as { source: string; items: Array<{ id: string; learnerName: string; state: string; reasons: string[] }> };
    expect(response.status).toBe(200);
    expect(body.source).toBe("rules");
    expect(body.items[0]).toMatchObject({ id: "LAB-001", learnerName: "Learner LAB-001", state: "failed", reasons: ["Quota limit reached"] });
  });

  it("accepts an injected AI filter parser and returns the parsed model query", async () => {
    const base = await startApi([row("LAB-001", "failed"), row("LAB-002", "ready")], async () => ({
      query: {
        states: ["failed"],
        search: "quota",
      },
      source: "model",
    }));
    const response = await fetch(`${base}/api/ai/filter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "Show failed labs with quota" }),
    });

    const body = await response.json() as { query: { states?: string[]; search?: string }; source: string };
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ source: "model", query: { states: ["failed"], search: "quota" } });
  });

  it("returns the rules result and not-configured reason from the filter endpoint", async () => {
    const previousProvider = process.env.AI_FILTER_PROVIDER;
    const previousApiKey = process.env.AI_FILTER_API_KEY;
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    process.env.AI_FILTER_PROVIDER = "rules";
    delete process.env.AI_FILTER_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const base = await startApi();
      const response = await fetch(`${base}/api/ai/filter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "failed environments with quota errors" }),
      });
      const body = await response.json() as { source: string; reason?: string; query?: { states?: string[] } };

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ source: "rules", reason: "not configured", query: { states: ["failed"] } });
    } finally {
      if (previousProvider === undefined) delete process.env.AI_FILTER_PROVIDER;
      else process.env.AI_FILTER_PROVIDER = previousProvider;
      if (previousApiKey === undefined) delete process.env.AI_FILTER_API_KEY;
      else process.env.AI_FILTER_API_KEY = previousApiKey;
      if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousGeminiKey;
    }
  });

  it("returns the validated model query instead of rebuilding it with the rules parser", async () => {
    const base = await startApi(
      [row("LAB-001", "failed"), row("LAB-002", "ready")],
      async () => ({
        query: {
          states: ["ready"],
          search: "model-only",
        },
        source: "model",
      }),
    );

    const response = await fetch(`${base}/api/ai/filter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "failed labs with quota errors" }),
    });
    const body = await response.json() as { query?: { search?: string; states?: string[] }; source: string };

    expect(response.status).toBe(200);
    expect(body.source).toBe("model");
    expect(body.query).toMatchObject({ states: ["ready"], search: "model-only" });
  });

  it("rejects empty and overlong filter input with problem details", async () => {
    const base = await startApi();

    const empty = await fetch(`${base}/api/ai/filter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "   " }),
    });
    expect(empty.status).toBe(400);
    expect(empty.headers.get("content-type")).toContain("application/problem+json");

    const tooLong = "a".repeat(dashboardConfig.maxSearchLength + 1);
    const long = await fetch(`${base}/api/ai/filter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: tooLong }),
    });
    expect(long.status).toBe(400);
    expect(long.headers.get("content-type")).toContain("application/problem+json");
  });

  it("rate limits requests per client IP and returns problem details", async () => {
    const base = await startApi();
    const command = { command: "failed labs" };
    for (let index = 0; index < 21; index += 1) {
      const response = await fetch(`${base}/api/ai/filter`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.15" },
        body: JSON.stringify(command),
      });
      if (index < 20) {
        expect(response.status).toBe(200);
      } else {
        expect(response.status).toBe(429);
        expect(response.headers.get("content-type")).toContain("application/problem+json");
      }
    }
  });

  it("keeps different clients on separate rate-limit buckets", async () => {
    const base = await startApi();
    for (let index = 0; index < 20; index += 1) {
      const response = await fetch(`${base}/api/ai/filter`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.21" },
        body: JSON.stringify({ command: "failed labs" }),
      });
      expect(response.status).toBe(200);
    }
    const otherClient = await fetch(`${base}/api/ai/filter`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.22" },
      body: JSON.stringify({ command: "failed labs" }),
    });
    expect(otherClient.status).toBe(200);
  });
});
