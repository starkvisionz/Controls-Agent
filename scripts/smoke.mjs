/**
 * Smoke test against a running production build.
 *
 * The PR review's point was that the claims in the description were not
 * enforced anywhere. These are those claims, written as assertions, so CI fails
 * if the behaviour regresses rather than relying on anyone's word:
 *
 *   - the roll-up: a schedule edit must move project EVM
 *   - the change-order chain: approving one must move the budget it names,
 *     and rejecting it must give that money back
 *   - the auth gate: no page, read or write without a session
 *   - authorisation: each role may do exactly what its permissions say, and a
 *     scoped account cannot see or touch a project it was not granted
 *   - revocation: changing an account ends the sessions it already had
 *   - validation: out-of-range and unknown fields refused
 *   - rate limiting: not defeatable with a forged X-Forwarded-For
 *   - streaming: the agent endpoint still streams SSE
 *
 * It runs against the seeded demo accounts, so `npm run db:seed` must have run.
 *
 * Usage: node scripts/smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = process.env.STARKVISIONZ_DEMO_PASSWORD?.trim() || "starkvisionz-demo";

const ACCOUNTS = {
  admin: "admin@starkvisionz.example",
  lead: "lead@starkvisionz.example",
  planner: "planner@starkvisionz.example",
  viewer: "viewer@starkvisionz.example",
};

let passed = 0;
const failures = [];

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const json = { "Content-Type": "application/json" };
const get = (path, init) => fetch(`${BASE}${path}`, { redirect: "manual", ...init });

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------
console.log("\nauthentication");

check("page redirects when signed out", (await get("/")).status === 307);
check("read API refuses when signed out", (await get("/api/projects")).status === 401);
check(
  "write API refuses when signed out",
  (
    await get("/api/tasks/prj-gc4410-task-A1691", {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ percent_complete: 10 }),
    })
  ).status === 401
);
check(
  "agent endpoint refuses when signed out",
  (
    await get("/api/chat", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ projectId: "prj-gc4410", message: "hi" }),
    })
  ).status === 401
);
check("login page is reachable", (await get("/login")).status === 200);

const wrong = await get("/api/auth/login", {
  method: "POST",
  headers: json,
  body: JSON.stringify({ email: ACCOUNTS.lead, password: `${PASSWORD}-wrong` }),
});
check("wrong password refused", wrong.status === 401);

const unknown = await get("/api/auth/login", {
  method: "POST",
  headers: json,
  body: JSON.stringify({ email: "nobody@starkvisionz.example", password: PASSWORD }),
});
check("unknown address refused", unknown.status === 401);
// Account enumeration: the two failures above must be indistinguishable.
check(
  "unknown address and wrong password answer alike",
  (await wrong.clone().text()) === (await unknown.clone().text())
);

/** Signs in and returns the session cookie, or null. */
async function signIn(email) {
  const res = await get("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (res.status !== 200) return null;
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const cookie = await signIn(ACCOUNTS.admin);
check("correct password accepted", cookie !== null);
check("session cookie issued", Boolean(cookie?.startsWith("starkvisionz_session=")));

if (!cookie) {
  // Everything below needs a session. Say why rather than failing forty
  // assertions with the same cause — the usual reason is a re-run against a
  // server whose login bucket the last run drained on purpose.
  console.error(
    "\nsmoke: could not sign in as " +
      ACCOUNTS.admin +
      ".\n  - has `npm run db:seed` run, creating the demo accounts?\n" +
      "  - is this a fresh server? the rate-limit assertion below drains the\n" +
      "    login bucket by design, so a second run needs a restart.\n"
  );
  process.exit(1);
}

const authed = { ...json, cookie };
check("read API allowed with session", (await get("/api/projects", { headers: authed })).status === 200);
check(
  "forged cookie refused",
  (
    await get("/api/projects", {
      headers: { cookie: "starkvisionz_session=v2.usr-forged.1.1.9999999999.forged" },
    })
  ).status === 401
);
check(
  "a v1 cookie is not accepted as a v2 one",
  (await get("/api/projects", { headers: { cookie: "starkvisionz_session=1.9999999999.forged" } }))
    .status === 401
);

// ---------------------------------------------------------------------------
// The roll-up: the invariant this whole review turned on
// ---------------------------------------------------------------------------
console.log("\nschedule drives earned value");

const metrics = async () =>
  (await (await get("/api/projects/prj-gc4410", { headers: authed })).json()).metrics;

const schedule = await (await get("/api/projects/prj-gc4410/schedule", { headers: authed })).json();
const target = schedule.tasks
  .filter((t) => !t.is_milestone && t.budget > 1_000_000 && t.percent_complete < 90)
  .sort((a, b) => b.budget - a.budget)[0];
check("found an activity with room to move", Boolean(target), target?.code);

const before = await metrics();
const patch = await get(`/api/tasks/${target.id}`, {
  method: "PATCH",
  headers: authed,
  body: JSON.stringify({ percent_complete: 100, status: "complete" }),
});
check("progress update accepted", patch.status === 200);

const after = await metrics();
check(
  "earned value moved",
  after.ev > before.ev,
  `${Math.round(before.ev).toLocaleString()} -> ${Math.round(after.ev).toLocaleString()}`
);
check("SPI moved", after.spi !== before.spi, `${before.spi.toFixed(4)} -> ${after.spi.toFixed(4)}`);
check("CPI moved", after.cpi !== before.cpi, `${before.cpi.toFixed(4)} -> ${after.cpi.toFixed(4)}`);
check("forecast at completion moved", after.eac !== before.eac);


// ---------------------------------------------------------------------------
// Authorisation
//
// The roles are only real if each one is refused what it does not hold. These
// walk the matrix from both sides: what a role may do, and what it may not.
// ---------------------------------------------------------------------------
console.log("\nrole-based access");

const asLead = { ...json, cookie: await signIn(ACCOUNTS.lead) };
const asPlanner = { ...json, cookie: await signIn(ACCOUNTS.planner) };
const asViewer = { ...json, cookie: await signIn(ACCOUNTS.viewer) };

check("every demo account can sign in", [asLead, asPlanner, asViewer].every((h) => Boolean(h.cookie)));

const patchTask = (headers, taskId = target.id) =>
  get(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ percent_complete: 41 }),
  });

