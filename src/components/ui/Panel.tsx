import type { ReactNode } from "react";

export function Panel({
  children,
  className = "",
  flush = false,
}: {
  children: ReactNode;
  className?: string;
  /** Removes the internal padding — for panels holding their own table. */
  flush?: boolean;
}) {
  return (
    <section className={`panel flex min-h-0 flex-col ${flush ? "" : "p-3"} ${className}`}>
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="panel-head">
      {icon ? <span className="text-ink-mute [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span> : null}
      <h2 className="text-2xs font-medium tracking-wide text-ink-dim">{title}</h2>
      {subtitle ? <span className="truncate text-2xs text-ink-faint">{subtitle}</span> : null}
      {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
    </header>
  );
}

/** Section label used inside a padded panel body. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="label mb-2">{children}</div>;
}
