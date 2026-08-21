"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useSession } from "./SessionContext";
import { ROLE_LABELS } from "@/lib/rbac";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

/**
 * Who you are signed in as, and the two things you can do about it.
 *
 * The role is on the face of the control rather than buried in the menu: when a
 * control elsewhere is missing, the first question is which account this is,
 * and the answer should not need a click.
 */
export function AccountMenu() {
  const router = useRouter();
  const { principal, enforced, role } = useSession();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const initials = principal.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          title={`${principal.name} — ${ROLE_LABELS[role]}`}
          className="flex h-6 items-center gap-1.5 rounded-sm border border-line bg-raised pl-1 pr-2 text-2xs transition-colors hover:border-line-strong"
        >
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-sm bg-accent/15 font-mono text-[9px] font-medium text-accent-hi">
            {initials || "?"}
          </span>
          <span className="hidden text-ink-dim lg:inline">{ROLE_LABELS[role]}</span>
        </button>

        {open ? (
          <div
            role="menu"
            className="animate-in absolute right-0 top-7 z-50 w-[260px] overflow-hidden rounded-panel border border-line-strong bg-overlay shadow-2xl shadow-black/60"
          >
            <div className="border-b border-line px-3 py-2">
              <div className="flex items-center gap-2">
                <UserRound className="h-3 w-3 shrink-0 text-ink-faint" />
                <span className="truncate text-2xs text-ink">{principal.name}</span>
              </div>
              <div className="mt-0.5 truncate pl-5 text-[10px] text-ink-faint">
                {principal.email}
              </div>
              <div className="mt-1.5 flex items-center gap-2 pl-5">
                <ShieldCheck className="h-3 w-3 shrink-0 text-accent" />
                <span className="text-[10px] text-ink-mute">{ROLE_LABELS[role]}</span>
              </div>
              {principal.grants.length > 0 ? (
                <div className="mt-1 pl-5 text-[10px] text-ink-faint">
                  {principal.grants.length} project
                  {principal.grants.length === 1 ? "" : "s"} in scope
                </div>
              ) : null}
            </div>

            {!enforced ? (
              <div className="border-b border-line bg-warn-wash px-3 py-2 text-[10px] leading-relaxed text-warn">
                Access control is off. No session secret is configured, so every visitor is
                this administrator.
              </div>
            ) : null}

            {enforced ? (
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setChanging(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-2xs text-ink-mute transition-colors hover:bg-raised hover:text-ink-dim"
              >
                <KeyRound className="h-3 w-3" />
                Change password
              </button>
            ) : null}

            <button
              role="menuitem"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                router.replace("/login");
                // Drops the cached RSC payload so no project data survives the
                // sign-out in the client router cache.
                router.refresh();
              }}
              className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-2xs text-ink-mute transition-colors hover:bg-raised hover:text-ink-dim"
            >
              <LogOut className="h-3 w-3" />
              Sign out
            </button>
          </div>
        ) : null}
      </div>

      {changing ? <ChangePasswordDialog onClose={() => setChanging(false)} /> : null}
    </>
  );
}
