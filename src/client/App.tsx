import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  aiFilterResponseSchema,
  environmentPageSchema,
  environmentSchema,
  filterCommandSchema,
  sessionSummarySchema,
  type EnvironmentDto,
} from "../shared/contracts.ts";
import { dashboardConfig, type EnvironmentState } from "../shared/config.ts";
import { filterQuerySchema, parseRulesFilterText, type FilterQuery } from "../shared/filter-query.ts";
import type { SessionSummary } from "../server/model.ts";
import {
  ActionButton,
  DensityControl,
  FilterChip,
  IconButton,
  NameId,
  StatusLine,
  StatusMarker,
  StepMeter,
  TextInput,
  TimeOnStep,
  Tooltip,
  type MarkerKind,
} from "./atoms.tsx";

type ListStatus = "loading" | "ready" | "error";
type StateFilter = EnvironmentState | "all";

const stateLabels: Record<EnvironmentState, string> = {
  provisioning: "Provisioning",
  ready: "Ready",
  in_use: "In use",
  failed: "Failed",
  deprovisioned: "Deprovisioned",
};

function stateLabel(state: EnvironmentState): string {
  return stateLabels[state];
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total >= 3_600) {
    const hours = Math.floor(total / 3_600);
    const minutes = Math.floor((total % 3_600) / 60);
    return hours + "h " + minutes + "m";
  }
  const minutes = Math.floor(total / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return String(minutes).padStart(2, "0") + ":" + remainder;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function elapsedLabel(value: string | null, now: number): string {
  if (!value) return "Waiting for data";
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  if (seconds < 60) return "updated " + seconds + "s ago";
  if (seconds < 3600) return "updated " + Math.floor(seconds / 60) + "m ago";
  return "updated " + Math.floor(seconds / 3600) + "h ago";
}

function relativeTime(value: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  if (seconds < 60) return seconds + "s ago";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  return Math.floor(seconds / 3600) + "h ago";
}

function isStuck(environment: EnvironmentDto): boolean {
  return environment.state !== "failed"
    && environment.state !== "deprovisioned"
    && environment.timeOnStepSeconds >= dashboardConfig.stuckThresholdSeconds;
}

function statusMarker(environment: EnvironmentDto): MarkerKind | undefined {
  if (isStuck(environment)) return "stuck";
  if (environment.state === "failed") return "failed";
  if (environment.state === "provisioning") return "provisioning";
  return undefined;
}

function stepLabel(environment: EnvironmentDto): string {
  if (environment.currentStep >= environment.stepCount) return "Complete";
  const index = Math.min(environment.currentStep, environment.stepCount - 1);
  return "Step " + (index + 1) + " · " + (dashboardConfig.stepNames[index] ?? "Ready to start");
}

async function requestJson(url: string, init?: RequestInit): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(url, init);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

function problemDetail(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "detail" in body && typeof body.detail === "string") {
    return body.detail;
  }
  return fallback;
}

function lastEventLabel(environment: EnvironmentDto, now: number): string {
  const description = environment.lastEvent.description === "Network rule validation failed"
    ? "Network rule failed"
    : environment.lastEvent.description;
  return description + ", " + relativeTime(environment.lastEvent.at, now);
}

function lastEventDescription(environment: EnvironmentDto): string {
  return environment.lastEvent.description === "Network rule validation failed"
    ? "Network rule failed"
    : environment.lastEvent.description;
}