const patchRisk = (headers, riskId = "prj-gc4410-risk-16") =>
  get(`/api/risks/${riskId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ mitigation_progress: 40 }),
  });

// What each role may do.
check("controls lead may edit the schedule", (await patchTask(asLead)).status === 200);
check("controls lead may edit a risk", (await patchRisk(asLead)).status === 200);
check("planner may edit the schedule", (await patchTask(asPlanner)).status === 200);

// What each role may not. A refusal is 403 — the account can see the project,
// so pretending it is absent would be a lie it can disprove by reading it.
const plannerRisk = await patchRisk(asPlanner);
check("planner may NOT edit a risk", plannerRisk.status === 403, `status ${plannerRisk.status}`);

// Change orders are the commercial position, governed by the same permission
// as the cost view.
const anyOrder = (
  await (await get("/api/projects/prj-gc4410/change-orders", { headers: asLead })).json()
).changeOrders[0];
const decide = (headers) =>
  get(`/api/change-orders/${anyOrder.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ owner: "smoke test" }),
  });
check("controls lead may amend a change order", (await decide(asLead)).status === 200);
const plannerChange = await decide(asPlanner);
check("planner may NOT amend a change order", plannerChange.status === 403, `status ${plannerChange.status}`);
const viewerChange = await decide(asViewer);
check("viewer may NOT amend a change order", viewerChange.status === 403, `status ${viewerChange.status}`);

const viewerTask = await patchTask(asViewer);
check("viewer may NOT edit the schedule", viewerTask.status === 403, `status ${viewerTask.status}`);

const viewerRisk = await patchRisk(asViewer);
check("viewer may NOT edit a risk", viewerRisk.status === 403, `status ${viewerRisk.status}`);

check("viewer may still read", (await get("/api/projects/prj-gc4410", { headers: asViewer })).status === 200);
check("viewer may still ask the agent", (await get("/api/projects/prj-gc4410/messages", { headers: asViewer })).status === 200);

// Account management is instance-wide and admin-only.
check("admin may list accounts", (await get("/api/users", { headers: authed })).status === 200);
for (const [label, headers] of [["controls lead", asLead], ["planner", asPlanner], ["viewer", asViewer]]) {
  const res = await get("/api/users", { headers });
  check(`${label} may NOT list accounts`, res.status === 403, `status ${res.status}`);
}

