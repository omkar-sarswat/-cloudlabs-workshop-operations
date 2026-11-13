import { afterEach, describe, expect, it, vi } from "vitest";
import { AiFilterService, GeminiAiFilterAdapter, normalizeModelQuery, OllamaAiFilterAdapter, type AiFilterAdapter } from "./ai.ts";
import { parseRulesFilterText } from "../shared/filter-query.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiFilterService", () => {
  it("falls back to rules when no provider is configured", async () => {
    const service = new AiFilterService(parseRulesFilterText, null, 250, 50, 3);
    const result = await service.parse("failed labs with quota errors", "no-provider");

    expect(result).toMatchObject({
      source: "rules",
      reason: "not configured",
      query: { states: ["failed"] },
    });
  });

  it("returns invalid output when the model JSON is malformed", async () => {
    const adapter: AiFilterAdapter = { complete: async () => "{not json" };
    const service = new AiFilterService(parseRulesFilterText, adapter, 250, 50, 3);

    const result = await service.parse("failed labs with quota errors", "bad-json");

    expect(result.source).toBe("rules");
    expect(result.reason).toBe("invalid output");
  });

  it("supports valid JSON wrapped in code fences", async () => {
    const adapter: AiFilterAdapter = { complete: async () => "```json\n{\"states\":[\"failed\"],\"search\":\"quota\"}\n```" };
    const service = new AiFilterService(parseRulesFilterText, adapter, 250, 50, 3);

    const result = await service.parse("failed labs with quota", "json-fence");

    expect(result).toMatchObject({ source: "model", query: { states: ["failed"], search: "quota" } });
  });

  it("returns invalid output for an unknown enum or wrong types", async () => {
    const adapter: AiFilterAdapter = { complete: async () => JSON.stringify({ states: "failed", stuck: "yes", step: "4" }) };
    const service = new AiFilterService(parseRulesFilterText, adapter, 250, 50, 3);

    const result = await service.parse("failed labs", "wrong-types");

    expect(result.source).toBe("rules");
    expect(result.reason).toBe("invalid output");
  });

  it("drops unknown fields, clamps integer ranges, and rejects bad enum values", () => {
    expect(normalizeModelQuery({
      states: ["failed"],
      step: 99,
      minutesOnStep: { min: -5, max: 900_000 },
      madeUp: "ignored",
    })).toEqual({
      states: ["failed"],
      step: 8,
      minutesOnStep: { min: 0, max: 525_600 },
    });
    expect(normalizeModelQuery({ states: ["failed", "surprise"] })).toBeNull();
    expect(normalizeModelQuery({ step: "4" })).toBeNull();
    expect(normalizeModelQuery({ minutesOnStep: { min: "20" } })).toBeNull();
  });

  it("uses Gemini JSON schema output mode and falls back on a rejected key", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        generationConfig: { responseMimeType: string; responseSchema: { type: string }; temperature: number };
      };
      expect(String(_input)).toBe("https://provider.test/v1beta/models/gemini-test:generateContent");
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("invalid");
      expect(request.generationConfig).toMatchObject({
        responseMimeType: "application/json",
        responseSchema: { type: "object" },
        temperature: 0,
      });
      return new Response("unauthorized", { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GeminiAiFilterAdapter("invalid", "gemini-test", "https://provider.test");
    const service = new AiFilterService(parseRulesFilterText, adapter, 250, 50, 3);

    const result = await service.parse("failed environments", "gemini-401");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ source: "rules", reason: "unavailable", query: { states: ["failed"] } });
  });

  it("falls back when the provider address is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const service = new AiFilterService(
      parseRulesFilterText,
      new OllamaAiFilterAdapter("http://127.0.0.1:1", "missing-model"),
      250,
      50,
      3,
    );

    const result = await service.parse("failed environments", "ollama-unreachable");

    expect(result).toMatchObject({ source: "rules", reason: "unavailable", query: { states: ["failed"] } });
  });

  it("uses Ollama schema-constrained output and falls back on non-success responses", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        format: { type: string; properties: Record<string, unknown> };
        messages: Array<{ role: string; content: string }>;
        stream: boolean;
      };
      expect(String(input)).toBe("http://ollama.test/api/chat");
      expect(request.format.type).toBe("object");
      expect(request.format.properties).toHaveProperty("states");
      expect(request.messages.map(({ role }) => role)).toEqual(["system", "user"]);
      expect(request.stream).toBe(false);
      return new Response("unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new AiFilterService(
      parseRulesFilterText,
      new OllamaAiFilterAdapter("http://ollama.test", "model"),
      250,
      50,
      3,
    );

    const result = await service.parse("failed environments", "ollama-503");

    expect(result).toMatchObject({ source: "rules", reason: "unavailable", query: { states: ["failed"] } });
  });

  it("falls back for a valid but empty model object", async () => {
    const adapter: AiFilterAdapter = { complete: async () => "{}" };
    const service = new AiFilterService(parseRulesFilterText, adapter, 250, 50, 3);
    const result = await service.parse("failed environments", "empty-output");

    expect(result).toMatchObject({ source: "rules", reason: "invalid output", query: { states: ["failed"] } });
  });

  it("returns unavailable when the provider throws", async () => {
    const adapter: AiFilterAdapter = { complete: async () => { throw new Error("boom"); } };
    const service = new AiFilterService(parseRulesFilterText, adapter, 250, 50, 3);

    const result = await service.parse("failed labs", "thrown");

    expect(result.source).toBe("rules");
    expect(result.reason).toBe("unavailable");
  });

  it("returns unavailable when the provider responds with a non-success status", async () => {
    const adapter: AiFilterAdapter = { complete: async () => { throw new Error("401 Unauthorized"); } };
    const service = new AiFilterService(parseRulesFilterText, adapter, 250, 50, 3);

    const result = await service.parse("failed labs", "bad-key");

    expect(result.source).toBe("rules");
    expect(result.reason).toBe("unavailable");
  });

  it("times out and falls back to the rules parser", async () => {
    const adapter: AiFilterAdapter = {
      complete: async (_text, signal) => new Promise<string>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")), { once: true });
      }),
    };
    const service = new AiFilterService(parseRulesFilterText, adapter, 20, 50, 3);

    const result = await service.parse("failed labs", "timeout");

    expect(result.source).toBe("rules");
    expect(result.reason).toBe("timeout");
  });

  it("handles a call that never returns by aborting and falling back", async () => {
    const adapter: AiFilterAdapter = {
      complete: async (_text, signal) => new Promise<string>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")), { once: true });
      }),
    };
    const service = new AiFilterService(parseRulesFilterText, adapter, 25, 50, 3);

    const result = await service.parse("stuck learners", "never-returns");

    expect(result.source).toBe("rules");
    expect(result.reason).toBe("timeout");
  });

  it("opens the circuit after repeated failures and skips model calls while cooling down", async () => {
    let calls = 0;
    const adapter: AiFilterAdapter = {
      complete: async () => {
        calls += 1;
        if (calls >= 3) {
          return JSON.stringify({ states: ["failed"] });
        }
        throw new Error("fail");
      },
    };
    const service = new AiFilterService(parseRulesFilterText, adapter, 25, 40, 2);

    await service.parse("failed labs", "circuit-1");
    await service.parse("failed labs", "circuit-1");
    const duringCooldown = await service.parse("failed labs", "circuit-1");

    expect(duringCooldown.source).toBe("rules");
    expect(duringCooldown.reason).toBe("cooling down");
    expect(calls).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 60));
    const recovered = await service.parse("failed labs", "circuit-1");

    expect(recovered.source).toBe("model");
    expect(calls).toBe(3);
  });
});