function runningLabel(environment: EnvironmentDto, now: number): string {
  const runtimeSeconds = Math.max(0, Math.floor((now - Date.parse(environment.startedAt)) / 1000));
  const minutes = Math.floor(runtimeSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function App() {
  const [environments, setEnvironments] = useState<EnvironmentDto[]>([]);
  const [groups, setGroups] = useState({ failed: 0, stuck: 0, other: 0 });
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [listError, setListError] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [total, setTotal] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [filterSource, setFilterSource] = useState<"ai" | "rules" | "model-unavailable">("rules");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedCommand, setParsedCommand] = useState<FilterQuery>(() => parseRulesFilterText(""));
  const [filterAnnouncement, setFilterAnnouncement] = useState("");
  const parseRequestIdRef = useRef(0);
  const parseAbortRef = useRef<AbortController | null>(null);
  const [stateChip, setStateChip] = useState<StateFilter>("all");
  const [stuckChip, setStuckChip] = useState(false);
  const [stepFilter, setStepFilter] = useState<number | null>(null);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [helpOpen, setHelpOpen] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [failedAnnouncement, setFailedAnnouncement] = useState("");
  const previousFailed = useRef<number | null>(null);
  const commandRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);

  const effectiveStates = useMemo(
    () => stateChip === "all" ? parsedCommand.states : [stateChip],
    [parsedCommand.states, stateChip],
  );
  const effectiveStuck = stuckChip || Boolean(parsedCommand.stuck);
  const effectiveStep = stepFilter ?? parsedCommand.step;
  const effectiveSearch = parsedCommand.search ?? "";
  const effectiveMinutes = parsedCommand.minutesOnStep;
  const effectiveFailureReason = parsedCommand.failureReasonContains;
  const effectiveLab = parsedCommand.lab;
  const effectiveSort = parsedCommand.sort ?? "severity";
  const effectiveDirection = parsedCommand.direction ?? "asc";
  const selected = environments.find((environment) => environment.id === selectedId) ?? null;

  const handleParse = useCallback(async (nextCommand: string) => {
    const trimmed = nextCommand.trim();
    if (!trimmed) {
      setIsParsing(false);
      setParsedCommand({});
      setFilterSource("rules");
      return;
    }

    const requestId = parseRequestIdRef.current + 1;
    parseRequestIdRef.current = requestId;
    parseAbortRef.current?.abort();
    const controller = new AbortController();
    parseAbortRef.current = controller;
    setIsParsing(true);

    try {
      const { response, body } = await requestJson("/api/ai/filter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: trimmed }),
        signal: controller.signal,
      });
      if (requestId !== parseRequestIdRef.current) return;
      if (!response.ok) throw new Error(problemDetail(body, "Filter parsing failed"));

      const parsedBody = aiFilterResponseSchema.parse(body);
      const parsed = "query" in parsedBody
        ? filterQuerySchema.parse(parsedBody.query)
        : (() => {
            const legacy = filterCommandSchema.parse(parsedBody);
            return {
              ...(legacy.state !== "all" ? { states: [legacy.state as EnvironmentState] } : {}),
              ...(legacy.stuckOnly ? { stuck: true } : {}),
              ...(legacy.step ? { step: legacy.step } : {}),
              ...(legacy.search ? { search: legacy.search } : {}),
            };
          })();
      setParsedCommand(parsed);

      const source = parsedBody.source === "model" || parsedBody.source === "ai"
        ? "ai"
        : (parsedBody.reason && parsedBody.reason !== "not configured" ? "model-unavailable" : "rules");
      setFilterSource(source);
    } catch {
      if (requestId !== parseRequestIdRef.current) return;
      setParsedCommand(parseRulesFilterText(trimmed));
      setFilterSource("rules");
    } finally {
      if (requestId === parseRequestIdRef.current) {
        setIsParsing(false);
        parseAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;

    const loadEnvironments = async () => {
      if (inFlight) return;
      inFlight = true;
      if (!hasLoadedRef.current) setStatus("loading");
      setListError(false);
      scrollPositionRef.current = hasLoadedRef.current ? (scrollRef.current?.scrollTop ?? 0) : 0;

      const parameters = new URLSearchParams({
        q: effectiveSearch,
        riskOnly: "false",
        stuckOnly: String(effectiveStuck),
        sort: effectiveSort,
        direction: effectiveDirection,
      });
      if (effectiveStates?.length) parameters.set("states", effectiveStates.join(","));
      if (effectiveStep) parameters.set("step", String(effectiveStep));
      if (effectiveMinutes?.min !== undefined) parameters.set("minutesMin", String(effectiveMinutes.min));
      if (effectiveMinutes?.max !== undefined) parameters.set("minutesMax", String(effectiveMinutes.max));
      if (effectiveFailureReason) parameters.set("failureReasonContains", effectiveFailureReason);
      if (effectiveLab) parameters.set("lab", effectiveLab);
      const mainResult = await requestJson("/api/environments?" + parameters.toString()).catch(() => null);
      if (!active) {
        inFlight = false;
        return;
      }

      try {
        if (!mainResult || !mainResult.response.ok) throw new Error(problemDetail(mainResult?.body, "Couldn't reach the server."));
        const page = environmentPageSchema.parse(mainResult.body);
        setEnvironments(page.items);
        setGroups(page.groups);
        setTotal(page.total);
        setUpdatedAt(page.updatedAt);
        setSelectedId((current) => current && page.items.some((item) => item.id === current) ? current : null);
        setActiveRowId((current) => current && page.items.some((item) => item.id === current) ? current : null);
        setStatus("ready");
        hasLoadedRef.current = true;
      } catch {
        if (!hasLoadedRef.current) setStatus("error");
        setListError(true);
      }

      inFlight = false;
    };

    void loadEnvironments();
    const interval = window.setInterval(() => void loadEnvironments(), dashboardConfig.pollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [effectiveStates, effectiveSearch, effectiveStuck, effectiveStep, effectiveMinutes, effectiveFailureReason, effectiveLab, effectiveSort, effectiveDirection, retryCount]);

  useLayoutEffect(() => {
    const position = scrollPositionRef.current;
    if (position !== null && scrollRef.current) {
      scrollRef.current.scrollTop = position;
      scrollPositionRef.current = null;
    }
  }, [environments]);

  useEffect(() => {
    let active = true;
    const loadSummary = async () => {
      try {
        const { response, body } = await requestJson("/api/session-summary");
        if (!response.ok) throw new Error("Summary unavailable");
        const value = sessionSummarySchema.parse(body);
        if (active) {
          setSummary(value);
          setSummaryError(false);
        }
      } catch {
        if (active) setSummaryError(true);
      }
    };
    void loadSummary();
    const interval = window.setInterval(() => void loadSummary(), dashboardConfig.pollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!summary) return;
    if (previousFailed.current !== null && previousFailed.current !== summary.failed) {
      setFailedAnnouncement("Failed environments: " + summary.failed + ".");
    }
    previousFailed.current = summary.failed;
  }, [summary?.failed]);

  const resetTable = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const clearSelection = () => {
    setSelectedId(null);
    setInspectorOpen(false);
    setActionMessage("");
    setActionError("");
  };

  const selectEnvironment = useCallback((environment: EnvironmentDto) => {
    setSelectedId(environment.id);
    setActiveRowId(environment.id);
    setInspectorOpen(true);
    setActionMessage("");
    setActionError("");
  }, []);

  const changeCommand = (value: string) => {
    resetTable();
    clearSelection();
    setStepFilter(null);
    setStateChip("all");
    setStuckChip(false);
    setCommand(value.slice(0, dashboardConfig.maxSearchLength));
  };

  const selectStateChip = (state: StateFilter) => {
    resetTable();
    clearSelection();
    setCommand("");
    setStepFilter(null);
    setStateChip(state);
    setStuckChip(false);
    if (state === "all") setParsedCommand({});
  };

  const selectStuckChip = () => {
    const shouldKeepStuck = !effectiveStuck;
    resetTable();
    clearSelection();
    setCommand("");
    setStepFilter(null);
    setStateChip("all");
    setStuckChip(shouldKeepStuck);
    setParsedCommand((current) => ({ ...current, stuck: undefined }));
  };

  const selectStep = (step: number) => {
    resetTable();
    clearSelection();
    setCommand("");
    setStepFilter((current) => current === step ? null : step);
    setStateChip("all");
    setStuckChip(false);
    setParsedCommand((current) => ({ ...current, step: undefined }));
  };

  const clearFilters = () => {
    resetTable();
    clearSelection();
    setCommand("");
    setStepFilter(null);
    setStateChip("all");
    setStuckChip(false);
    setParsedCommand({});
  };

  const reprove = async (id: string) => {
    const environment = environments.find((item) => item.id === id);
    if (!environment || environment.state !== "failed" || savingId) return;
    setSavingId(id);
    setActionError("");
    setActionMessage("");
    try {
      const { response, body } = await requestJson("/api/environments/" + id, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "provisioning" }),
      });
      if (!response.ok) throw new Error(problemDetail(body, "Reprovision failed"));
      environmentSchema.parse(body);
      setActionMessage("Reprovisioning " + id + ".");
      setRetryCount((value) => value + 1);
    } catch {
      setActionError("Couldn't reprovision " + id + ". Retry.");
    } finally {
      setSavingId(null);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement
        && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        commandRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (helpOpen) {
          event.preventDefault();
          setHelpOpen(false);
          return;
        }
        if (inspectorOpen || selectedId) {
          event.preventDefault();
          clearSelection();
        }
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const currentIndex = environments.findIndex((item) => item.id === (activeRowId ?? selectedId));
        const nextIndex = event.key === "j"
          ? Math.min(environments.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1);
        const next = environments[nextIndex];
        if (next) {
          setActiveRowId(next.id);
          document.querySelector<HTMLButtonElement>('[data-row-id="' + next.id + '"]')?.focus();
        }
      }
      if (event.key === "Enter" && activeRowId) {
        const activeElement = document.activeElement;
        if (!(activeElement instanceof HTMLElement) || !activeElement.closest("[data-row-id]")) {
          const row = environments.find((item) => item.id === activeRowId);
          if (row) selectEnvironment(row);
        }
      }
      if (event.key.toLocaleLowerCase() === "r" && selected?.state === "failed") {
        event.preventDefault();
        void reprove(selected.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRowId, environments, helpOpen, inspectorOpen, selected, selectedId]);

  const activeFilters = Boolean(effectiveStates?.length)
    || effectiveStuck
    || Boolean(effectiveSearch)
    || Boolean(effectiveStep)
    || Boolean(effectiveMinutes)
    || Boolean(effectiveFailureReason)
    || Boolean(effectiveLab)
    || parsedCommand.sort !== undefined
    || parsedCommand.direction !== undefined;
  const parsedFilterChips: Array<{ key: string; label: string; onClear: () => void }> = [];
  effectiveStates?.forEach((state) => {
    parsedFilterChips.push({
      key: `state-${state}`,
      label: stateLabel(state),
      onClear: () => {
        if (stateChip === state) setStateChip("all");
        setParsedCommand((current) => {
          const states = current.states?.filter((item) => item !== state);
          return { ...current, states: states?.length ? states : undefined };
        });
      },
    });
  });
  if (effectiveStuck) parsedFilterChips.push({
    key: "stuck",
    label: "Stuck",
    onClear: () => {
      setStuckChip(false);
      setParsedCommand((current) => ({ ...current, stuck: undefined }));
    },
  });
  if (effectiveStep) parsedFilterChips.push({
    key: "step",
    label: `Step ${effectiveStep}`,
    onClear: () => {
      setStepFilter(null);
      setParsedCommand((current) => ({ ...current, step: undefined }));
    },
  });
  if (effectiveMinutes) {
    const { min, max } = effectiveMinutes;
    const label = min !== undefined && max !== undefined
      ? min === max ? `${min} min` : `${min}-${max} min`
      : min !== undefined ? `Over ${min} min` : `Under ${max} min`;
    parsedFilterChips.push({
      key: "minutes",
      label,
      onClear: () => setParsedCommand((current) => ({ ...current, minutesOnStep: undefined })),
    });
  }
  if (effectiveFailureReason) parsedFilterChips.push({
    key: "failure-reason",
    label: `Reason: ${effectiveFailureReason}`,
    onClear: () => setParsedCommand((current) => ({ ...current, failureReasonContains: undefined })),
  });
  if (effectiveLab) parsedFilterChips.push({
    key: "lab",
    label: `Lab: ${effectiveLab}`,
    onClear: () => setParsedCommand((current) => ({ ...current, lab: undefined })),
  });
  if (effectiveSearch) parsedFilterChips.push({
    key: "search",
    label: effectiveSearch,
    onClear: () => setParsedCommand((current) => ({ ...current, search: undefined })),
  });
  if (parsedCommand.sort || parsedCommand.direction) parsedFilterChips.push({
    key: "sort",
    label: `Sort: ${effectiveSort} ${effectiveDirection}`,
    onClear: () => setParsedCommand((current) => ({ ...current, sort: undefined, direction: undefined })),
  });
  const updatedLabel = elapsedLabel(updatedAt, clockNow);
  const groupRows = (group: EnvironmentDto["priorityGroup"]) => environments.filter((environment) => environment.priorityGroup === group);

  useEffect(() => {
    const labels: string[] = [];
    if (effectiveStates?.length) labels.push(effectiveStates.map(stateLabel).join(", "));
    if (effectiveStuck) labels.push("stuck");
    if (effectiveStep) labels.push(`step ${effectiveStep}`);
    if (effectiveMinutes) labels.push("time on step");
    if (effectiveFailureReason) labels.push(`reason ${effectiveFailureReason}`);
    if (effectiveLab) labels.push(`lab ${effectiveLab}`);
    if (effectiveSearch) labels.push(`"${effectiveSearch}"`);
    const summary = labels.length > 0
      ? `Applied filters: ${labels.join(", ")}. ${total} environments matched.`
      : `${total} environments matched.`;
    setFilterAnnouncement(summary);
  }, [effectiveSearch, effectiveStates, effectiveStep, effectiveStuck, effectiveMinutes, effectiveFailureReason, effectiveLab, total]);

  return (
    <div className="app-shell" data-density={density}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <a className="wordmark" href="#main" aria-label="CloudLabs workshop dashboard">CloudLabs</a>
        <label className="command-field">
          <span className="visually-hidden">Filter environments</span>
          <TextInput
            ref={commandRef}
            type="search"
            aria-label="Filter environments"
            placeholder="Filter learners, states, or steps"
            maxLength={dashboardConfig.maxSearchLength}
            value={command}
            onChange={(event) => changeCommand(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleParse(command);
              }
              if (event.key === "Escape") {
                parseAbortRef.current?.abort();
                parseRequestIdRef.current += 1;
                parseAbortRef.current = null;
                setCommand("");
                setParsedCommand({});
                setStateChip("all");
                setStuckChip(false);
                setStepFilter(null);
                setFilterSource("rules");
                setIsParsing(false);
              }
            }}
          />
          {command.trim() ? <span className="parse-source">{isParsing ? "Parsing" : (filterSource === "ai" ? "Parsed by model" : (filterSource === "model-unavailable" ? "Model unavailable, parsed locally" : "Parsed locally"))}</span> : null}
          {command.trim() ? <span className="match-count">{total} matched</span> : null}
          <kbd aria-hidden="true">/</kbd>
        </label>
        <div className="topbar-tools">
          <div className="live-status"><span aria-hidden="true" />Live <time dateTime={updatedAt ?? undefined}>{updatedLabel}</time></div>
          <IconButton label="Keyboard shortcuts" aria-expanded={helpOpen} onClick={() => setHelpOpen((value) => !value)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" /><path d="M6.3 6.1a1.8 1.8 0 1 1 3.1 1.2c-.8.8-1.4 1-1.4 2.2M8 11.7v.1" /></svg>
          </IconButton>
          {helpOpen && <div className="shortcut-popover" role="dialog" aria-label="Keyboard shortcuts">
            <IconButton className="popover-close" label="Close shortcuts" onClick={() => setHelpOpen(false)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
            </IconButton>
            <h2>Keyboard shortcuts</h2>
            <dl><div><dt>Move rows</dt><dd>j / k</dd></div><div><dt>Open details</dt><dd>Enter</dd></div><div><dt>Return to steps</dt><dd>Esc</dd></div><div><dt>Filter</dt><dd>/</dd></div><div><dt>Reprovision failed</dt><dd>r</dd></div></dl>
          </div>}
        </div>
        <span className="sr-only" aria-live="polite">{failedAnnouncement}</span>
        <span className="sr-only" aria-live="polite">{filterAnnouncement}</span>
      </header>

      <main id="main" className="page-content">
        <dl className="summary-strip" aria-label={summaryError ? "Session summary; totals unavailable" : "Session summary"}>
          <div className="summary-item"><dt><StatusMarker kind="failed" />Failed</dt><dd><span className="summary-value">{summary ? summary.failed : "?"}</span></dd></div>
          <div className="summary-item"><dt><StatusMarker kind="stuck" />Stuck</dt><dd><span className="summary-value">{summary ? summary.stuck : "?"}</span></dd></div>
          <div className="summary-item"><dt>Active</dt><dd><span className="summary-value">{summary ? summary.active : "?"}</span></dd></div>
          <div className="summary-item"><dt>Spend</dt><dd><span className="summary-value">{summary ? formatCurrency(summary.spendUsd) : "?"}</span></dd></div>
          <div className="summary-item"><dt>Average completion</dt><dd><span className="summary-value">{summary ? summary.averageCompletionPercent + "%" : "?"}</span></dd></div>
          <div className="summary-item summary-environments"><dt>Environments</dt><dd><StateDistributionBar counts={summary?.stateCounts} onSelect={selectStateChip} /></dd></div>
        </dl>

        <div className="filter-band">
          <div className="filter-row">
            <div className="state-chips" role="group" aria-label="Filter by state">
              <FilterChip label="All" count={summary?.total ?? total} selected={stateChip === "all" && !stuckChip && !activeFilters} onClick={() => selectStateChip("all")} />
              <FilterChip label="Failed" count={summary?.stateCounts.failed ?? 0} selected={stateChip === "failed"} onClick={() => selectStateChip("failed")} />
              <FilterChip label="Stuck" count={summary?.stuck ?? 0} selected={effectiveStuck} onClick={selectStuckChip} />
              <FilterChip label="Provisioning" count={summary?.stateCounts.provisioning ?? 0} selected={stateChip === "provisioning"} onClick={() => selectStateChip("provisioning")} />
              <FilterChip label="Ready" count={summary?.stateCounts.ready ?? 0} selected={stateChip === "ready"} onClick={() => selectStateChip("ready")} />
              <FilterChip label="In use" count={summary?.stateCounts.in_use ?? 0} selected={stateChip === "in_use"} onClick={() => selectStateChip("in_use")} />
              <FilterChip label="Deprovisioned" count={summary?.stateCounts.deprovisioned ?? 0} selected={stateChip === "deprovisioned"} onClick={() => selectStateChip("deprovisioned")} />
            </div>
          </div>
          <DensityControl value={density} onChange={setDensity} />
        </div>

        {parsedFilterChips.length > 0 ? (
          <div className="parsed-chip-list" aria-label="Interpreted filter chips">
            {parsedFilterChips.map((chip) => (
              <button key={chip.key} type="button" className="filter-chip parsed-chip" onClick={chip.onClear} aria-label={`Remove ${chip.label}`}>
                <span>{chip.label}</span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        ) : null}

        <section className="workspace" aria-label="Live environments">
          {listError && <div className="error-banner" role="alert"><strong>Couldn't reach the server.</strong><span>Last updated {updatedAt ? new Intl.DateTimeFormat("en-US", { timeStyle: "medium", timeZone: "UTC" }).format(new Date(updatedAt)) + " UTC" : "not available"}.</span><button type="button" onClick={() => setRetryCount((value) => value + 1)}>Retry</button></div>}
          <div className="table-scroll" ref={scrollRef} data-testid="table-scroll" aria-busy={status === "loading"}>
            <table className="environment-table" aria-label="Lab environments">
              <thead><tr><th scope="col">State</th><th scope="col">Learner</th><th scope="col">Lab</th><th scope="col" className="running-column numeric-heading">Running</th><th scope="col">Step</th><th scope="col" className="numeric-heading">Time on step</th><th scope="col" className="numeric-heading">Spend</th><th scope="col">Last event</th></tr></thead>
              <tbody>
                {status === "loading" && environments.length === 0 && Array.from({ length: 16 }, (_, index) => <tr className="skeleton-row" key={index} aria-hidden="true"><td><span className="skeleton-line skeleton-state" /></td><td><span className="skeleton-line skeleton-name" /></td><td><span className="skeleton-line skeleton-lab" /></td><td className="running-column"><span className="skeleton-line skeleton-started" /></td><td><span className="skeleton-line skeleton-step" /></td><td><span className="skeleton-line skeleton-number" /></td><td><span className="skeleton-line skeleton-number" /></td><td><span className="skeleton-line skeleton-event" /></td></tr>)}
                {status === "loading" && environments.length === 0 && <tr className="loading-copy"><td colSpan={8}><span role="status">Loading environments…</span></td></tr>}
                {status === "error" && environments.length === 0 && <tr className="empty-table-row"><td colSpan={8}>Couldn't reach the server. Retry.</td></tr>}
                {status === "ready" && environments.length === 0 && <tr className="empty-table-row"><td colSpan={8}><div className="empty-state-copy"><span>{total === 0 && !activeFilters ? "No environments in this session." : "No environments match this filter."}</span>{parsedFilterChips.length > 0 ? <div className="empty-query-summary">Parsed: {parsedFilterChips.map((chip) => chip.label).join(", ")}</div> : null}{activeFilters && <button type="button" className="text-button" onClick={clearFilters}>Clear filter</button>}</div>{parsedFilterChips.length > 0 ? <div className="empty-query-example">Try: “failed labs with quota errors” or “everyone stuck on step 4 over 20 min”</div> : null}</td></tr>}
                {status === "ready" && environments.length > 0 && <>
                  {groups.failed > 0 && <><GroupHeading name="Failed" count={groups.failed} group="failed" />{groupRows("failed").map((environment) => <EnvironmentRow key={environment.id} environment={environment} selected={environment.id === selectedId} now={clockNow} onSelect={selectEnvironment} />)}</>}
                  {groups.stuck > 0 && <><GroupHeading name="Stuck" count={groups.stuck} group="stuck" />{groupRows("stuck").map((environment) => <EnvironmentRow key={environment.id} environment={environment} selected={environment.id === selectedId} now={clockNow} onSelect={selectEnvironment} />)}</>}
                  {groups.other > 0 && <><GroupHeading name="Everything else" count={groups.other} group="other" />{groupRows("other").map((environment) => <EnvironmentRow key={environment.id} environment={environment} selected={environment.id === selectedId} now={clockNow} onSelect={selectEnvironment} />)}</>}
                </>}
              </tbody>
            </table>
          </div>
          <div className={"inspector-scrim" + (inspectorOpen ? " is-open" : "")} aria-hidden="true" onClick={clearSelection} />
          <aside className={"inspector" + (inspectorOpen ? " is-open" : "")} aria-label={selected ? "Selected environment" : "Where the class is"}>
            {selected ? <EnvironmentInspector environment={selected} now={clockNow} typicalDurationSeconds={summary?.steps.find(({ step }) => step === selected.currentStep + 1)?.typicalDurationSeconds ?? null} saving={savingId === selected.id} actionMessage={actionMessage} actionError={actionError} onClose={clearSelection} onReprovision={() => void reprove(selected.id)} /> : <StepOverview steps={summary?.steps ?? []} selectedStep={effectiveStep} onSelect={selectStep} />}
          </aside>
        </section>
      </main>
    </div>
  );
}

function GroupHeading({ name, count, group }: { name: string; count: number; group: "failed" | "stuck" | "other" }) {
  return <tr className={`group-heading group-${group}`}><th scope="rowgroup" colSpan={8}>{name} <span>({count})</span></th></tr>;
}

function StateDistributionBar({ counts, onSelect }: {
  counts?: SessionSummary["stateCounts"];
  onSelect: (state: StateFilter) => void;
}) {
  const states = ["failed", "provisioning", "ready", "in_use", "deprovisioned"] as const;
  return <div className="distribution-bar" aria-hidden="true">
    {states.map((state) => {
      const count = counts?.[state] ?? 0;
      if (!count) return null;
      return <Tooltip key={state} label={`${stateLabels[state]}: ${count}`} style={{ flex: `${count} 1 0%` }}>
        <button
          type="button"
          className={`distribution-segment segment-${state}`}
          aria-label={`Filter ${stateLabels[state]}: ${count}`}
          onClick={() => onSelect(state)}
        />
      </Tooltip>;
    })}
  </div>;
}

function StepOverview({ steps, selectedStep, onSelect }: { steps: SessionSummary["steps"]; selectedStep?: number | null; onSelect: (step: number) => void }) {
  const largest = Math.max(1, ...steps.map(({ learners }) => learners));
  return <section className="step-overview" aria-label="Where the class is"><h2>Where the class is</h2>
    <ol>{steps.map(({ step, learners, stuck }) => <li key={step}><button type="button" className={"step-overview-row" + (selectedStep === step ? " is-active" : "")} aria-label={`Filter table to step ${step}`} aria-pressed={selectedStep === step} onClick={() => onSelect(step)}>
      <span className="step-overview-name">Step {step}</span><span className="step-overview-track" aria-hidden="true"><span style={{ width: `${(learners / largest) * 100}%` }} /></span><span className="step-overview-count">{learners}</span>{stuck > 0 ? <span className="step-overview-stuck" aria-label={`${stuck} stuck`}><StatusMarker kind="stuck" />{stuck}</span> : null}
    </button></li>)}</ol>
  </section>;
}

const EnvironmentRow = memo(function EnvironmentRow({
  environment,
  selected,
  now,
  onSelect,
}: {
  environment: EnvironmentDto;
  selected: boolean;
  now: number;
  onSelect: (environment: EnvironmentDto) => void;
}) {
  const stuck = isStuck(environment);
  const changedFrom = useRef({ state: environment.state, step: environment.currentStep });
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (changedFrom.current.state !== environment.state || changedFrom.current.step !== environment.currentStep) {
      changedFrom.current = { state: environment.state, step: environment.currentStep };
      setChanged(true);
      const timeout = window.setTimeout(() => setChanged(false), 420);
      return () => window.clearTimeout(timeout);
    }
  }, [environment.currentStep, environment.state]);

  return (
    <tr
      data-priority={environment.priorityGroup}
      className={(selected ? "is-selected " : "") + (changed ? "is-changed" : "")}
      aria-selected={selected}
      onClick={() => onSelect(environment)}
    >
      <td><span className="cell-content"><StatusLine marker={statusMarker(environment)} label={stuck ? "Stuck" : stateLabel(environment.state)} /></span></td>
      <th scope="row" className="learner-cell">
        <button
          className="learner-button"
          type="button"
          data-row-id={environment.id}
          aria-label={"Open " + environment.learnerName + ", " + environment.id}
        >
          <span className="cell-content"><NameId name={environment.learnerName} id={environment.id} /></span>
        </button>
      </th>
      <td className="lab-cell" title={environment.labName}><span className="cell-content">{environment.labName}</span></td>
      <td className="running-cell running-column numeric"><span className="cell-content">{runningLabel(environment, now)}</span></td>
      <td>
        <div className="step-cell" aria-label={environment.state === "provisioning" ? "Provisioning" : stepLabel(environment)}>
          <span className="cell-content">{environment.state === "provisioning"
            ? <span className="step-state">&mdash;</span>
            : <StepMeter completed={environment.currentStep} count={environment.stepCount} />}</span>
        </div>
      </td>
      <td className="numeric time-cell">
        <span className="cell-content">{environment.state === "failed"
          ? <span>failed · {Math.min(environment.currentStep + 1, environment.stepCount)}</span>
          : <TimeOnStep time={formatDuration(environment.timeOnStepSeconds)} stuck={stuck} />}</span>
      </td>
      <td className="numeric spend-cell"><span className="cell-content">{formatCurrency(environment.spendUsd)}</span></td>
      <td className="event-cell" title={lastEventLabel(environment, now)}><span className="cell-content event-content"><span>{lastEventDescription(environment)}</span><time>{relativeTime(environment.lastEvent.at, now)}</time></span></td>
    </tr>
  );
});

function EnvironmentInspector({
  environment,
  now,
  typicalDurationSeconds,
  saving,
  actionMessage,
  actionError,
  onClose,
  onReprovision,
}: {
  environment: EnvironmentDto;
  now: number;
  typicalDurationSeconds: number | null;
  saving: boolean;
  actionMessage: string;
  actionError: string;
  onClose: () => void;
  onReprovision: () => void;
}) {
  const runtimeSeconds = Math.max(0, Math.floor((now - Date.parse(environment.startedAt)) / 1000));
  const history = environment.stepHistory;

  return (
    <section className="environment-inspector">
      <header className="inspector-heading inspector-detail-heading">
        <h2><span>{environment.learnerName}</span><span className="environment-id">{environment.id}</span></h2>
        <IconButton label="Return to step overview" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
        </IconButton>
      </header>

      <div className="inspector-state"><StatusLine marker={statusMarker(environment)} label={isStuck(environment) ? "Stuck" : stateLabel(environment.state)} /></div>

      {environment.error && (
        <section className="failure-reason" aria-label="Failure reason">
          <h3>Failure reason</h3>
          <p>{environment.error}</p>
        </section>
      )}

      {environment.currentStep < environment.stepCount && <section className="current-step-section">
        <h3>Current step</h3>
        <p>{dashboardConfig.stepNames[environment.currentStep] ?? "Ready to start"}</p>
        <div className="current-step-time">
          <TimeOnStep time={formatDuration(environment.timeOnStepSeconds)} stuck={isStuck(environment)} />
          <span>Typical duration: {typicalDurationSeconds === null ? "Unavailable" : formatDuration(typicalDurationSeconds)}</span>
        </div>
      </section>}

      <section className="history-section">
        <h3>Step history</h3>
        {history.length > 0 ? (
          <ol className="history-list">
            {history.map((step) => (
              <li key={step.stepIndex}>
                <span>{dashboardConfig.stepNames[step.stepIndex] ?? "Step " + (step.stepIndex + 1)}</span>
                <time>{formatDuration(step.durationSeconds)}</time>
              </li>
            ))}
          </ol>
        ) : <p className="history-empty">No completed steps yet.</p>}
      </section>

      <section className="spend-section">
        <h3>Spend</h3>
        <dl className="inspector-list">
          <div><dt>Runtime</dt><dd>{formatDuration(runtimeSeconds)}</dd></div>
          <div><dt>Plan</dt><dd>{environment.sku}</dd></div>
          <div><dt>Rate</dt><dd>{formatCurrency(environment.hourlyRateUsd)} / hour</dd></div>
          <div><dt>Spend to date</dt><dd>{formatCurrency(environment.spendUsd)}</dd></div>
        </dl>
      </section>

      {actionMessage && <p className="action-message" role="status">{actionMessage}</p>}
      {actionError && <p className="action-error" role="alert">{actionError}</p>}
      {environment.state === "failed" && (
        <ActionButton className="primary-action" disabled={saving} onClick={onReprovision}>
          {saving ? "Reprovisioning…" : "Reprovision"}
        </ActionButton>
      )}
    </section>
  );
}