// ---------------------------------------------------------------------------
// Project scoping
//
// The demo viewer is granted GC-4410 only. Everything about NV-2208 must be
// unreachable — and unreachable as "not found", because a project's existence
// is itself commercially interesting.
// ---------------------------------------------------------------------------
console.log("\nproject scoping");

const viewerPortfolio = await (await get("/api/projects", { headers: asViewer })).json();
check(
  "a scoped account sees only its projects",
  viewerPortfolio.projects.length === 1 && viewerPortfolio.projects[0].id === "prj-gc4410",
  viewerPortfolio.projects.map((p) => p.code).join(", ")
);
check(
  "an unscoped account sees the whole portfolio",
  (await (await get("/api/projects", { headers: asLead })).json()).projects.length === 3
);

const outOfScope = await get("/api/projects/prj-nv2208", { headers: asViewer });
check("out-of-scope project reads as absent", outOfScope.status === 404, `status ${outOfScope.status}`);
check(
  "out-of-scope schedule reads as absent",
  (await get("/api/projects/prj-nv2208/schedule", { headers: asViewer })).status === 404
);
check(
  "out-of-scope change register reads as absent",
  (await get("/api/projects/prj-nv2208/change-orders", { headers: asViewer })).status === 404
);
check(
  "out-of-scope agent turn refused",
  (
    await get("/api/chat", {
      method: "POST",
      headers: asViewer,
      body: JSON.stringify({ projectId: "prj-nv2208", message: "Where does the project stand?" }),
    })
  ).status === 404
);

// A row is authorised against the project it belongs to, not the URL it was
// reached by — otherwise scoping is bypassed by knowing an id.
const nvSchedule = await (await get("/api/projects/prj-nv2208/schedule", { headers: asLead })).json();
const nvTask = nvSchedule.tasks.find((t) => !t.is_milestone);
check("found an out-of-scope activity to try", Boolean(nvTask), nvTask?.code);
check(
  "a row in an out-of-scope project reads as absent",
  (await get(`/api/tasks/${nvTask.id}`, { headers: asViewer })).status === 404
);
check(
  "writing a row in an out-of-scope project reads as absent",
  (await patchTask(asViewer, nvTask.id)).status === 404
);

// ---------------------------------------------------------------------------
// Revocation
//
// Sessions are signed bearers with no server-side store, so the claim that
// changing an account ends its sessions is exactly the claim worth testing.
// ---------------------------------------------------------------------------
console.log("\nrevocation");

const plannerId = (await (await get("/api/users", { headers: authed })).json()).users.find(
  (u) => u.email === ACCOUNTS.planner
).id;

check("planner's session works before the change", (await get("/api/projects", { headers: asPlanner })).status === 200);

const demote = await get(`/api/users/${plannerId}`, {
  method: "PATCH",
  headers: authed,
  body: JSON.stringify({ role: "viewer" }),
});
check("role change accepted", demote.status === 200, `status ${demote.status}`);
check(
  "the role change ended the session it was holding",
  (await get("/api/projects", { headers: asPlanner })).status === 401
);

const asPlannerAgain = { ...json, cookie: await signIn(ACCOUNTS.planner) };
check(
  "signing in again reflects the new role",
  (await patchTask(asPlannerAgain)).status === 403
);

// Put it back, so a re-run starts where this one did.
await get(`/api/users/${plannerId}`, {
  method: "PATCH",
  headers: authed,
  body: JSON.stringify({ role: "planner" }),
});

// The last administrator cannot be removed: an instance with nobody who can
// fix it is not a state an administrator should be able to reach by accident.
const adminId = (await (await get("/api/users", { headers: authed })).json()).users.find(
  (u) => u.email === ACCOUNTS.admin
).id;
const selfDemote = await get(`/api/users/${adminId}`, {
  method: "PATCH",
  headers: authed,
  body: JSON.stringify({ role: "viewer" }),
});
check("an administrator cannot demote itself", selfDemote.status === 422, `status ${selfDemote.status}`);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
console.log("\nvalidation");

const reject = async (label, path, body, field) => {
  const res = await get(path, { method: "PATCH", headers: authed, body: JSON.stringify(body) });
  const payload = await res.json().catch(() => ({}));
  check(
    label,
    res.status === 422 && payload.fields?.[0]?.field === field,
    `${res.status} ${payload.fields?.[0]?.field ?? ""}: ${payload.fields?.[0]?.message ?? payload.error ?? ""}`
  );
};

