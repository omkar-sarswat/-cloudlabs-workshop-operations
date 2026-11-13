import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { dashboardConfig, environmentStates, labNames } from "../shared/config.ts";
import {
  aiFilterResponseSchema,
  atRiskResponseSchema,
  environmentIdSchema,
  environmentPageSchema,
  environmentQuerySchema,
  environmentSchema,
  problemDetailsSchema,
  sessionSummarySchema,
  transitionRequestSchema,
} from "../shared/contracts.ts";
import { defaultAiFilterService } from "./ai.ts";
import {
  buildSessionSummary,
  filterEnvironments,
  rankAtRiskEnvironments,
  sortEnvironments,
  toEnvironmentView,
  transitionEnvironment,
} from "./domain.ts";
import type { AtRiskEnvironment } from "./domain.ts";
import type { Environment } from "./model.ts";

export interface RiskRankingResult {
  items: AtRiskEnvironment[];
  source: "ai" | "rules";
}

type LegacyFilterCommand = {
  state: string;
  stuckOnly: boolean;
  search: string;
  step: number | null;
  source: "ai" | "model" | "rules";
  reason?: "not configured" | "timeout" | "invalid output" | "unavailable" | "cooling down";
};

type QueryFilterCommand = {
  query: Record<string, unknown>;
  source: "ai" | "model" | "rules";
  reason?: "not configured" | "timeout" | "invalid output" | "unavailable" | "cooling down";
};

export type FilterCommandParser = (command: string, clientKey?: string) => Promise<LegacyFilterCommand | QueryFilterCommand> | LegacyFilterCommand | QueryFilterCommand;

export type RiskRanker = (
  environments: Environment[],
  now: Date,
  limit: number,
) => Promise<RiskRankingResult>;

export interface ApiOptions {
  environments: Map<string, Environment>;
  now?: () => Date;
  riskRanker?: RiskRanker;
  filterParser?: FilterCommandParser;
  corsOrigins?: string[];
}

const problemTitles: Record<number, string> = {
  400: "Bad Request",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Content Too Large",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

function sendProblem(response: Response, status: number, detail: string, instance: string): void {
  const problem = problemDetailsSchema.parse({
    type: "about:blank",
    title: problemTitles[status] ?? "Request Failed",
    status,
    detail,
    instance,
  });
  response.status(status).setHeader("Content-Type", "application/problem+json").send(JSON.stringify(problem));
}

function sendValidated<T>(response: Response, schema: z.ZodType<T>, value: unknown): void {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    console.error("API response did not match its schema", parsed.error.issues);
    sendProblem(response, 500, "The server could not produce a valid response.", response.req.path);
    return;
  }
  response.json(parsed.data);
}

function createOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "CloudLabs Workshop Operations API",
      version: "1.0.0",
      description: "Environment state, learner progress, session totals, and at-risk ranking for the workshop dashboard.",
    },
    servers: [{ url: "/api" }],
    paths: {
      "/environments": {
        get: {
          summary: "List, filter, and sort lab environments",
          parameters: [
            { name: "state", in: "query", schema: { type: "string", enum: ["all", "provisioning", "ready", "in_use", "failed", "deprovisioned"] } },
            { name: "states", in: "query", schema: { type: "array", items: { type: "string", enum: environmentStates } } },
            { name: "q", in: "query", schema: { type: "string", maxLength: dashboardConfig.maxSearchLength } },
            { name: "minutesMin", in: "query", schema: { type: "integer", minimum: 0, maximum: dashboardConfig.maxFilterMinutes } },
            { name: "minutesMax", in: "query", schema: { type: "integer", minimum: 0, maximum: dashboardConfig.maxFilterMinutes } },
            { name: "failureReasonContains", in: "query", schema: { type: "string", maxLength: dashboardConfig.maxIssueLength } },
            { name: "lab", in: "query", schema: { type: "string", enum: labNames } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["severity", "learner", "state", "step", "time", "spend"] } },
            { name: "direction", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
            { name: "riskOnly", in: "query", schema: { type: "boolean" } },
            { name: "stuckOnly", in: "query", schema: { type: "boolean" } },
            { name: "step", in: "query", schema: { type: "integer", minimum: 1, maximum: dashboardConfig.stepNames.length } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
            { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: dashboardConfig.environmentCount } },
          ],
          responses: { "200": { description: "The requested environment page." }, "400": { $ref: "#/components/responses/Problem" } },
        },
      },
      "/environments/{id}": {
        patch: {
          summary: "Request a valid state transition",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: `^LAB-[0-9]{${dashboardConfig.environmentIdDigits}}$` } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/TransitionRequest" } } },
          },
          responses: {
            "200": { description: "The environment after the transition." },
            "400": { $ref: "#/components/responses/Problem" },
            "404": { $ref: "#/components/responses/Problem" },
            "409": { $ref: "#/components/responses/Problem" },
          },
        },
      },
      "/session-summary": {
        get: { summary: "Read session totals and estimated spend", responses: { "200": { description: "Current session summary." } } },
      },
      "/ai/filter": {
        post: {
          summary: "Parse a natural-language environment filter",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["command"], properties: { command: { type: "string" } } } } } },
          responses: { "200": { description: "Parsed filter state with the parsing source." } },
        },
      },
      "/ai/at-risk": {
        get: { summary: "Rank environments at risk of delay or failure", responses: { "200": { description: "AI-ranked or deterministic at-risk environments." } } },
      },
      "/openapi.json": { get: { summary: "Read this OpenAPI document", responses: { "200": { description: "OpenAPI 3.1 document." } } } },
    },
    components: {
      schemas: {
        TransitionRequest: { type: "object", additionalProperties: false, required: ["state"], properties: { state: { type: "string", enum: ["provisioning", "ready", "in_use", "failed", "deprovisioned"] } } },
        Problem: { type: "object", required: ["type", "title", "status", "detail", "instance"], properties: { type: { type: "string", format: "uri" }, title: { type: "string" }, status: { type: "integer" }, detail: { type: "string" }, instance: { type: "string" } } },
      },
      responses: { Problem: { description: "RFC 9457 problem details.", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } } },
    },
  };
}

