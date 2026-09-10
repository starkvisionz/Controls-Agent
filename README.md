# Project Starkvisionz

A desktop-style cockpit for EPC project controls, with an agent that reads the
project registers directly and answers from them.

Starkvisionz is built for the way a controls lead actually works: one window, a
persistent left rail, a resizable workspace, and an agent panel that stays open
beside whatever you are looking at. Every figure on screen is derived from the
same tables the agent reads, so the dashboard and the agent never disagree.

![The Project Starkvisionz dashboard](docs/dashboard.png)

## What's in it

| View | What it does |
|---|---|
| **Dashboard** | Earned-value KPIs, the S-curve (PV / EV / AC with forecast), SPI and CPI trend, cost by phase, milestones, critical path, and an alert roll-up |
| **Schedule** | WBS tree with a Gantt timeline — baseline against forecast, critical-path marking, milestone diamonds, zoom, filters, and an editable activity inspector |
| **Cost** | Control accounts with budget / committed / actual / earned / CPI / EAC / VAC, a diverging variance chart, period cash flow and the transaction ledger |
| **Risk** | 5×5 probability-impact matrix with click-through drilldown, exposure by category, and an editable risk inspector with mitigation tracking |
| **Changes** | The change-order register — trends, submissions, approvals — with the budget movement each one causes, approval turnaround, and where the change is coming from |
| **Documents** | Deliverable register with issue status, client review codes, overdue tracking, and approval progress by discipline |
| **Activity** | Who changed what and when — the project's register history, and account changes for administrators |
| **Agent** | A streaming chat panel that answers from the live database — cost variance, critical path, risk exposure, forecast basis, and recommendations |

![The Changes view — the register, and the budget it moves](docs/changes.png)

### Importing

Every register takes a file. The **Import** button sits in the toolbar of the
Schedule, Risk, Changes and Documents views, and appears only for an account
that may write to that register.

| Format | Where it comes from |
|---|---|
| CSV / TSV | Anything. Quoted fields, embedded commas and a UTF-8 BOM are handled; the separator is detected. |
| Excel `.xlsx` / `.xlsm` | The first sheet is read, and the workbook's other sheets are named so you know what was ignored. Percentage-formatted cells arrive as percentages, not as `0.6`. |
| Primavera P6 `.xer` | Activity progress, actual and forecast dates, and total float. Matched on Activity ID, not P6's internal `task_id`, which changes between databases. |

P6 stores durations in hours, so float is converted at eight hours to the day
and the preview says so — a project on a different calendar will read low. MS
Project XML is recognised and refused with instructions rather than parsed as a
CSV with one enormous column.

Import **updates** records; it does not create them. A row for something the
project has never heard of is reported as not found rather than invented,
because far more often it is the wrong file than a new record.

Uploading shows a preview: which column was matched to which field, what was
ignored, and — row by row — what would change, what is already right, what is
not on this project and what was rejected. Nothing is written until the button
under that preview is pressed. Column headings are matched loosely, so
`Percent complete`, `Pct Complete`, `Progress` and `Phys Complete` all find the
same field, and `84%`, `1,250` and `(400)` are read as the numbers a
spreadsheet means by them.

Applied rows go in one transaction — a part-applied file is the worst outcome
available — and each one is recorded in the activity log, named after the file
it came from, exactly as a typed edit would be.

## Running it

```bash
npm install
npm run db:seed     # builds data/starkvisionz.db and fills it with a demo portfolio
npm run dev         # http://localhost:3000
```

The database is a local SQLite file; there is no external service to configure.

### On a server

One command on a fresh Debian or Ubuntu VPS, and about ten minutes:

```bash
sudo git clone https://github.com/starkvisionz/Controls-Agent.git /opt/starkvisionz
sudo /opt/starkvisionz/deploy/install.sh --domain controls.example.com \
  --email you@example.com --admin-email you@example.com
```

Node and nginx, a system account that can write nothing but its database, the
build, a generated session secret, a systemd unit, a Let's Encrypt certificate
and a nightly backup. Idempotent — run it again after `git pull` and it rebuilds
and restarts without touching the database, the secret or the certificate.

If inbound 80/443 cannot reach the box — an intercepting host, a NAT you do
not control — add `--tunnel` and it serves through a Cloudflare Tunnel instead:
nginx on loopback, no port opened, Cloudflare terminating TLS for the hostname.
[docs/DEPLOY.md](docs/DEPLOY.md) has the three browser-authorised commands that
finishes with.

