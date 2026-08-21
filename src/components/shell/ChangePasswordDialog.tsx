"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { MIN_PASSWORD_CHARS, type FieldError } from "@/lib/validation";

/** Changing your own password from the account menu. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const escape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  const messageFor = (field: string) => errors.find((e) => e.field === field)?.message;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        fields?: FieldError[];
      };
      if (!res.ok) {
        setErrors(body.fields ?? [{ field: "(request)", message: body.error ?? "That did not work." }]);
        return;
      }
      setDone(true);
    } catch {
      setErrors([{ field: "(request)", message: "Could not reach the server." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-[340px] rounded-panel border border-line-strong bg-overlay shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <h2 className="text-2xs font-medium text-ink">Change password</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-5 w-5 items-center justify-center rounded-sm text-ink-faint transition-colors hover:text-ink-dim"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {done ? (
          <div className="p-4">
            <p className="text-2xs leading-relaxed text-ink-mute">
              Password changed. Any other session signed in as you has ended.
            </p>
            <button
              onClick={onClose}
              className="mt-4 h-8 w-full rounded-sm bg-accent text-2xs font-medium text-black"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-4">
            <label htmlFor="pw-current" className="label">
              Current password
            </label>
            <input
              id="pw-current"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="mt-1.5 h-8 w-full rounded-sm border border-line bg-raised px-2 text-xs text-ink focus:border-accent/50"
            />
            {messageFor("current_password") ? (
              <p className="mt-1 text-2xs text-bad">
                Current password {messageFor("current_password")}
              </p>
            ) : null}

            <label htmlFor="pw-next" className="label mt-3 block">
              New password
            </label>
            <input
              id="pw-next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="mt-1.5 h-8 w-full rounded-sm border border-line bg-raised px-2 text-xs text-ink focus:border-accent/50"
            />
            <p className="mt-1 text-2xs text-ink-faint">
              {messageFor("new_password") ? (
                <span className="text-bad">New password {messageFor("new_password")}</span>
              ) : (
                `At least ${MIN_PASSWORD_CHARS} characters.`
              )}
            </p>

            {messageFor("(request)") ? (
              <p className="mt-2 text-2xs text-bad">{messageFor("(request)")}</p>
            ) : null}

            <button
              type="submit"
              disabled={busy || current.length === 0 || next.length < MIN_PASSWORD_CHARS}
              className="mt-4 h-8 w-full rounded-sm bg-accent text-2xs font-medium text-black disabled:bg-line disabled:text-ink-faint"
            >
              {busy ? "Saving…" : "Change password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
