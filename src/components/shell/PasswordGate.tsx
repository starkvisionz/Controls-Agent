"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MIN_PASSWORD_CHARS } from "@/lib/validation";
import type { FieldError } from "@/lib/validation";

/**
 * Shown instead of the application when the account is still on a starting
 * password an administrator chose.
 *
 * It replaces the shell rather than sitting over it: a credential somebody else
 * knows should not be able to read a page of cost data first and change itself
 * afterwards.
 */
export function PasswordGate({ name }: { name: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);

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
      router.refresh();
    } catch {
      setErrors([{ field: "(request)", message: "Could not reach the server." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-dvh items-center justify-center bg-canvas p-6">
      <form onSubmit={submit} className="w-full max-w-[340px]">
        <div className="mb-6 text-center">
          <div className="text-sm font-semibold tracking-[0.16em] text-ink">STARKVISIONZ</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-faint">
            Project Controls
          </div>
        </div>

        <div className="panel p-4">
          <h1 className="text-xs font-medium text-ink">Choose a password, {name.split(" ")[0]}</h1>
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-mute">
            This account is on a starting password somebody else set. Replace it before going
            any further.
          </p>

          <label htmlFor="current" className="label mt-4 block">
            Starting password
          </label>
          <input
            id="current"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="mt-1.5 h-8 w-full rounded-sm border border-line bg-raised px-2 text-xs text-ink focus:border-accent/50"
          />
          {messageFor("current_password") ? (
            <p className="mt-1 text-2xs text-bad">Starting password {messageFor("current_password")}</p>
          ) : null}

          <label htmlFor="next" className="label mt-3 block">
            New password
          </label>
          <input
            id="next"
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
              `At least ${MIN_PASSWORD_CHARS} characters. Length is the only rule.`
            )}
          </p>

          {messageFor("(request)") ? (
            <p className="mt-2 text-2xs text-bad">{messageFor("(request)")}</p>
          ) : null}

          <button
            type="submit"
            disabled={busy || current.length === 0 || next.length < MIN_PASSWORD_CHARS}
            className="mt-4 h-8 w-full rounded-sm bg-accent text-2xs font-medium text-black transition-opacity disabled:bg-line disabled:text-ink-faint"
          >
            {busy ? "Saving…" : "Set password and continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