export function createApi(options: ApiOptions): Express {
  const app = express();
  const now = options.now ?? (() => new Date());
  const defaultOrigins = [`http://127.0.0.1:${dashboardConfig.webPort}`, `http://localhost:${dashboardConfig.webPort}`];
  const allowedOrigins = new Set(options.corsOrigins ?? process.env.CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? defaultOrigins);
  const rateLimitWindowMs = 60_000;
  const rateLimitMaxRequests = 20;
  const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
  const aiFilterService = options.filterParser ? null : defaultAiFilterService();

  const getClientKey = (request: Request): string => {
    const forwarded = request.get("x-forwarded-for") ?? request.get("x-real-ip") ?? request.ip ?? "unknown";
    return forwarded.split(",")[0].trim() || "unknown";
  };

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const origin = request.get("origin");
    if (origin) {
      if (!allowedOrigins.has(origin)) {
        sendProblem(response, 403, "This origin is not allowed to access the workshop API.", request.path);
        return;
      }
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Methods", "GET, PATCH, POST, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Access-Control-Max-Age", String(dashboardConfig.corsMaxAgeSeconds));
    }
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: dashboardConfig.maxJsonBodyBytes, strict: true }));

  app.get("/api/environments", (request, response) => {
    const query = environmentQuerySchema.safeParse(request.query);
    if (!query.success) {
      sendProblem(response, 400, "One or more query parameters are invalid.", request.path);
      return;
    }
    const currentTime = now();
    const filters = {
      state: query.data.state,
      states: query.data.states,
      search: query.data.q,
      riskOnly: query.data.riskOnly,
      stuckOnly: query.data.stuckOnly,
      step: query.data.step,
      minutesOnStep: query.data.minutesMin === undefined && query.data.minutesMax === undefined
        ? undefined
        : { min: query.data.minutesMin, max: query.data.minutesMax },
      failureReasonContains: query.data.failureReasonContains,
      lab: query.data.lab,
    };
    const matching = sortEnvironments(
      filterEnvironments([...options.environments.values()], filters, currentTime),
      query.data.sort,
      query.data.direction,
      currentTime,
    );
    const start = (query.data.page - 1) * query.data.pageSize;
    const items = matching.slice(start, start + query.data.pageSize).map((environment) => toEnvironmentView(environment, currentTime));
    sendValidated(response, environmentPageSchema, {
      items,
      total: matching.length,
      page: query.data.page,
      pageSize: query.data.pageSize,
      groups: {
        failed: items.filter((environment) => environment.priorityGroup === "failed").length,
        stuck: items.filter((environment) => environment.priorityGroup === "stuck").length,
        other: items.filter((environment) => environment.priorityGroup === "other").length,
      },
      updatedAt: currentTime.toISOString(),
    });
  });

  app.get("/api/session-summary", (_request, response) => {
    const currentTime = now();
    sendValidated(response, sessionSummarySchema, buildSessionSummary([...options.environments.values()], currentTime));
  });

  app.patch("/api/environments/:id", (request, response) => {
    const id = environmentIdSchema.safeParse(request.params.id);
    if (!id.success) {
      sendProblem(response, 400, "The environment ID is invalid.", request.path);
      return;
    }
    const body = transitionRequestSchema.safeParse(request.body);
    if (!body.success) {
      sendProblem(response, 400, "The transition request must contain a valid state.", request.path);
      return;
    }
    const environment = options.environments.get(id.data);
    if (!environment) {
      sendProblem(response, 404, "The requested environment does not exist.", request.path);
      return;
    }
    const currentTime = now();
    const transition = transitionEnvironment(environment, body.data.state, currentTime);
    if (!transition.ok) {
      sendProblem(response, 409, "The requested state transition is not allowed.", request.path);
      return;
    }
    if (transition.changed) options.environments.set(id.data, transition.environment);
    sendValidated(response, environmentSchema, toEnvironmentView(transition.environment, currentTime));
  });

  app.post("/api/ai/filter", async (request, response, next) => {
    const body = z.object({ command: z.string().trim().min(1).max(dashboardConfig.maxSearchLength) }).safeParse(request.body);
    if (!body.success) {
      sendProblem(response, 400, "The filter command must be a non-empty string within the supported length.", request.path);
      return;
    }

    const clientKey = getClientKey(request);
    const nowMs = Date.now();
    const bucket = rateLimitBuckets.get(clientKey);
    if (bucket) {
      if (bucket.resetAt <= nowMs) {
        rateLimitBuckets.delete(clientKey);
      } else if (bucket.count >= rateLimitMaxRequests) {
        sendProblem(response, 429, "Too many requests. Please try again in a moment.", request.path);
        return;
      }
    }
    if (!rateLimitBuckets.has(clientKey)) {
      rateLimitBuckets.set(clientKey, { count: 1, resetAt: nowMs + rateLimitWindowMs });
    } else {
      const current = rateLimitBuckets.get(clientKey)!;
      current.count += 1;
    }

    try {
      const result = options.filterParser
        ? await options.filterParser(body.data.command, clientKey)
        : await aiFilterService!.parse(body.data.command, clientKey);
      const isQueryResult = "query" in result;
      const source = result.source === "ai" ? "model" : result.source;
      const responseBody = isQueryResult
        ? {
            source,
            ...(result.reason ? { reason: result.reason } : {}),
            query: result.query,
          }
        : {
            source,
            ...(result.reason ? { reason: result.reason } : {}),
            state: result.state ?? "all",
            stuckOnly: result.stuckOnly ?? false,
            search: result.search ?? "",
            step: result.step ?? null,
          };

      const parsed = aiFilterResponseSchema.safeParse(responseBody);
      if (!parsed.success) {
        sendProblem(response, 500, "The server could not produce a valid filter response.", request.path);
        return;
      }

      response.json(parsed.data);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/ai/at-risk", async (_request, response, next) => {
    const currentTime = now();
    try {
      const result = options.riskRanker
        ? await options.riskRanker([...options.environments.values()], currentTime, dashboardConfig.atRiskSummaryLimit)
        : {
            items: rankAtRiskEnvironments([...options.environments.values()], currentTime, dashboardConfig.atRiskSummaryLimit),
            source: "rules" as const,
          };
      const items = result.items.flatMap((item) => {
        const environment = options.environments.get(item.id);
        return environment ? [{ ...item, learnerName: environment.learnerName, state: environment.state }] : [];
      });
      sendValidated(response, atRiskResponseSchema, { ...result, items, updatedAt: currentTime.toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/openapi.json", (_request, response) => response.json(createOpenApiDocument()));

  app.use("/api", (request, response) => {
    sendProblem(response, 404, "No API route matches this request.", request.path);
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    const details = error as { status?: number; type?: string };
    if (details.type === "entity.parse.failed" || details.status === 400) {
      sendProblem(response, 400, "The request body contains invalid JSON or fields.", request.path);
      return;
    }
    if (details.type === "entity.too.large" || details.status === 413) {
      sendProblem(response, 413, "The request body is too large.", request.path);
      return;
    }
    console.error("Unhandled workshop API error", error);
    sendProblem(response, 500, "An unexpected server error occurred.", request.path);
  });

  return app;
}

