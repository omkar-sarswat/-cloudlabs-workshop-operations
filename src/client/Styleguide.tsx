import { useState } from "react";
import {
  ActionButton,
  DensityControl,
  FilterChip,
  IconButton,
  NameId,
  StatusLine,
  StepMeter,
  TextInput,
  TimeOnStep,
  Tooltip,
} from "./atoms.tsx";

const stateSamples = [
  { label: "Failed", marker: "failed" as const },
  { label: "Provisioning", marker: "provisioning" as const },
  { label: "Stuck", marker: "stuck" as const },
  { label: "Ready" },
  { label: "In use" },
  { label: "Deprovisioned" },
];

const stateNames = ["Default", "Hover", "Focus", "Selected", "Disabled"];

function StateHeadings() {
  return <div className="styleguide-state-headings" aria-hidden="true">{stateNames.map((name) => <span key={name}>{name}</span>)}</div>;
}

export function Styleguide() {
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  return (
    <div className="styleguide-shell">
      <header className="styleguide-header">
        <a className="wordmark" href="/">CloudLabs</a>
        <span>Interface system</span>
        <span>Atoms</span>
      </header>
      <main className="styleguide-main">
        <div className="styleguide-intro">
          <div>
            <p className="styleguide-kicker">Level 2 · component atoms</p>
            <h1>Workshop operations interface</h1>
          </div>
          <p>Shared controls and data marks for the live learner table.</p>
        </div>

        <section className="styleguide-section" aria-labelledby="status-title">
          <div className="styleguide-section-heading">
            <h2 id="status-title">Status markers</h2>
            <p>Only failed, provisioning, and stuck use a mark. Every state keeps its text label.</p>
          </div>
          <div className="styleguide-status-list">
            {stateSamples.map(({ label, marker }) => <StatusLine key={label} marker={marker} label={label} />)}
          </div>
        </section>

        <section className="styleguide-section" aria-labelledby="identity-title">
          <div className="styleguide-section-heading">
            <h2 id="identity-title">Name and environment ID</h2>
            <p>Baseline alignment and an 8px gap keep the learner and ID distinct.</p>
          </div>
          <div className="styleguide-density-columns">
            {(["comfortable", "compact"] as const).map((densityName) => (
              <div className="styleguide-density-sample" data-density={densityName} key={densityName}>
                <span className="styleguide-density-label">{densityName}</span>
                <NameId name="Morgan Diaz" id="LAB-017" density={densityName} />
              </div>
            ))}
          </div>
        </section>

        <section className="styleguide-section" aria-labelledby="meter-title">
          <div className="styleguide-section-heading">
            <h2 id="meter-title">Step meter</h2>
            <p>Eight neutral segments; the active step is outlined.</p>
          </div>
          <div className="styleguide-density-columns">
            {(["comfortable", "compact"] as const).map((densityName) => (
              <div className="styleguide-density-sample" data-density={densityName} key={densityName}>
                <span className="styleguide-density-label">{densityName}</span>
                <StepMeter completed={7} />
              </div>
            ))}
          </div>
        </section>

        <section className="styleguide-section" aria-labelledby="time-title">
          <div className="styleguide-section-heading">
            <h2 id="time-title">Time on step</h2>
            <p>Tabular time stays aligned; stuck combines a diamond, label, and ink time.</p>
          </div>
          <div className="styleguide-time-samples">
            <TimeOnStep time="24:01" />
            <TimeOnStep time="1h 38m" />
            <TimeOnStep time="48:12" stuck />
          </div>
        </section>

        <section className="styleguide-section" aria-labelledby="chip-title">
          <div className="styleguide-section-heading">
            <h2 id="chip-title">Filter chips</h2>
            <p>Default, hover, keyboard focus, selected, and disabled.</p>
          </div>
          <div className="styleguide-state-demo">
            <StateHeadings />
            <div className="styleguide-state-grid">
              <div><FilterChip label="In use" count={62} /></div>
              <div><FilterChip label="In use" count={62} className="demo-hover" /></div>
              <div><FilterChip label="In use" count={62} className="demo-focus" /></div>
              <div><FilterChip label="In use" count={62} selected /></div>
              <div><FilterChip label="In use" count={62} disabled /></div>
            </div>
          </div>
        </section>

        <section className="styleguide-section" aria-labelledby="button-title">
          <div className="styleguide-section-heading">
            <h2 id="button-title">Buttons and density</h2>
            <p>One primary treatment, one outlined secondary treatment, and a quiet segmented control.</p>
          </div>
          <div className="styleguide-button-demo">
            <StateHeadings />
            <div className="styleguide-state-grid styleguide-button-grid">
              <div><ActionButton>Reprovision</ActionButton></div>
              <div><ActionButton className="demo-hover">Reprovision</ActionButton></div>
              <div><ActionButton className="demo-focus">Reprovision</ActionButton></div>
              <div><ActionButton kind="secondary" aria-pressed="true">Open details</ActionButton></div>
              <div><ActionButton disabled>Reprovision</ActionButton></div>
            </div>
            <div className="styleguide-control-row">
              <DensityControl value={density} onChange={setDensity} />
              <span className="styleguide-density-label">Current: {density}</span>
              <IconButton label="Close styleguide preview">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
              </IconButton>
            </div>
          </div>
        </section>

        <section className="styleguide-section" aria-labelledby="input-title">
          <div className="styleguide-section-heading">
            <h2 id="input-title">Filter input</h2>
            <p>32px control, gray-7 border, and blue focus ring.</p>
          </div>
          <div className="styleguide-input-grid">
            <label><span>Default</span><TextInput placeholder="Filter learners or steps" /></label>
            <label><span>Focus</span><TextInput className="demo-focus" value="stuck step 4" readOnly /></label>
            <label><span>Disabled</span><TextInput placeholder="Unavailable" disabled /></label>
          </div>
        </section>

        <section className="styleguide-section" aria-labelledby="tooltip-title">
          <div className="styleguide-section-heading">
            <h2 id="tooltip-title">Tooltip and keyboard help</h2>
            <p>Hover or focus the target for its tooltip. Open the help popover for shortcut details.</p>
          </div>
          <div className="styleguide-control-row">
            <Tooltip label="Failed environments: 7" show>
              <button type="button" className="filter-chip">Failed count</button>
            </Tooltip>
            <button type="button" className="action-button button-secondary" aria-expanded={isHelpOpen} onClick={() => setIsHelpOpen((open) => !open)}>Keyboard help</button>
            {isHelpOpen && <div className="styleguide-help-popover" role="dialog" aria-label="Keyboard shortcuts">
              <h3>Keyboard shortcuts</h3>
              <p><kbd>j</kbd> / <kbd>k</kbd> Move through rows</p>
              <p><kbd>Enter</kbd> Open learner details</p>
              <p><kbd>Esc</kbd> Close learner details</p>
            </div>}
          </div>
        </section>

        <section className="styleguide-section" aria-labelledby="scrollbar-title">
          <div className="styleguide-section-heading">
            <h2 id="scrollbar-title">Scrollbar</h2>
            <p>Thin, rounded, and without arrow buttons.</p>
          </div>
          <div className="styleguide-scroll-sample" tabIndex={0} aria-label="Scrollable list of sample environments">
            {Array.from({ length: 8 }, (_, index) => <div key={index}><NameId name={`Learner ${String(index + 1).padStart(2, "0")}`} id={`LAB-${String(index + 1).padStart(3, "0")}`} /></div>)}
          </div>
        </section>

        <section className="styleguide-section" aria-labelledby="state-molecules-title">
          <div className="styleguide-section-heading">
            <h2 id="state-molecules-title">Loading, empty, and error</h2>
            <p>Independent states use the same copy and controls as the dashboard.</p>
          </div>
          <div className="styleguide-molecule-grid">
            <section aria-labelledby="loading-molecule-title">
              <h3 id="loading-molecule-title">Loading</h3>
              <p role="status">Loading environments…</p>
            </section>
            <section aria-labelledby="empty-molecule-title">
              <h3 id="empty-molecule-title">Empty</h3>
              <p>No environments in this session.</p>
            </section>
            <section aria-labelledby="error-molecule-title">
              <h3 id="error-molecule-title">Error</h3>
              <p><StatusLine marker="failed" label="Couldn't reach the server." /></p>
              <ActionButton kind="secondary">Retry</ActionButton>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