No demo data. `--admin-email` makes the one account you need and prints a
generated password once; the app is gated behind replacing it at first sign-in,
so the string that scrolled past your terminal stops being the credential as
soon as you use it. Leave the flag off and the instance installs with **no way
in** — no accounts, no sign-up page — and you create the administrator by hand.
[docs/DEPLOY.md](docs/DEPLOY.md) has the runbook — updates, backups and
restores, the DNS and port-80 checks, and what each failure in the log actually
means.

### Before you expose it

Starkvisionz holds a project's cost, schedule and commercial position, so it runs
behind a session gate. Set a signing key and create the first account:

```bash
npm run user -- secret          # -> STARKVISIONZ_SESSION_SECRET=...   (into .env.local)
npm run user -- add --email you@example.com --name 'Your Name' --role admin
```

With a secret set, every page and every API route requires a session. Without
one, Starkvisionz runs unauthenticated **only** in development, as a local
administrator; in production it returns 503 rather than serving the registers to
anyone who can reach the host.

There is no sign-up page. The first account is created on the host by somebody
who already has it, and every account after that by an administrator.

### Who can do what

Accounts are local — stored in the same SQLite file, passwords hashed with
scrypt — and carry one of four roles:

| Role | Read | Schedule | Documents | Cost & changes | Risk | Accounts |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| **Viewer** | ● | | | | | |
| **Planner** | ● | ● | ● | | | |
| **Controls lead** | ● | ● | ● | ● | ● | |
| **Administrator** | ● | ● | ● | ● | ● | ● |

Change orders sit under cost: approving one moves a control-account budget, so
it is the same permission that governs the cost position.

Reading includes the agent panel: it answers from the whole project, so asking
it something needs the same access as opening the register.

![The Accounts view](docs/accounts.png)

An account can also be **scoped to particular projects**, optionally at a
different role on each — a planner on one train and a reader on the next is the
normal case on a portfolio. An account with no scoping sees everything at its
own role, including projects added later. Out of scope reads as *not found*
rather than *forbidden*: which projects exist is itself commercially
interesting.

```bash
npm run user -- list
npm run user -- scope --email planner@example.com --projects GC-4410,NV-2208:viewer
npm run user -- role  --email planner@example.com --role controls_lead
npm run user -- disable --email someone@example.com
```

Administrators can do all of that in the **Accounts** view as well. Accounts are
disabled rather than deleted, so who made a change stays legible. Changing a
role, a password or a project scope ends that account's live sessions on the
next request.

### The agent

The agent panel works with no configuration. Without an API key it runs a local
analyst that composes its answers from the same tables — grounded, deterministic,
and never inventing a figure.

To route it through Claude instead, copy `.env.example` to `.env.local` and set:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

The status bar at the bottom right shows which one answered. Either way the
request builds a fresh briefing from the database on every turn, so the agent
cannot cite a number the tables do not support.

## The demo portfolio

`npm run db:seed` builds three EPC projects, each telling a different story:

| Project | Contract | Phase | SPI | CPI | Reads as |
|---|---|---|---|---|---|
| **GC-4410** Gulf Coast LNG — Train 4 | $486M LSTK | Construction | 0.941 | 0.968 | Behind schedule, modestly over cost |
| **NV-2208** Silver Basin Solar + Storage | $268M EPCM | Construction | 1.028 | 1.011 | Ahead of plan on both |
| **AB-1750** Scotford Blue Hydrogen | $158M Cost-Plus | Engineering | 0.972 | 0.938 | Early, with cost pressure already |

The generator is deterministic — a fixed PRNG seed per project code — so the
numbers are the same on every re-seed. Change orders are seeded the same way the
app writes them: the approved ones sum to exactly what each control account's
budget was drafted to hold, and the budgets are then derived from that register,
so every dollar of approved change traces to an order from the first row. Because earned value is derived from
activity progress rather than written directly, the seeder hits each project's
target SPI by scaling the *activity percentages* and iterating the same roll-up
the API runs, then shapes actual cost around the resulting earned value to hit
the target CPI. Per-account variance is real; the headline matches the story;
and the seeded database satisfies the same invariant a live edit does.

