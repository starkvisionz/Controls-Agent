"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { ProjectWithMetrics } from "@/components/shell/ProjectContext";
import { PROJECT_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Role } from "@/lib/rbac";
import { MIN_PASSWORD_CHARS, type FieldError } from "@/lib/validation";
import type { PublicUser } from "@/lib/users";

type Scope = "all" | "some";

/**
 * Create or amend one account.
 *
 * The fields mirror the shared Zod schemas the API validates with, so a value
 * this form accepts is one the route accepts. The rules the form cannot know —
 * whether this is the last administrator, whether the address is taken — come
 * back as field errors and are shown against the field they name.
 */
export function UserEditor({
  user,
  projects,
  isSelf,
  onClose,
  onSaved,
}: {
  user: PublicUser | null;
  projects: ProjectWithMetrics[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const creating = user === null;

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "viewer");
  const [active, setActive] = useState(user?.is_active ?? true);
  const [password, setPassword] = useState("");
  const [scope, setScope] = useState<Scope>(
    user && user.projects.length > 0 ? "some" : "all"
  );
  const [grants, setGrants] = useState<Record<string, Role | "inherit" | undefined>>(() => {
    const initial: Record<string, Role | "inherit"> = {};
    for (const g of user?.projects ?? []) initial[g.project_id] = g.role ?? "inherit";
    return initial;
  });

  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);

  const messageFor = (field: string) => errors.find((e) => e.field === field)?.message;

  const grantList = () =>
    scope === "all"
      ? []
      : Object.entries(grants)
          .filter(([, value]) => value !== undefined)
          .map(([project_id, value]) => ({
            project_id,
            role: value === "inherit" ? null : (value as Role),
          }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors([]);

    const body = creating
      ? { email, name, password, role, projects: grantList() }
      : {
          name,
          // Self-edits are limited to a rename: an administrator demoting or
          // disabling themselves is how an instance ends up with nobody who
          // can fix it, so the route refuses it and the form does not offer it.
          ...(isSelf ? {} : { role, is_active: active, projects: grantList() }),
          ...(password ? { password } : {}),
        };

    try {
      const res = await fetch(creating ? "/api/users" : `/api/users/${user.id}`, {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        fields?: FieldError[];
      };
      if (!res.ok) {
        setErrors(
          payload.fields ?? [{ field: "(request)", message: payload.error ?? "That did not work." }]
        );
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
    "mt-1.5 h-8 w-full rounded-sm border border-line bg-raised px-2 text-xs text-ink focus:border-accent/50";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-[86vh] w-full max-w-[440px] flex-col rounded-panel border border-line-strong bg-overlay shadow-2xl shadow-black/60">
        <div className="flex flex-none items-center justify-between border-b border-line px-3 py-2">
          <h2 className="text-2xs font-medium text-ink">
            {creating ? "New account" : user.name}
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
          <label htmlFor="u-name" className="label">
            Name
          </label>
          <input
            id="u-name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            className={field}
          />
          {messageFor("name") ? <p className="mt-1 text-2xs text-bad">Name {messageFor("name")}</p> : null}

          <label htmlFor="u-email" className="label mt-3 block">
            Email
          </label>
          <input
            id="u-email"
            type="email"
            value={email}
            // The address is the sign-in identity and the audit handle; changing
            // it would quietly reassign both.
            disabled={!creating}
            onChange={(e) => setEmail(e.target.value)}
            className={`${field} disabled:text-ink-faint`}
          />
          {messageFor("email") ? (
            <p className="mt-1 text-2xs text-bad">Email {messageFor("email")}</p>
          ) : null}

          <label htmlFor="u-password" className="label mt-3 block">
            {creating ? "Starting password" : "Reset password"}
          </label>
          <input
            id="u-password"
            type="password"
            autoComplete="new-password"
            value={password}
            placeholder={creating ? "" : "leave blank to keep the current one"}
            onChange={(e) => setPassword(e.target.value)}
            className={`${field} placeholder:text-ink-faint`}
          />
          <p className="mt-1 text-2xs text-ink-faint">
            {messageFor("password") ? (
              <span className="text-bad">Password {messageFor("password")}</span>
            ) : (
              `At least ${MIN_PASSWORD_CHARS} characters. They will be asked to replace it at first sign-in.`
            )}
          </p>

          <fieldset className="mt-4" disabled={isSelf}>
            <legend className="label">Role</legend>
            <div className="mt-1.5 flex flex-col gap-px">
              {ROLES.map((r) => (
                <label
                  key={r}
                  className={`flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 transition-colors ${
                    role === r ? "bg-accent/10" : "hover:bg-raised"
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    checked={role === r}
                    onChange={() => setRole(r)}
                    className="mt-0.5 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0">
                    <span className={`text-2xs ${role === r ? "text-accent-hi" : "text-ink-dim"}`}>
                      {ROLE_LABELS[r]}
                    </span>
                    <span className="block text-[10px] leading-relaxed text-ink-faint">
                      {ROLE_DESCRIPTIONS[r]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {messageFor("role") ? <p className="mt-1 text-2xs text-bad">{messageFor("role")}</p> : null}
          </fieldset>

          <fieldset className="mt-4" disabled={isSelf}>
            <legend className="label">Projects</legend>
            <div className="mt-1.5 flex items-center gap-3">
              {(["all", "some"] as Scope[]).map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-1.5 text-2xs text-ink-mute">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === s}
                    onChange={() => setScope(s)}
                    className="accent-[var(--color-accent)]"
                  />
                  {s === "all" ? "Whole portfolio" : "Selected projects"}
                </label>
              ))}
            </div>

            {scope === "some" ? (
              <div className="mt-2 flex flex-col gap-px rounded-sm border border-line p-1">
                {projects.map((p) => {
                  const value = grants[p.id];
                  return (
                    <div key={p.id} className="flex items-center gap-2 px-1.5 py-1">
                      <input
                        id={`grant-${p.id}`}
                        type="checkbox"
                        checked={value !== undefined}
                        onChange={(e) =>
                          setGrants((g) => ({ ...g, [p.id]: e.target.checked ? "inherit" : undefined }))
                        }
                        className="accent-[var(--color-accent)]"
                      />
                      <label htmlFor={`grant-${p.id}`} className="min-w-0 flex-1 cursor-pointer truncate text-2xs">
                        <span className="font-mono text-accent-hi tabular">{p.code}</span>
                        <span className="ml-1.5 text-ink-mute">{p.name}</span>
                      </label>
                      <select
                        value={value ?? "inherit"}
                        disabled={value === undefined}
                        onChange={(e) => setGrants((g) => ({ ...g, [p.id]: e.target.value as Role | "inherit" }))}
                        className="h-6 rounded-sm border border-line bg-raised px-1 text-[10px] text-ink-dim disabled:opacity-40"
                      >
                        <option value="inherit" className="bg-overlay">
                          Same as role
                        </option>
                        {PROJECT_ROLES.map((r) => (
                          <option key={r} value={r} className="bg-overlay">
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
                Sees every project in the portfolio, at the role above. Projects added later are
                included automatically.
              </p>
            )}
            {messageFor("projects") ? (
              <p className="mt-1 text-2xs text-bad">Projects {messageFor("projects")}</p>
            ) : null}
          </fieldset>

          {!creating ? (
            <label className="mt-4 flex items-start gap-2">
              <input
                type="checkbox"
                checked={!active}
                disabled={isSelf}
                onChange={(e) => setActive(!e.target.checked)}
                className="mt-0.5 accent-[var(--color-bad)] disabled:opacity-40"
              />
              <span className="min-w-0">
                <span className="text-2xs text-ink-dim">Disable this account</span>
                <span className="block text-[10px] leading-relaxed text-ink-faint">
                  Ends its sessions immediately and refuses further sign-ins. The row stays, so
                  what it did keeps a name.
                </span>
              </span>
            </label>
          ) : null}

          {isSelf ? (
            <p className="mt-4 rounded-sm border border-line bg-raised px-2 py-1.5 text-[10px] leading-relaxed text-ink-faint">
              This is your own account, so its role, access and state are fixed here. Another
              administrator can change them.
            </p>
          ) : null}

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
              disabled={
                busy ||
                name.trim().length === 0 ||
                (creating && (email.trim().length === 0 || password.length < MIN_PASSWORD_CHARS))
              }
              className="h-8 flex-1 rounded-sm bg-accent text-2xs font-medium text-black disabled:bg-line disabled:text-ink-faint"
            >
              {busy ? "Saving…" : creating ? "Create account" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
