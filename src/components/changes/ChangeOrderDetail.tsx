"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ReadOnlyNote } from "@/components/ui/Controls";
import { useSession } from "@/components/shell/SessionContext";
import { ROLE_LABELS } from "@/lib/rbac";
import { money, shortDate } from "@/lib/format";
import { CHANGE_STATUSES, changeOrderRules, type FieldError } from "@/lib/validation";
import type { ChangeOrderRow, ProjectMetrics } from "@/lib/types";
import { STATUS_TONE } from "./ChangesView";

type Account = { id: string; code: string; name: string; category: string; current_budget: number };

/**
 * One change order, and the decision on it.
 *
 * Approving is the only control on this page that moves money, so it says what
 * it is about to do — which budget, and by how much — before it is pressed. The
 * same rules the API enforces run here first (`changeOrderRules`), so a refusal
 * is shown against the field that caused it rather than discovered on submit.
 */
export function ChangeOrderDetail({
  order,
  accounts,
  metrics,
  onClose,
  onSaved,
}: {
  order: ChangeOrderRow;
  accounts: Account[];
  metrics: ProjectMetrics;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { can, role } = useSession();
  const editable = can("cost:write", order.project_id);

  // Initialised once; the parent remounts this per order and per saved
  // revision, which is React's own answer to resetting form state.
  const [status, setStatus] = useState(order.status);
  const [accountId, setAccountId] = useState(order.cost_account_id ?? "");
  const [value, setValue] = useState(String(order.cost_impact));
  const [days, setDays] = useState(String(order.schedule_impact_days));
  const [decisionDate, setDecisionDate] = useState(order.decision_date ?? "");
  const [submittedDate, setSubmittedDate] = useState(order.submitted_date ?? "");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);

  const numericValue = Number(value);
  const numericDays = Number(days);

  const dirty =
    status !== order.status ||
    accountId !== (order.cost_account_id ?? "") ||
    numericValue !== order.cost_impact ||
    numericDays !== order.schedule_impact_days ||
    decisionDate !== (order.decision_date ?? "") ||
    submittedDate !== (order.submitted_date ?? "");

  // The same cross-field rules the route runs, so the button is honest about
  // what will happen when it is pressed.
  const localErrors = changeOrderRules({
    status,
    cost_account_id: accountId || null,
    cost_impact: Number.isFinite(numericValue) ? numericValue : 0,
    raised_date: order.raised_date,
    submitted_date: submittedDate || null,
    decision_date: decisionDate || null,
  });

  const shown = errors.length > 0 ? errors : localErrors;
  const messageFor = (field: string) => shown.find((e) => e.field === field)?.message;

  const account = accounts.find((a) => a.id === accountId);
  const willMoveBudget = status === "approved" && order.status !== "approved";
  const willReleaseBudget = order.status === "approved" && status !== "approved";

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const res = await fetch(`/api/change-orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          cost_account_id: accountId || null,
          cost_impact: numericValue,
          schedule_impact_days: numericDays,
          submitted_date: submittedDate || null,
          decision_date: decisionDate || null,
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
      setSaving(false);
    }
  };

  const field =
    "mt-1 h-7 w-full rounded-sm border border-line bg-raised px-1.5 text-2xs text-ink focus:border-accent/50 disabled:text-ink-faint";

  return (
    <aside className="flex w-[320px] flex-none flex-col border-l border-line bg-surface">
      <header className="panel-head">
        <h3 className="truncate font-mono text-2xs text-ink-dim">{order.code}</h3>
        {order.client_ref ? (
          <span className="truncate text-[10px] text-ink-faint">{order.client_ref}</span>
        ) : null}
        <button
          onClick={onClose}
          aria-label="Close change order detail"
          className="ml-auto text-ink-faint hover:text-ink-dim"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <h4 className="text-xs leading-snug text-ink">{order.title}</h4>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge tone={STATUS_TONE[order.status] ?? "neutral"}>{order.status}</Badge>
          <Badge>{order.origin}</Badge>
        </div>

        {order.description ? (
          <p className="mt-2.5 text-2xs leading-relaxed text-ink-mute">{order.description}</p>
        ) : null}

        <dl className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
          <Row label="Raised" value={shortDate(order.raised_date)} />
          <Row label="Submitted" value={shortDate(order.submitted_date)} />
          <Row label="Decided" value={shortDate(order.decision_date)} />
          <Row label="Owner" value={order.owner || "—"} />
          <Row
            label="Allocated to"
            value={order.account_code ? `${order.account_code}` : "not allocated"}
          />
        </dl>

        <fieldset className="mt-4 border-t border-line pt-3" disabled={!editable}>
          <div className="label mb-2">Decision</div>

          {!editable ? <ReadOnlyNote what="change orders" role={ROLE_LABELS[role]} /> : null}

          <p className="mb-3 rounded-sm border border-line bg-raised px-2 py-1.5 text-[10px] leading-relaxed text-ink-mute">
            Approving allocates this order to a control account and moves that
            budget. Schedule impact is recorded but{" "}
            <strong className="text-ink-dim">not</strong> applied — forecast dates stay as
            imported until the schedule is republished.
          </p>

          <div className="grid grid-cols-2 gap-1">
            {CHANGE_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-sm border px-1.5 py-1 text-[10px] uppercase tracking-wide transition-colors ${
                  status === s
                    ? "border-accent/50 bg-accent/10 text-accent-hi"
                    : "border-line bg-raised text-ink-mute hover:text-ink-dim"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <label htmlFor="co-account" className="label mt-3 block">
            Control account
          </label>
          <select
            id="co-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={`${field} px-1`}
          >
            <option value="" className="bg-overlay">
              Not allocated
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id} className="bg-overlay">
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          {messageFor("cost_account_id") ? (
            <p className="mt-1 text-[10px] text-bad">Control account {messageFor("cost_account_id")}</p>
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="co-value" className="label block">
                Cost impact
              </label>
              <input
                id="co-value"
                type="number"
                step={1000}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={`${field} font-mono tabular`}
              />
            </div>
            <div>
              <label htmlFor="co-days" className="label block">
                Days
              </label>
              <input
                id="co-days"
                type="number"
                step={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className={`${field} font-mono tabular`}
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="co-submitted" className="label block">
                Submitted
              </label>
              <input
                id="co-submitted"
                type="date"
                value={submittedDate}
                onChange={(e) => setSubmittedDate(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="co-decided" className="label block">
                Decided
              </label>
              <input
                id="co-decided"
                type="date"
                value={decisionDate}
                onChange={(e) => setDecisionDate(e.target.value)}
                className={field}
              />
            </div>
          </div>
          {messageFor("decision_date") ? (
            <p className="mt-1 text-[10px] text-bad">Decision date {messageFor("decision_date")}</p>
          ) : null}
          {messageFor("submitted_date") ? (
            <p className="mt-1 text-[10px] text-bad">
              Submitted date {messageFor("submitted_date")}
            </p>
          ) : null}

          {/* What pressing the button is about to do, in the units it does it in. */}
          {willMoveBudget && account ? (
            <p className="mt-3 rounded-sm border border-warn/30 bg-warn-wash px-2 py-1.5 text-[10px] leading-relaxed text-warn">
              {account.code} moves from {money(account.current_budget, { compact: true })} to{" "}
              {money(account.current_budget + numericValue, { compact: true })}, and the project
              budget with it. CPI and the forecast follow in the same write.
            </p>
          ) : null}
          {willReleaseBudget ? (
            <p className="mt-3 rounded-sm border border-line bg-raised px-2 py-1.5 text-[10px] leading-relaxed text-ink-mute">
              This order is currently in the budget. Moving it off approved releases{" "}
              {money(order.cost_impact, { compact: true, sign: true })} back out of{" "}
              {order.account_code ?? "its account"}.
            </p>
          ) : null}

          {messageFor("(request)") ? (
            <p className="mt-2 text-2xs text-bad">{messageFor("(request)")}</p>
          ) : null}

          <button
            onClick={save}
            disabled={!dirty || saving || localErrors.length > 0 || !Number.isFinite(numericValue)}
            className="mt-3 w-full rounded-sm bg-accent px-2 py-1.5 text-2xs font-medium text-black transition-opacity disabled:bg-line disabled:text-ink-faint"
          >
            {saving
              ? "Saving…"
              : !dirty
                ? "No changes"
                : willMoveBudget
                  ? "Approve and move the budget"
                  : "Save decision"}
          </button>
        </fieldset>

        <p className="mt-3 border-t border-line pt-2.5 text-[10px] leading-relaxed text-ink-faint">
          Project budget {money(metrics.bac, { compact: true })} · CPI {metrics.cpi.toFixed(3)}
        </p>
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="label shrink-0">{label}</dt>
      <dd className="truncate text-right font-mono text-2xs text-ink-dim tabular" title={value}>
        {value}
      </dd>
    </div>
  );
}