It also creates four demo accounts, one per role — the password is printed by
the seeder — so the access model can be tried rather than read about. The
read-only one is scoped to a single project, which is what makes the portfolio
filter visible. They are skipped under `NODE_ENV=production` unless you pass
`--demo-users` on purpose, and the seeder never touches an account it did not
create.

`npm run db:reset` rebuilds from scratch.

## How it fits together

```
src/
  app/
    (app)/                everything behind the session gate: dashboard,
                          schedule/, cost/, risk/, documents/
    login/                the one page a signed-out visitor can render
    api/                  REST routes + the streaming /api/chat endpoint
    globals.css           the Starkvisionz design tokens
  middleware.ts           session gate in front of every page and route
  components/
    shell/                title bar, sidebar, status bar, resizable frame
    charts/               Recharts wrappers over one shared chart theme
    chat/                 agent panel, SSE client, markdown renderer
    dashboard/ schedule/ cost/ risk/ changes/ documents/ users/
    ui/                   panels, tables, badges, stat tiles, controls
  lib/
    schema.sql            the full EPC schema
    db.ts queries.ts      connection and the typed query + metrics layer
    rollup-core.mjs       schedule -> cost roll-up, shared with the seeder
    change-orders-core.mjs  change register -> control-account budgets
    validation.ts         Zod schemas shared by the UI and the API
    audit.ts              who changed what, written with the change itself
    rbac.ts               roles, permissions, and the one `can()` they answer
    auth.ts guard.ts      sessions, and the check every route runs
    users.ts              the account store, over accounts-core.mjs
    accounts-core.mjs     password hashing and account writes, shared with the CLI
    rate-limit.ts         token buckets, keyed on the account where there is one
    agent-context.ts      builds the agent's briefing from the database
    agent-local.ts        the offline analyst
scripts/seed.mjs          the demo-portfolio generator
scripts/user.mjs          account administration, and the bootstrap path
```

### A few decisions worth knowing

**Progress and money are one chain, not two.** `src/lib/rollup-core.mjs` owns
the only path from schedule to cost:

```
activity % complete
  -> budget-weighted progress of the WBS node
  -> control-account earned value  (progress x ORIGINAL budget,
     plus progress recorded on approved change scope)
  -> forecast at completion
  -> the EVM period at the data date
  -> projectMetrics(), and so every view and the agent briefing
```

Marking an activity complete moves SPI, CPI, EAC and the S-curve in the same
transaction. Nothing else writes `cost_accounts.earned_value` — the seeder calls
that same file, so the invariant holds from the first row inserted rather than
only after the first edit. Actual cost is deliberately outside the chain: it
comes from the ledger, not from progress.

`projectMetrics()` in `src/lib/queries.ts` is the single definition of SPI, CPI,
EAC, ETC, VAC and TCPI on top of that roll-up. The tip of the S-curve carries
the same planned, earned and actual figures it reports — all three, not two of
them, or the curve implies a performance index the headline does not.

**The change register is where budgets come from.**
`src/lib/change-orders-core.mjs` owns the step above that roll-up:

```
change order approved (allocated to a control account)
  -> cost_accounts.approved_changes  (SUM of approved orders on that account)
  -> cost_accounts.current_budget    (original + approved)
  -> recalculateProject()            -> earned value, EAC, the EVM period
```

Nothing else writes `approved_changes` or `current_budget`. It re-derives from
scratch rather than applying deltas, so an order that is rejected after approval
— or moved to a different account — releases the money it was holding instead of
stranding it. Approving therefore requires an allocation: you cannot add to a
budget without saying which budget, and the account named must belong to the
same project.

**Approved scope is budgeted at once and earned as it is performed.** Baseline
scope earns against the *original* budget at the schedule's progress fraction;
approved change scope earns against its own recorded progress, which starts at
zero. Earning the *current* budget at the schedule's fraction — the obvious
implementation, and the one this had first — makes approving an order raise
earned value on the spot: the same physical progress, applied to a bigger
number, reading as work that nobody performed.

So approving moves BAC and the forecast at completion and leaves SPI, CPI and
EV exactly where they were. It is a commercial event, not a performance one.
Recording progress against the order is what earns it, and un-approving takes
that earned value back out.

**Cost and schedule are measured on different scopes, on purpose.** Cost — CPI,
CV, EAC, VAC, TCPI — uses the totals: every dollar spent is in actual cost,
including dollars spent on change scope, so every dollar earned has to be there
to match it. Schedule — SPI and SV — uses the baseline pair.

