import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createApi } from "./api.ts";
import type { Environment } from "./model.ts";

const now = new Date("2026-11-12T06:00:00.000Z");
const servers: Server[] = [];

function row(id: string, state: Environment["state"] = "in_use"): Environment {
  return {
    id,
    learnerName: `Learner ${id}`,
    learnerEmail: `${id.toLowerCase()}@example.test`,
    labName: "Cloud networking",
    state,
    startedAt: "2026-11-12T05:00:00.000Z",
    stepStartedAt: "2026-11-12T05:55:00.000Z",
    currentStep: 3,
    stepCount: 8,
    error: state === "failed" ? "Quota limit reached" : null,
    endedAt: null,
  };
}

async function startApi(rows = [row("LAB-001", "failed"), row("LAB-002", "ready")]) {
  const app = createApi({
    environments: new Map(rows.map((item) => [item.id, item])),
    now: () => now,
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
    const summary = await summaryResponse.json() as { total: number; active: number; failed: number };
    const openApi = await openApiResponse.json() as { openapi: string; paths: Record<string, unknown> };

    expect(summary).toMatchObject({ total: 2, active: 1, failed: 1 });
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
    const body = await response.json() as { source: string; items: Array<{ id: string; reasons: string[] }> };
    expect(response.status).toBe(200);
    expect(body.source).toBe("rules");
    expect(body.items[0]).toMatchObject({ id: "LAB-001", reasons: ["Quota limit reached"] });
  });
});