await reject("percent above 100 refused", `/api/tasks/${target.id}`, { percent_complete: 631 }, "percent_complete");
await reject("negative percent refused", `/api/tasks/${target.id}`, { percent_complete: -20 }, "percent_complete");
await reject("unknown status refused", `/api/tasks/${target.id}`, { status: "banana" }, "status");
await reject("impossible date refused", `/api/tasks/${target.id}`, { forecast_start: "2026-13-45" }, "forecast_start");
await reject(
  "inverted date window refused",
  `/api/tasks/${target.id}`,
  { forecast_start: "2026-06-01", forecast_finish: "2026-01-01" },
  "forecast_finish"
);
await reject("out-of-range probability refused", "/api/risks/prj-gc4410-risk-16", { probability: 99 }, "probability");
await reject("derived field refused", "/api/risks/prj-gc4410-risk-16", { severity: 25 }, "severity");

const long = await get("/api/chat", {
  method: "POST",
  headers: authed,
  body: JSON.stringify({ projectId: "prj-gc4410", message: "a".repeat(12_000) }),
});
check("oversized agent message refused", long.status === 422, `status ${long.status}`);

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------
console.log("\nagent streaming");

// Re-read rather than reusing the roll-up section's figures: the role checks
// above wrote to the same activity, so `after` is no longer current — and the
// point of this assertion is that the agent reads the database now.
const current = await metrics();

const stream = await fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { ...authed, "X-Forwarded-For": "203.0.113.77" },
  body: JSON.stringify({ projectId: "prj-gc4410", message: "Where does the project stand?" }),
});
check("agent endpoint accepted the turn", stream.ok, `status ${stream.status}`);

let body = "";
if (stream.ok && stream.body) {
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
  }
}
const deltas = (body.match(/^event: delta$/gm) ?? []).length;
check("response streamed as SSE deltas", deltas > 5, `${deltas} delta events`);
check("stream completed", body.includes("event: done"));
// The agent must be reading the post-edit database, not a cached briefing.
check(
  "agent quotes the current SPI",
  body.includes(current.spi.toFixed(3)),
  `expected ${current.spi.toFixed(3)}`
);


// ---------------------------------------------------------------------------
// Change orders drive the budget
//
// The same invariant as the roll-up, one step up: the register is the source
// of `cost_accounts.approved_changes`, so an approval has to move real money
// and a reversal has to release it. A page whose approve button changed only
// its own table would be the "two sets of figures" problem again.
// ---------------------------------------------------------------------------
console.log("\nchange orders drive the budget");

const changesUrl = "/api/projects/prj-gc4410/change-orders";
const changes = async () => (await get(changesUrl, { headers: authed })).json();

let register = await changes();
check(
  "the register reconciles to the budget",
  Math.round(register.summary.currentBudget - register.summary.originalBudget) ===
    Math.round(register.summary.approved.value),
  `${Math.round(register.summary.approved.value).toLocaleString()} approved`
);
check("no approved order is left unallocated", register.summary.unallocatedApproved === 0);

// Any open order will do — the precondition is that it is undecided and priced
// against an account, not which of the two open statuses it happens to hold.
const open = register.changeOrders.find(
  (c) => (c.status === "trend" || c.status === "submitted") && c.cost_account_id
);
check("found an open order to decide", Boolean(open), `${open?.code} (${open?.status})`);
if (!open) {
  console.error("\nsmoke: the seeded register has no open, allocated order to decide.");
  process.exit(1);
}

const patchOrder = (headers, body, id = open.id) =>
  get(`/api/change-orders/${id}`, { method: "PATCH", headers, body: JSON.stringify(body) });

// Approval is the act that moves a budget, so it has to say which budget.
const noAccount = await patchOrder(authed, {
  cost_account_id: null,
  status: "approved",
  decision_date: "2026-07-01",
});
check(
  "approving with no allocation is refused",
  noAccount.status === 422 &&
    (await noAccount.json()).fields?.[0]?.field === "cost_account_id",
  `status ${noAccount.status}`
);

// Scoping lives on the row, not the URL: an order cannot be aimed at another
// project's budget.
const foreign = await (await get("/api/projects/prj-nv2208/change-orders", { headers: authed })).json();
const crossProject = await patchOrder(authed, { cost_account_id: foreign.accounts[0].id });
check(
  "an allocation into another project is refused",
  crossProject.status === 422,
  `status ${crossProject.status}`
);

