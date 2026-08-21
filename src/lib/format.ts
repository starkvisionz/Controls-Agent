/** Display helpers shared by every view. Kept pure so charts and tables agree. */

export function money(value: number, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const { compact = false, sign = false } = opts;
  const abs = Math.abs(value);
  const prefix = sign && value > 0 ? "+" : value < 0 ? "-" : "";

  if (compact) {
    if (abs >= 1_000_000_000) return `${prefix}$${(abs / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${prefix}$${(abs / 1_000).toFixed(0)}K`;
    return `${prefix}$${abs.toFixed(0)}`;
  }
  return `${prefix}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function percent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function index(value: number): string {
  return value.toFixed(3);
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function monthLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Green when a performance index is at or above 1.0, amber near, red below. */
export function indexTone(value: number): "good" | "warn" | "bad" {
  if (value >= 1.0) return "good";
  if (value >= 0.95) return "warn";
  return "bad";
}

/** Variance is favourable when positive (EV above AC / PV). */
export function varianceTone(value: number): "good" | "warn" | "bad" {
  if (value > 0) return "good";
  if (value === 0) return "warn";
  return "bad";
}

export function severityBand(severity: number): "low" | "medium" | "high" | "extreme" {
  if (severity >= 20) return "extreme";
  if (severity >= 12) return "high";
  if (severity >= 6) return "medium";
  return "low";
}

export function titleCase(input: string): string {
  return input
    .split(/[-_\s]+/)
    .map((w) => (w.length <= 3 && w === w.toLowerCase() && /^(ifr|ifa|ifc)$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
}
