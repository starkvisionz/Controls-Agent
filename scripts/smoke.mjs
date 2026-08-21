/**
 * Smoke test against a running production build.
 *
 * The PR review's point was that the claims in the description were not
 * enforced anywhere. These are those claims, written as assertions, so CI fails
 * if the behaviour regresses rather than relying on anyone's word:
 *
 *   - the roll-up: a schedule edit must move project EVM
 *   - the auth gate: no page, read or write without a session
 *   - validation: out-of-range and unknown fields refused
 *   - rate limiting: not defeatable with a forged X-Forwarded-For
 *   - streaming: the agent endpoint still streams SSE
 *
 * Usage: node scripts/smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = process.env.HERMES_AUTH_PASSWORD;

if (!PASSWORD || PASSWORD.startsWith("scrypt$")) {
  console.error("smoke: set HERMES_AUTH_PASSWORD to the plaintext password for this run");
  process.exit(1);
}

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
  body: JSON.stringify({ password: `${PASSWORD}-wrong` }),
});
check("wrong password refused", wrong.status === 401);

const login = await get("/api/auth/login", {
  method: "POST",
  headers: json,
  body: JSON.stringify({ password: PASSWORD }),
});
check("correct password accepted", login.status === 200);

const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
check("session cookie issued", cookie.startsWith("hermes_session="), cookie.split("=")[0]);

const authed = { ...json, cookie };
check("read API allowed with session", (await get("/api/projects", { headers: authed })).status === 200);
check(
  "forged cookie refused",
  (await get("/api/projects", { headers: { cookie: "hermes_session=1.9999999999.forged" } })).status === 401
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
// Rate limiting
// ---------------------------------------------------------------------------
console.log("\nrate limiting");

// The regression this guards: keying on a caller-supplied header let anyone
// mint a fresh bucket per request and guess passwords without limit.
const codes = [];
for (let i = 0; i < 10; i++) {
  const res = await get("/api/auth/login", {
    method: "POST",
    headers: { ...json, "X-Forwarded-For": `10.9.9.${i}` },
    body: JSON.stringify({ password: `${PASSWORD}-wrong` }),
  });
  codes.push(res.status);
}
check(
  "forged X-Forwarded-For does not mint fresh buckets",
  codes.includes(429),
  codes.join(" ")
);

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------
console.log("\nagent streaming");

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
  body.includes(after.spi.toFixed(3)),
  `expected ${after.spi.toFixed(3)}`
);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nfailures:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