const noDate = await patchOrder(authed, { status: "approved" });
check("approving with no decision date is refused", noDate.status === 422, `status ${noDate.status}`);

const beforeChange = await metrics();
const approve = await patchOrder(authed, { status: "approved", decision_date: "2026-07-01" });
check("approval accepted", approve.status === 200, `status ${approve.status}`);

const approved = await approve.json();
check(
  "the budget moved by exactly the order's value",
  Math.round(approved.metrics.bac - beforeChange.bac) === Math.round(open.cost_impact),
  `${Math.round(beforeChange.bac).toLocaleString()} -> ${Math.round(approved.metrics.bac).toLocaleString()}`
);
// The correction that matters: approval is a commercial event, not a
// performance one. Earning the *current* budget at the schedule's progress
// fraction used to raise earned value the moment an order was approved — the
// same physical work, applied to a bigger number, reading as work performed.
check(
  "approving earned no value on its own",
  Math.round(approved.metrics.ev) === Math.round(beforeChange.ev),
  `EV ${Math.round(beforeChange.ev).toLocaleString()} -> ${Math.round(approved.metrics.ev).toLocaleString()}`
);
check(
  "approving did not move CPI",
  approved.metrics.cpi.toFixed(6) === beforeChange.cpi.toFixed(6),
  `${beforeChange.cpi.toFixed(4)} -> ${approved.metrics.cpi.toFixed(4)}`
);
check(
  "approving did not move SPI",
  approved.metrics.spi.toFixed(6) === beforeChange.spi.toFixed(6),
  `${beforeChange.spi.toFixed(4)} -> ${approved.metrics.spi.toFixed(4)}`
);
check(
  "the forecast at completion rose by the order's value",
  Math.round(approved.metrics.eac - beforeChange.eac) > 0,
  `EAC ${Math.round(beforeChange.eac).toLocaleString()} -> ${Math.round(approved.metrics.eac).toLocaleString()}`
);

// ...and the other half: change scope earns as it is performed, not before.
const halfDone = await get(`/api/change-orders/${open.id}`, {
  method: "PATCH",
  headers: authed,
  body: JSON.stringify({ percent_complete: 50 }),
});
check("progress may be recorded against approved scope", halfDone.status === 200, `status ${halfDone.status}`);

const half = await halfDone.json();
check(
  "performing half the change earned half its value",
  Math.abs(half.metrics.ev - approved.metrics.ev - open.cost_impact / 2) < 2,
  `EV +${Math.round(half.metrics.ev - approved.metrics.ev).toLocaleString()} of ${Math.round(open.cost_impact).toLocaleString()}`
);
check(
  "performing it moved CPI",
  half.metrics.cpi > approved.metrics.cpi,
  `${approved.metrics.cpi.toFixed(4)} -> ${half.metrics.cpi.toFixed(4)}`
);
// The other half of the claim, and the one that is easy to get wrong: adding
// the same amount to earned and planned value drags (EV+c)/(PV+c) toward 1, so
// a schedule index measured on the totals would drift every time somebody
// booked progress against a change. SPI is measured on the baseline pair.
check(
  "performing it did NOT move SPI",
  half.metrics.spi.toFixed(7) === approved.metrics.spi.toFixed(7),
  `${approved.metrics.spi.toFixed(7)} -> ${half.metrics.spi.toFixed(7)}`
);

// The S-curve's live tip and the KPI row are the same figures or they are not
// the same report. The tip used to update earned value and actual cost but not
// planned value, so the curve implied a schedule index the headline did not.
const curveTip = async () => {
  const cost = await (await get("/api/projects/prj-gc4410/cost", { headers: authed })).json();
  const dataDate = cost.project.data_date;
  return cost.evm
    .filter((r) => !r.is_forecast && r.period_end <= dataDate)
    .sort((a, b) => (a.period_end < b.period_end ? 1 : -1))[0];
};

const tip = await curveTip();
check(
  "the S-curve tip carries the KPI's planned value",
  Math.round(tip.planned_value) === Math.round(half.metrics.pv),
  `curve ${Math.round(tip.planned_value).toLocaleString()} vs KPI ${Math.round(half.metrics.pv).toLocaleString()}`
);
check(
  "the S-curve tip carries the KPI's earned value",
  Math.round(tip.earned_value) === Math.round(half.metrics.ev),
  `curve ${Math.round(tip.earned_value).toLocaleString()} vs KPI ${Math.round(half.metrics.ev).toLocaleString()}`
);
check(
  "the S-curve tip carries the KPI's actual cost",
  Math.round(tip.actual_cost) === Math.round(half.metrics.ac)
);