That split is not decoration. Change scope enters planned value on the same
profile it is earned on, which keeps it out of cost variance until it is
performed; but adding the same amount to both sides drags `(EV+c)/(PV+c)`
toward 1.0, so a schedule index measured on the totals would creep upward every
time somebody booked progress against a change. A project reading 0.94 would
appear to recover by performing work nobody had planned. Approved change scope
has no schedule to be measured against until its activities are baselined, so
it is not in the schedule index at all; the Changes view reports it separately,
which is where scope outside the baseline belongs.

`cost_accounts` therefore carries `baseline_planned_value` and
`baseline_earned_value` alongside the totals — the same split
`original_budget` / `current_budget` already has on the budget side.

Pending change is kept out of the budget on purpose. A trend is exposure the
project carries, not money it has, and the two never share a tile or a total —
that is how a forecast quietly absorbs a claim nobody has agreed to pay.

Schedule impact is recorded and **not** applied to forecast dates, for the same
reason the schedule is a register rather than a solver: moving a finish date on
approval would assert an entitlement no critical path produced.

**Authorisation is asked once, about a project.** `src/lib/rbac.ts` holds the
role-to-permission table and a single `can(principal, permission, projectId)`.
The API routes call it through `src/lib/guard.ts`; the UI calls it directly to
decide what to offer. One table, both consumers — the alternative is an
interface that hides a button the API would have accepted, or offers one it
refuses.

Nearly every check passes a project id. Without one the question becomes "could
this account ever do this", which is the wrong question the moment somebody is
scoped to part of the portfolio — and it is how a scoped user gets shown an
edit button that 404s. A row is authorised against the project it belongs to
rather than the URL it arrived on, so knowing an id is not a way around scoping.

**Sessions carry the account, and revocation is a column.** The cookie is a
signed bearer holding the account id and that account's `session_version`. There
is no server-side session table to lose on a restart; ending a session is a
version bump, which is what makes a password change, a role change or a
deactivation take effect on the next request rather than in twelve hours. The
edge middleware checks the signature and expiry, because that is all it can
reach; the Node routes re-resolve the account against the database, which is
where a since-revoked session is actually caught.

**The audit row is written by the transaction that made the change.** An audit
log that can disagree with the data is worse than none, because people believe
it — so `recordAudit` takes the handle the caller is already writing through
rather than opening its own. A write that rolls back takes its audit row with
it, and a write that succeeds is always recorded.

The log stores the diff rather than a snapshot: which fields moved, and what
they moved from and to. A field submitted with the value it already held is not
a change and is not recorded, or every save would look like an edit to
everything. Password digests never reach it — that the credential changed is
carried by the action instead.

The actor's name and email are copied into the row rather than joined at read
time. An account can be renamed or have its role changed, and the log has to
say who made the change under the identity they held when they made it.

Reading is scoped the way the data is. A project's history is as sensitive as
the project, so it needs the same read permission; a record's history is
authorised against the project that record belongs to rather than against the
caller's claim about it. Account changes are administrator-only — a planner
should see who moved an activity, not who changed somebody's role.

**The agent gets a briefing, not a database handle.** Every chat turn rebuilds a
plain-text snapshot of the project from the current tables and hands that to the
model as its only source of fact. Answers stay current without the agent needing
query access.

**The portfolio ships with the page, not after it.** The layout has already
authenticated the request and knows which projects the account may see, so
fetching that list again from the browser bought nothing and cost a *blocking*
round trip: no view could ask for its own data until the active project was
known, so every page load ran two requests in series behind a loading pane. The
list now travels with the first HTML. Measured against the previous build, time
to content: dashboard 997 ms → ~600, schedule 631 → ~375, cost 643 → ~360,
changes 495 → ~380.

If the app feels slow, check which server is running. `npm run dev` compiles
each route on demand and ships unminified bundles — 4–6 seconds and ~2 MB of
JavaScript per first visit, against 0.4–0.6 seconds and ~10 kB from `npm start`.
That gap is dev mode working as intended, not the app.

**Charts never carry two scales.** Where two measures differ by an order of
magnitude — period spend against cumulative cost — they get two charts rather
than a second axis. The categorical palette is checked for colourblind
separation and contrast against the dark surface; the values live in
`globals.css` under `--color-series-*`.

