"use client";

import { Lock, Search } from "lucide-react";
import type { ReactNode } from "react";

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line bg-chrome px-3 py-2">
      {children}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-6 w-full rounded-sm border border-line bg-raised pl-7 pr-2 text-2xs text-ink placeholder:text-ink-faint focus:border-accent/50"
      />
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1.5">
      {label ? <span className="label whitespace-nowrap">{label}</span> : null}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 rounded-sm border border-line bg-raised px-1.5 text-2xs text-ink-dim focus:border-accent/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-overlay">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex shrink-0 items-center gap-px rounded-sm border border-line bg-raised p-px">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded-[2px] px-2 py-0.5 text-2xs transition-colors ${
            value === o.value
              ? "bg-accent/15 text-accent-hi"
              : "text-ink-mute hover:bg-overlay hover:text-ink-dim"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function IconButton({
  children,
  onClick,
  title,
  active = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`flex h-6 w-6 items-center justify-center rounded-sm transition-colors disabled:opacity-40 ${
        active ? "bg-accent/15 text-accent-hi" : "text-ink-mute hover:bg-raised hover:text-ink-dim"
      } [&>svg]:h-3.5 [&>svg]:w-3.5`}
    >
      {children}
    </button>
  );
}

export function StateMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-xs text-ink-dim">{title}</p>
      {detail ? <p className="max-w-sm text-2xs text-ink-faint">{detail}</p> : null}
    </div>
  );
}

export function LoadingPane({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-2xs text-ink-faint">
      <span className="animate-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
      {label}…
    </div>
  );
}

/**
 * Shown in place of an editor when the account may read a register but not
 * change it.
 *
 * The controls are still rendered, disabled, rather than removed: seeing the
 * fields greyed out with a reason attached tells you what you would be able to
 * do with more access, which "the panel is simply missing" does not.
 */
export function ReadOnlyNote({ what, role }: { what: string; role: string }) {
  return (
    <p className="mb-3 rounded-sm border border-line bg-raised px-2 py-1.5 text-[10px] leading-relaxed text-ink-faint">
      <Lock className="mr-1 inline h-2.5 w-2.5 -translate-y-px" />
      Your role ({role}) can read {what} but not change it. Ask an administrator if that is
      wrong.
    </p>
  );
}