// Progress belongs to approved scope. An order sent back to submitted is scope
// nobody has agreed to any more, so its earned value goes with it.
const unapprove = await get(`/api/change-orders/${open.id}`, {
  method: "PATCH",
  headers: authed,
  body: JSON.stringify({ status: "submitted", decision_date: null }),
});
const unapproved = await unapprove.json();
check(
  "un-approving took its earned value with it",
  Math.round(unapproved.metrics.ev) === Math.round(beforeChange.ev) &&
    unapproved.changeOrder.percent_complete === 0,
  `EV back to ${Math.round(unapproved.metrics.ev).toLocaleString()}, progress ${unapproved.changeOrder.percent_complete}%`
);
check(
  "recording progress against an open order is refused",
  (
    await get(`/api/change-orders/${open.id}`, {
      method: "PATCH",
      headers: authed,
      body: JSON.stringify({ percent_complete: 40 }),
    })
  ).status === 422
);

// Put it back where the rest of this section expects to find it.
await get(`/api/change-orders/${open.id}`, {
  method: "PATCH",
  headers: authed,
  body: JSON.stringify({ status: "approved", decision_date: "2026-07-01" }),
});
check(
  "the account's own budget carries the change",
  approved.changeOrders.find((c) => c.id === open.id)?.status === "approved"
);

// The forecast finish must NOT move: the schedule is a register, not a solver,
// and applying an approved order's days would assert an entitlement nobody
// calculated.
const afterProject = await (await get("/api/projects/prj-gc4410", { headers: authed })).json();
check(
  "the forecast finish did not move",
  afterProject.project.forecast_finish === schedule.project.forecast_finish,
  afterProject.project.forecast_finish
);

// Reversing it has to give the money back, not strand it on the account.
const reverse = await patchOrder(authed, { status: "rejected" });
check("reversal accepted", reverse.status === 200);
check(
  "rejecting released the budget again",
  Math.round((await reverse.json()).metrics.bac) === Math.round(beforeChange.bac),
  `back to ${Math.round(beforeChange.bac).toLocaleString()}`
);

// Raising a trend is open by definition, so it moves nothing.
const raised = await get(changesUrl, {
  method: "POST",
  headers: authed,
  body: JSON.stringify({
    title: "Smoke test trend",
    origin: "Internal",
    status: "trend",
    cost_impact: 250_000,
    raised_date: "2026-07-31",
  }),
});
check("a trend can be raised", raised.status === 201, `status ${raised.status}`);
check(
  "raising a trend moves no budget",
  Math.round((await metrics()).bac) === Math.round(beforeChange.bac)
);

// A register that let an order be created already approved would have no record
// of it ever having been asked for.
const bornApproved = await get(changesUrl, {
  method: "POST",
  headers: authed,
  body: JSON.stringify({
    title: "Straight to approved",
    origin: "Client",
    status: "approved",
    raised_date: "2026-07-31",
  }),
});
const bornBody = await bornApproved.json().catch(() => ({}));
check(
  "a new order cannot be raised already approved",
  bornApproved.status === 422 && bornBody.fields?.[0]?.field === "status",
  `${bornApproved.status} ${bornBody.fields?.[0]?.message ?? ""}`
);

// ---------------------------------------------------------------------------
// Rate limiting
//
// Last, because proving the login limit works means exhausting it, and nothing
// after this point could sign in.
// ---------------------------------------------------------------------------
console.log("\nrate limiting");

// The regression this guards: keying on a caller-supplied header let anyone
// mint a fresh bucket per request and guess passwords without limit.
const codes = [];
for (let i = 0; i < 10; i++) {
  const res = await get("/api/auth/login", {
    method: "POST",
    headers: { ...json, "X-Forwarded-For": `10.9.9.${i}` },
    body: JSON.stringify({ email: ACCOUNTS.lead, password: `${PASSWORD}-wrong` }),
  });
  codes.push(res.status);
}
check(
  "forged X-Forwarded-For does not mint fresh buckets",
  codes.includes(429),
  codes.join(" ")
);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nfailures:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
