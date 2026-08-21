"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { CHANGE_ORIGINS, type FieldError } from "@/lib/validation";
import { money } from "@/lib/format";

type Account = { id: string; code: string; name: string; category: string; current_budget: number };

/**
 * Raising a trend.
 *
 * A trend is the register's entry point — the moment somebody notices cost the
 * estimate does not carry. It starts open, so nothing here moves a budget; the
 * allocation is asked for anyway, because pricing a change against an account
 * is what makes approving it later a decision rather than a data-entry task.
 */
export function RaiseChangeOrder({
  projectId,
  nextCode,
  dataDate,
  accounts,
  onClose,
  onSaved,
}: {
  projectId: string;
  nextCode: string;
  dataDate: string;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [origin, setOrigin] = useState<(typeof CHANGE_ORIGINS)[number]>("Client");
  const [accountId, setAccountId] = useState("");
  const [value, setValue] = useState("");
  const [days, setDays] = useState("0");
  const [raisedDate, setRaisedDate] = useState(dataDate);
  const [owner, setOwner] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);

  const messageFor = (f: string) => errors.find((e) => e.field === f)?.message;
  const numericValue = Number(value || 0);
  const account = accounts.find((a) => a.id === accountId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch(`/api/projects/${projectId}/change-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          origin,
          status: "trend",
          cost_account_id: accountId || null,
          cost_impact: numericValue,
          schedule_impact_days: Number(days || 0),
          raised_date: raisedDate,
          owner,
          description,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        fields?: FieldError[];
      };
      if (!res.ok) {
        setErrors(body.fields ?? [{ field: "(request)", message: body.error ?? "Could not save" }]);
        return;
      }
      onSaved();
    } catch {
      setErrors([{ field: "(request)", message: "Could not reach the server." }]);
    } finally {
      setBusy(false);
    }
  };

  const field =
    "mt-1 h-8 w-full rounded-sm border border-line bg-raised px-2 text-xs text-ink focus:border-accent/50";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-[86vh] w-full max-w-[420px] flex-col rounded-panel border border-line-strong bg-overlay shadow-2xl shadow-black/60">
        <div className="flex flex-none items-center justify-between border-b border-line px-3 py-2">
          <h2 className="text-2xs font-medium text-ink">
            Raise a trend <span className="ml-1 font-mono text-ink-faint">{nextCode}</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-5 w-5 items-center justify-center rounded-sm text-ink-faint transition-colors hover:text-ink-dim"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        <form onSubmit={submit} className="min-h-0 flex-1 overflow-auto p-4">
          <label htmlFor="co-title" className="label">
            Title
          </label>
          <input
            id="co-title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What has changed?"
            className={`${field} placeholder:text-ink-faint`}
          />
          {messageFor("title") ? (
            <p className="mt-1 text-2xs text-bad">Title {messageFor("title")}</p>
          ) : null}

          <label htmlFor="co-origin" className="label mt-3 block">
            Origin
          </label>
          <select
            id="co-origin"
            value={origin}
            onChange={(e) => setOrigin(e.target.value as (typeof CHANGE_ORIGINS)[number])}
            className={field}
          >
            {CHANGE_ORIGINS.map((o) => (
              <option key={o} value={o} className="bg-overlay">
                {o}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-ink-faint">
            Client-driven change is recoverable; the rest the project carries itself.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="co-new-value" className="label block">
                Cost impact
              </label>
              <input
                id="co-new-value"
                type="number"
                step={1000}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                className={`${field} font-mono tabular placeholder:text-ink-faint`}
              />
              <p className="mt-1 text-[10px] text-ink-faint">Negative for a saving.</p>
            </div>
            <div>
              <label htmlFor="co-new-days" className="label block">
                Days
              </label>
              <input
                id="co-new-days"
                type="number"
                step={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className={`${field} font-mono tabular`}
              />
              <p className="mt-1 text-[10px] text-ink-faint">Recorded, not applied.</p>
            </div>
          </div>

          <label htmlFor="co-new-account" className="label mt-3 block">
            Control account
          </label>
          <select
            id="co-new-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={field}
          >
            <option value="" className="bg-overlay">
              Decide later
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id} className="bg-overlay">
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">
            {account
              ? `${account.code} currently holds ${money(account.current_budget, { compact: true })}. Nothing moves until this is approved.`
              : "Optional now, required before this can be approved."}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="co-raised" className="label block">
                Raised
              </label>
              <input
                id="co-raised"
                type="date"
                value={raisedDate}
                onChange={(e) => setRaisedDate(e.target.value)}
                className={field}
              />
              {messageFor("raised_date") ? (
                <p className="mt-1 text-[10px] text-bad">{messageFor("raised_date")}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="co-owner" className="label block">
                Owner
              </label>
              <input
                id="co-owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="Who is chasing it"
                className={`${field} placeholder:text-ink-faint`}
              />
            </div>
          </div>

          <label htmlFor="co-desc" className="label mt-3 block">
            Description
          </label>
          <textarea
            id="co-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What drove it, and what it covers."
            className="mt-1 w-full resize-y rounded-sm border border-line bg-raised px-2 py-1.5 text-xs leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent/50"
          />

          {messageFor("(request)") ? (
            <p className="mt-3 text-2xs text-bad">{messageFor("(request)")}</p>
          ) : null}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 flex-1 rounded-sm border border-line bg-raised text-2xs text-ink-mute transition-colors hover:text-ink-dim"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || title.trim().length === 0}
              className="h-8 flex-1 rounded-sm bg-accent text-2xs font-medium text-black disabled:bg-line disabled:text-ink-faint"
            >
              {busy ? "Saving…" : "Log the trend"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
