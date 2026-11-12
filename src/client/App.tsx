import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  atRiskResponseSchema,
  environmentPageSchema,
  environmentSchema,
  sessionSummarySchema,
  type AtRiskResponse,
  type EnvironmentDto,
} from "../shared/contracts.ts";
import { dashboardConfig, environmentStates, type EnvironmentState } from "../shared/config.ts";
import type { EnvironmentSortKey, SortDirection } from "../server/domain.ts";
import type { SessionSummary } from "../server/model.ts";

type ListStatus = "loading" | "ready" | "error";

function stateLabel(state: EnvironmentState): string {
  return state.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function durationLabel(seconds: number): string {
  if (seconds < 60) return "Under 1 min";
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${minutes} min`;
}

function currencyLabel(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function updatedLabel(value: string | null): string {
  if (!value) return "Waiting for update";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
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

function errorDetail(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "detail" in body && typeof body.detail === "string") {
    return body.detail;
  }
  return fallback;
}

export function App() {
  const [environments, setEnvironments] = useState<EnvironmentDto[]>([]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [risk, setRisk] = useState<AtRiskResponse | null>(null);
  const [selected, setSelected] = useState<EnvironmentDto | null>(null);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [listError, setListError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [riskError, setRiskError] = useState("");
  const [total, setTotal] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<EnvironmentState | "all">("all");
  const [riskOnly, setRiskOnly] = useState(false);
  const [sort, setSort] = useState<EnvironmentSortKey>("state");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [retryCount, setRetryCount] = useState(0);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), dashboardConfig.searchDebounceMs);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    let inFlight = false;

    const loadEnvironments = async () => {
      if (inFlight) return;
      inFlight = true;
      if (!hasLoadedRef.current) setStatus("loading");
      setListError("");
      scrollPositionRef.current = hasLoadedRef.current ? scrollRef.current?.scrollTop ?? 0 : 0;

      const parameters = new URLSearchParams({
        state: stateFilter,
        q: search,
        riskOnly: String(riskOnly),
        sort,
        direction,
      });

      try {
        const { response, body } = await requestJson(`/api/environments?${parameters.toString()}`);
        if (!response.ok) throw new Error(errorDetail(body, "The environment list could not be loaded."));
        const page = environmentPageSchema.parse(body);
        if (!active) return;
        setEnvironments(page.items);
        setTotal(page.total);
        setUpdatedAt(page.updatedAt);
        setSelected((current) => {
          if (!current) return null;
          return page.items.find((environment) => environment.id === current.id) ?? current;
        });
        setStatus("ready");
        hasLoadedRef.current = true;
        setHasLoaded(true);
      } catch {
        if (active && !hasLoadedRef.current) setStatus("error");
        if (active) setListError("The environment list could not be loaded.");
      } finally {
        inFlight = false;
      }
    };

    void loadEnvironments();
    const interval = window.setInterval(() => void loadEnvironments(), dashboardConfig.pollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [stateFilter, search, riskOnly, sort, direction, retryCount]);

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
          setSummaryError("");
        }
      } catch {
        if (active) setSummaryError("Session totals are unavailable.");
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
    let active = true;
    const loadRisk = async () => {
      try {
        const { response, body } = await requestJson("/api/ai/at-risk");
        if (!response.ok) throw new Error("Risk ranking unavailable");
        const value = atRiskResponseSchema.parse(body);
        if (active) {
          setRisk(value);
          setRiskError("");
        }
      } catch {
        if (active) setRiskError("Risk ranking is unavailable. The lab list still works.");
      }
    };
    void loadRisk();
    const interval = window.setInterval(() => void loadRisk(), dashboardConfig.atRiskPollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useLayoutEffect(() => {
    if (!selected) return;
    const current = environments.find((environment) => environment.id === selected.id);
    if (current && current !== selected) setSelected(current);
  }, [environments, selected]);

  const clearSelection = () => {
    setSelected(null);
    setActionMessage("");
    setActionError("");
  };

  const selectEnvironment = (environment: EnvironmentDto) => {
    setSelected(environment);
    setActionMessage("");
    setActionError("");
  };

  const setFilterState = (value: EnvironmentState | "all") => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    clearSelection();
    setStateFilter(value);
  };

  const toggleRiskFilter = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    clearSelection();
    setRiskOnly((current) => !current);
  };

  const updateSort = (key: EnvironmentSortKey) => {
    const nextDirection = key === sort && direction === "asc" ? "desc" : "asc";
    setSort(key);
    setDirection(nextDirection);
  };

  const reprove = async () => {
    if (!selected || selected.state !== "failed" || saving) return;
    setSaving(true);
    setActionError("");
    setActionMessage("");
    try {
      const { response, body } = await requestJson(`/api/environments/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "provisioning" }),
      });
      if (!response.ok) throw new Error(errorDetail(body, "The lab could not be reprovisioned."));
      const updated = environmentSchema.parse(body);
      setSelected(updated);
      setEnvironments((current) => current.flatMap((environment) => {
        if (environment.id !== updated.id) return [environment];
        if (stateFilter !== "all" && stateFilter !== updated.state) return [];
        if (riskOnly && updated.state !== "failed" && updated.timeOnStepSeconds < dashboardConfig.stuckThresholdSeconds) return [];
        return [updated];
      }));
      setActionMessage(`Reprovisioning requested for ${updated.id}`);
    } catch {
      setActionError("The lab could not be reprovisioned. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const changeSearch = (value: string) => {
    clearSelection();
    setSearchInput(value);
  };

  const rowCountLabel = total === 1 ? "1 lab" : `${total} labs`;
  const emptyMessage = search || stateFilter !== "all" || riskOnly
    ? "No labs match these filters."
    : "No lab environments in this session.";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="skip-link" href="#main">Skip to content</a>
        <div className="topbar-inner">
          <a className="wordmark" href="#main" aria-label="CloudLabs workshop operations home">
            <span>CloudLabs</span>
          </a>
          <div className="topbar-context">
            <span className="context-label">Workshop</span>
            <span className="live-indicator"><span aria-hidden="true" /> Live session</span>
          </div>
          <a className="api-link" href="/api/openapi.json" target="_blank" rel="noreferrer">API docs</a>
        </div>
      </header>

      <main id="main" className="page-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">CloudLabs / operations</p>
            <h1>Workshop operations</h1>
            <p className="page-intro">Track learner progress and spot labs that need attention.</p>
          </div>
          <p className="last-updated" aria-live="polite">
            Updated <time>{updatedLabel(updatedAt)}</time>
          </p>
        </div>

        <section className="summary-section" aria-label="Session summary">
          <div className="section-kicker">Session summary</div>
          {summary ? (
            <dl className="summary-strip">
              <div><dt>Total labs</dt><dd>{summary.total}</dd></div>
              <div><dt>Active</dt><dd>{summary.active}</dd></div>
              <div><dt>Failed</dt><dd className="summary-failed">{summary.failed}</dd></div>
              <div><dt>Completed</dt><dd>{summary.completed}</dd></div>
              <div><dt>Avg. complete</dt><dd>{summary.averageCompletionPercent}<span>%</span></dd></div>
              <div><dt>Spend to date</dt><dd>{currencyLabel(summary.spendUsd)}</dd></div>
            </dl>
          ) : (
            <p className="summary-placeholder">{summaryError || "Loading session totals…"}</p>
          )}
          {summaryError && summary && <p className="summary-note">{summaryError}</p>}
        </section>

        <section className="attention-section" aria-label="At-risk ranking">
          <div className="attention-heading">
            <div>
              <div className="section-kicker">Needs attention</div>
              <h2>At-risk ranking</h2>
            </div>
            {risk && <span className="source-label">{risk.source === "ai" ? "AI ranked" : "Rules fallback"}</span>}
          </div>
          {riskError ? (
            <p className="risk-note">{riskError}</p>
          ) : risk && risk.items.length > 0 ? (
            <ol className="risk-list">
              {risk.items.map((item) => (
                <li key={item.id}>
                  <button className="risk-row" type="button" onClick={() => {
                    const environment = environments.find((row) => row.id === item.id);
                    if (environment) selectEnvironment(environment);
                  }}>
                    <span className={`status-mark status-mark--${item.state}`} aria-hidden="true" />
                    <span className="risk-id">{item.id}</span>
                    <span className="risk-learner">{item.learnerName}</span>
                    <span className="risk-reason">{item.reasons[0]}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : risk ? (
            <p className="risk-note">No labs currently need attention.</p>
          ) : (
            <p className="risk-note">Loading at-risk labs…</p>
          )}
        </section>

        <section className="environment-section" aria-labelledby="environment-heading">
          <div className="environment-title-row">
            <div>
              <div className="section-kicker">Live environments</div>
              <h2 id="environment-heading">Lab environments <span className="count-label">{rowCountLabel}</span></h2>
            </div>
            <button
              className={`risk-filter-button${riskOnly ? " is-active" : ""}`}
              type="button"
              aria-pressed={riskOnly}
              onClick={toggleRiskFilter}
            >
              {riskOnly ? "Show all labs" : "Show at-risk only"}
            </button>
          </div>

          <div className="toolbar" role="search" aria-label="Filter lab environments">
            <label className="search-field">
              <span className="visually-hidden">Find labs</span>
              <span className="search-glyph" aria-hidden="true">⌕</span>
              <input
                type="search"
                aria-label="Find labs"
                placeholder="Find a learner, lab, ID, or issue"
                value={searchInput}
                maxLength={dashboardConfig.maxSearchLength}
                onChange={(event) => changeSearch(event.currentTarget.value)}
              />
            </label>
            <label className="state-select">
              <span>State</span>
              <select
                aria-label="State"
                value={stateFilter}
                onChange={(event) => setFilterState(event.currentTarget.value as EnvironmentState | "all")}
              >
                <option value="all">All states</option>
                {environmentStates.map((state) => <option key={state} value={state}>{stateLabel(state)}</option>)}
              </select>
            </label>
            <p className="filter-result" aria-live="polite">Showing {rowCountLabel}</p>
          </div>

          {listError && (
            <div className="error-banner" role="alert">
              <div>
                <strong>The environment list could not be loaded.</strong>
                <p>{hasLoaded ? "The last results are still shown." : "Check the API connection and try again."}</p>
              </div>
              <button type="button" className="secondary-button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
            </div>
          )}

          <div className="workspace-grid">
            <div className="table-column">
              {status === "loading" ? (
                <div className="loading-state" role="status" aria-live="polite">
                  <span className="loading-mark" aria-hidden="true" />
                  <span>Loading environments…</span>
                </div>
              ) : environments.length === 0 ? (
                <div className="empty-state">
                  <p>{emptyMessage}</p>
                  {(search || stateFilter !== "all" || riskOnly) && (
                    <button type="button" className="text-button" onClick={() => {
                      setSearchInput("");
                      setSearch("");
                      setFilterState("all");
                      setRiskOnly(false);
                    }}>Clear filters</button>
                  )}
                </div>
              ) : (
                <div className="table-scroll" data-testid="table-scroll" ref={scrollRef} aria-busy={status !== "ready"}>
                  <table className="environment-table" aria-label="Lab environments">
                    <thead>
                      <tr>
                        <th scope="col" aria-sort={sort === "state" ? (direction === "asc" ? "ascending" : "descending") : "none"}>
                          <button className="sort-button" type="button" onClick={() => updateSort("state")}>State <SortIndicator active={sort === "state"} direction={direction} /></button>
                        </th>
                        <th scope="col" aria-sort={sort === "learner" ? (direction === "asc" ? "ascending" : "descending") : "none"}>
                          <button className="sort-button" type="button" onClick={() => updateSort("learner")}>Learner <SortIndicator active={sort === "learner"} direction={direction} /></button>
                        </th>
                        <th scope="col">Lab</th>
                        <th scope="col" aria-sort={sort === "step" ? (direction === "asc" ? "ascending" : "descending") : "none"}>
                          <button className="sort-button" type="button" onClick={() => updateSort("step")}>Step progress <SortIndicator active={sort === "step"} direction={direction} /></button>
                        </th>
                        <th scope="col" className="numeric-heading" aria-sort={sort === "time" ? (direction === "asc" ? "ascending" : "descending") : "none"}>
                          <button className="sort-button" type="button" onClick={() => updateSort("time")}>Time on step <SortIndicator active={sort === "time"} direction={direction} /></button>
                        </th>
                        <th scope="col" className="numeric-heading" aria-sort={sort === "spend" ? (direction === "asc" ? "ascending" : "descending") : "none"}>
                          <button className="sort-button" type="button" onClick={() => updateSort("spend")}>Spend <SortIndicator active={sort === "spend"} direction={direction} /></button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {environments.map((environment) => (
                        <EnvironmentRow
                          key={environment.id}
                          environment={environment}
                          selected={selected?.id === environment.id}
                          onSelect={() => selectEnvironment(environment)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <aside className="details-panel" aria-label="Environment details" role="complementary">
              {selected ? (
                <>
                  <div className="detail-header">
                    <div>
                      <p className="section-kicker">Selected lab</p>
                      <h3>{selected.learnerName}</h3>
                      <p className="detail-id">{selected.id}</p>
                    </div>
                    <button className="close-detail" type="button" aria-label="Close environment details" onClick={clearSelection}>×</button>
                  </div>
                  <div className="detail-state-row"><StatusLabel state={selected.state} /></div>
                  <dl className="detail-list">
                    <div><dt>Learner</dt><dd>{selected.learnerEmail}</dd></div>
                    <div><dt>Lab</dt><dd>{selected.labName}</dd></div>
                    <div><dt>Current step</dt><dd>{stepLabel(selected)}</dd></div>
                    <div><dt>Time on step</dt><dd className="numeric">{durationLabel(selected.timeOnStepSeconds)}</dd></div>
                    <div><dt>Started</dt><dd>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selected.startedAt))}</dd></div>
                    <div><dt>Spend to date</dt><dd className="numeric">{currencyLabel(selected.spendUsd)}</dd></div>
                  </dl>
                  {selected.error && <div className="detail-error"><strong>Issue</strong><p>{selected.error}</p></div>}
                  {actionMessage && <p className="action-message" role="status">{actionMessage}</p>}
                  {actionError && <p className="action-error" role="alert">{actionError}</p>}
                  {selected.state === "failed" && (
                    <button className="primary-button reprovision-button" type="button" disabled={saving} onClick={() => void reprove()}>
                      {saving ? "Requesting…" : `Reprovision ${selected.id}`}
                    </button>
                  )}
                </>
              ) : (
                <div className="detail-empty">
                  <p className="section-kicker">Lab details</p>
                  <p>Select a row to view learner progress and available actions.</p>
                  <span className="detail-empty-rule" aria-hidden="true" />
                </div>
              )}
            </aside>
          </div>
        </section>
        <footer className="page-footer">
          <span>Workshop environment monitor</span>
          <span>Refreshes every {dashboardConfig.pollIntervalMs / 1000} seconds</span>
        </footer>
      </main>
    </div>
  );
}

function stepLabel(environment: EnvironmentDto): string {
  if (environment.currentStep >= environment.stepCount) return "Complete";
  return `${Math.min(environment.currentStep + 1, environment.stepCount)} of ${environment.stepCount} · ${dashboardConfig.stepNames[environment.currentStep] ?? "Ready to start"}`;
}

function SortIndicator({ active, direction }: { active: boolean; direction: SortDirection }) {
  return <span className={`sort-indicator${active ? " is-active" : ""}`} aria-hidden="true">{active ? direction === "asc" ? "↑" : "↓" : "↕"}</span>;
}

function StatusLabel({ state }: { state: EnvironmentState }) {
  return (
    <span className={`status-label status-label--${state}`}>
      <span className={`status-mark status-mark--${state}`} aria-hidden="true" />
      {stateLabel(state)}
    </span>
  );
}

function EnvironmentRow({
  environment,
  selected,
  onSelect,
}: {
  environment: EnvironmentDto;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr data-state={environment.state} className={selected ? "is-selected" : undefined}>
      <td><StatusLabel state={environment.state} /></td>
      <th scope="row" className="learner-cell">
        <button className="lab-select" type="button" aria-label={`Open lab ${environment.id}`} onClick={onSelect}>
          <span className="learner-name">{environment.learnerName}</span>
          <span className="lab-id">{environment.id}</span>
        </button>
      </th>
      <td className="lab-cell">{environment.labName}</td>
      <td>
        <div className="step-cell">
          <div className="step-copy"><span>{stepLabel(environment)}</span><span className="step-percent">{environment.completionPercent}%</span></div>
          <progress max="100" value={environment.completionPercent} aria-label={`Lab completion for ${environment.learnerName}`} />
        </div>
      </td>
      <td className="numeric time-cell">{durationLabel(environment.timeOnStepSeconds)}</td>
      <td className="numeric spend-cell">{currencyLabel(environment.spendUsd)}</td>
    </tr>
  );
}
