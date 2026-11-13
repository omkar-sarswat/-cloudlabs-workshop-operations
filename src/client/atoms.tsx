import { forwardRef } from "react";
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from "react";

export type MarkerKind = "failed" | "provisioning" | "stuck";

export function StatusMarker({ kind, className = "" }: { kind: MarkerKind; className?: string }) {
  return (
    <svg
      className={`status-marker marker-${kind} ${className}`.trim()}
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "failed" ? <path d="M6 1 11 10H1L6 1Z" /> : null}
      {kind === "provisioning" ? <circle cx="6" cy="6" r="4.25" /> : null}
      {kind === "stuck" ? <path d="M6 0.75 11.25 6 6 11.25.75 6 6 .75Z" /> : null}
    </svg>
  );
}

export function StatusLine({ marker, label }: { marker?: MarkerKind; label: string }) {
  return (
    <span className="status-line">
      {marker ? <StatusMarker kind={marker} /> : null}
      <span>{label}</span>
    </span>
  );
}

export function NameId({ name, id, density = "comfortable" }: { name: string; id: string; density?: "comfortable" | "compact" }) {
  return (
    <span className="name-id" data-density={density}>
      <span className="name-id-name">{name}</span>
      <span className="name-id-value">{id}</span>
    </span>
  );
}

export function StepMeter({ completed, count = 8 }: { completed: number; count?: number }) {
  const safeCompleted = Math.max(0, Math.min(count, completed));
  return (
    <span className="step-meter" aria-label={`${safeCompleted} of ${count} steps complete`}>
      <span className="step-meter-segments" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => {
          const state = index < safeCompleted ? "done" : index === safeCompleted && safeCompleted < count ? "current" : "remaining";
          return <span className={`step-meter-segment segment-${state}`} key={index} />;
        })}
      </span>
      <span className="step-meter-count">{safeCompleted}/{count}</span>
    </span>
  );
}

export function TimeOnStep({ time, stuck = false }: { time: string; stuck?: boolean }) {
  return (
    <span className={`time-on-step${stuck ? " is-stuck" : ""}`}>
      {stuck ? <StatusMarker kind="stuck" /> : null}
      {stuck ? <span className="time-on-step-state">stuck</span> : null}
      <span className="time-on-step-value">{time}</span>
    </span>
  );
}

export function FilterChip({
  label,
  count,
  selected = false,
  disabled = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  count?: number;
  selected?: boolean;
}) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={`filter-chip${selected ? " is-selected" : ""}${className ? ` ${className}` : ""}`}
      aria-pressed={selected}
      disabled={disabled}
    >
      <span>{label}</span>
      {count !== undefined ? <span className="filter-chip-count">{count}</span> : null}
    </button>
  );
}

export function ActionButton({
  kind = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "secondary" }) {
  return <button {...props} type={props.type ?? "button"} className={`action-button button-${kind}${className ? ` ${className}` : ""}`} />;
}

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={`icon-button-atom${className ? ` ${className}` : ""}`}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function DensityControl({ value, onChange }: { value: "comfortable" | "compact"; onChange: (value: "comfortable" | "compact") => void }) {
  return (
    <div className="density-segmented" role="group" aria-label="Table density">
      {(["comfortable", "compact"] as const).map((density) => (
        <button
          type="button"
          key={density}
          aria-pressed={value === density}
          onClick={() => onChange(density)}
        >
          {density === "comfortable" ? "Comfortable" : "Compact"}
        </button>
      ))}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
  <input {...props} ref={ref} className={`text-input${props.className ? ` ${props.className}` : ""}`} />
));

export function Tooltip({
  label,
  children,
  show = false,
  style,
}: {
  label: string;
  children: ReactNode;
  show?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span className={`tooltip-anchor${show ? " is-open" : ""}`} style={style}>
      {children}
      <span className="tooltip-content" role="tooltip">{label}</span>
    </span>
  );
}