**The API validates values, not just field names.** `src/lib/validation.ts`
holds Zod schemas shared by the UI and the routes: percent complete is 0–100,
statuses are enums, dates must be real calendar days, a forecast finish cannot
precede its start, risk scores are 1–5. A column allowlist stops a caller naming
an arbitrary column; these stop them putting `631` into an allowed one. Derived
fields — earned value, severity, expected value — are recomputed server-side and
rejected if supplied.

**Writes are rate limited, and the limit is not caller-controlled.** Token
buckets cover the agent endpoint (the only path that can spend money at a
provider), the write routes, and login.

The identity those buckets key on matters more than the numbers. `X-Forwarded-For`
is a list the client can prepend to, so keying on its leftmost value lets anyone
mint a fresh bucket per request — that defeats a limit rather than weakening it.
Starkvisionz believes the header only when `STARKVISIONZ_TRUSTED_PROXIES` says how many
proxies sit in front, and then reads only the entry the innermost trusted proxy
observed. With none declared, every caller shares one bucket: legitimate users
throttle together, which is the safe direction to be wrong in. A second
instance-wide ceiling bounds the total regardless of where traffic comes from.

Chat messages are capped and oversized bodies refused before buffering.

**An import is previewed and applied from the same file, twice.** The browser
posts the file once for a preview and again to commit, and the server re-derives
the plan from scratch on the second pass rather than accepting the plan it
handed out. That costs one extra parse and buys the guarantee that what was
approved and what is applied are the same computation, rather than two that are
hoped to agree — and a client cannot hand back an edited plan, because there is
nowhere to hand one back to.

Imported values go through the register's own Zod schema, so a percentage over
100 is refused from a workbook exactly as it is from the inspector, and
importing into a register needs that register's write permission — a planner may
refresh the schedule from P6 and still not touch the risk register. A file
listing the same record twice is rejected at the second occurrence rather than
silently applying whichever line came last.

**The schedule is a register, not a solver.** Starkvisionz stores predecessors, float
and critical-path flags but does not run CPM. Editing a forecast date does not
move successors or recompute float, and the activity inspector says so rather
than letting a planner assume otherwise. Importing a P6 export brings in the
dates and float P6 calculated, which is the usual way this gap is closed on a
real job; a scheduling engine of its own is still a separate piece of work.

## CI

`.github/workflows/ci.yml` runs on every pull request: typecheck, lint, build,
seed, then `scripts/smoke.mjs` against the built server.

The smoke test asserts the things this README claims rather than leaving them
as assertions in prose — that a schedule edit moves project EVM, that approving a
change order moves the budget it names and rejecting it gives that money back,
that no page,
read or write is reachable without a session, that a forged cookie is refused,
that each role is allowed exactly what its permissions say and refused the
rest, that a scoped account cannot see or reach a project it was not granted,
that changing an account ends the sessions it already had, that out-of-range and
unknown fields are rejected, that an import preview writes nothing and a commit
applies exactly the rows the preview approved, that a forged `X-Forwarded-For` cannot defeat the
rate limit, and that the agent still streams SSE and quotes the current
figures. It runs with no `ANTHROPIC_API_KEY`,
so it exercises the local analyst and never depends on a provider.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server on :3000 |
| `npm run build` / `npm start` | Production build and serve |
| `npm run serve` | Serve on `$HOST`/`$PORT` — loopback by default, what the systemd unit runs |
| `npm run db:init` | Create an empty database — schema only, for a real deployment |
| `npm run db:seed` | Build and populate the database with the demo portfolio |
| `npm run db:reset` | Delete and rebuild it |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint over the whole tree |
| `npm run smoke` | Assert the auth gate, roles, roll-up, change-order chain, import, validation and streaming against a running build |
| `npm run user -- list` | Accounts, roles and project scope |
| `npm run user -- add` | Create an account — the bootstrap path for the first one |
| `npm run user -- secret` | Generate a `STARKVISIONZ_SESSION_SECRET` |

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · SQLite via
better-sqlite3 · Zod · Recharts · react-resizable-panels · lucide-react ·
`@anthropic-ai/sdk` for the streaming agent. Sessions, password hashing and
role-based access use `node:crypto` and the app's own tables — no auth
dependency, and no identity provider to configure.
