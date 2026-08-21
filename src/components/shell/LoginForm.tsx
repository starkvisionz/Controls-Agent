"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Sign in failed");
      }
      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel p-4">
      <label htmlFor="password" className="label">
        Operator password
      </label>
      <input
        id="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1.5 h-8 w-full rounded-sm border border-line bg-raised px-2 text-xs text-ink focus:border-accent/50"
      />

      {error ? <p className="mt-2 text-2xs text-bad">{error}</p> : null}

      <button
        type="submit"
        disabled={busy || password.length === 0}
        className="mt-3 h-8 w-full rounded-sm bg-accent text-2xs font-medium text-black transition-opacity disabled:bg-line disabled:text-ink-faint"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
