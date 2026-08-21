"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarRange,
  FileText,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  GitPullRequestArrow,
  ShieldAlert,
  Users,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";
import { useSession } from "./SessionContext";
import type { Permission } from "@/lib/rbac";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  hint: string;
  /** Omitted for the views every account can reach. */
  permission?: Permission;
};

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, hint: "Portfolio health and earned value" },
  { href: "/schedule", label: "Schedule", icon: CalendarRange, hint: "WBS, activities and the critical path" },
  { href: "/cost", label: "Cost", icon: Wallet, hint: "Control accounts, commitments and forecast" },
  { href: "/risk", label: "Risk", icon: ShieldAlert, hint: "Register, matrix and mitigation" },
  {
    href: "/changes",
    label: "Changes",
    icon: GitPullRequestArrow,
    hint: "Change orders, trends and the budget they move",
  },
  { href: "/documents", label: "Documents", icon: FileText, hint: "Deliverable register and review status" },
  {
    href: "/users",
    label: "Accounts",
    icon: Users,
    hint: "Who may sign in, and what they may change",
    permission: "user:manage",
  },
];

export function Sidebar({
  collapsed,
  onToggle,
  badges,
}: {
  collapsed: boolean;
  onToggle: () => void;
  badges: Record<string, number | undefined>;
}) {
  const pathname = usePathname();
  const { can } = useSession();

  // Hiding a link nobody may follow is tidiness, not access control: the page
  // and its API both refuse independently.
  const items = NAV.filter((item) => !item.permission || can(item.permission));

  return (
    <nav
      className={`flex flex-none flex-col border-r border-line bg-chrome transition-[width] duration-150 ${
        collapsed ? "w-[52px]" : "w-[184px]"
      }`}
    >
      <ul className="flex flex-col gap-px p-2">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          const badge = badges[item.href];

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                title={collapsed ? `${item.label} — ${item.hint}` : item.hint}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-2.5 rounded-sm px-2 py-1.5 transition-colors ${
                  active
                    ? "bg-accent/10 text-accent-hi"
                    : "text-ink-mute hover:bg-raised hover:text-ink-dim"
                }`}
              >
                {/* Active marker rail, flush to the sidebar edge. */}
                <span
                  className={`absolute -left-2 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-sm bg-accent transition-opacity ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                />
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed ? (
                  <>
                    <span className="truncate text-xs">{item.label}</span>
                    {badge ? (
                      <span className="ml-auto rounded-sm bg-bad-wash px-1 font-mono text-[10px] text-bad tabular">
                        {badge}
                      </span>
                    ) : null}
                  </>
                ) : badge ? (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-bad" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto p-2">
        <button
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-ink-faint transition-colors hover:bg-raised hover:text-ink-mute"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4 shrink-0" />
          ) : (
            <PanelLeftClose className="h-4 w-4 shrink-0" />
          )}
          {!collapsed ? <span className="text-xs">Collapse</span> : null}
        </button>
      </div>
    </nav>
  );
}
