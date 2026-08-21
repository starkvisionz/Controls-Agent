# Hermes — Project Controls Agent

A desktop-style cockpit for EPC project controls, with an agent that reads the
project registers directly and answers from them.

Hermes is built for the way a controls lead actually works: one window, a
persistent left rail, a resizable workspace, and an agent panel that stays open
beside whatever you are looking at. Every figure on screen is derived from the
same tables the agent reads, so the dashboard and the agent never disagree.

![The Hermes dashboard](docs/dashboard.png)

## What's in it

| View | What it does |
|---|---|
| **Dashboard** | Earned-value KPIs, the S-curve (PV / EV / AC with forecast), SPI and CPI trend, cost by phase, milestones, critical path, and an alert roll-up |
| **Schedule** | WBS tree with a Gantt timeline — baseline against forecast, critical-path marking, milestone diamonds, zoom, filters, and an editable activity inspector |
| **Cost** | Control accounts with budget / committed / actual / earned / CPI / EAC / VAC, a diverging variance chart, period cash flow, the transaction ledger, and the change-order log |
| **Risk** | 5×5 probability-impact matrix with click-through drilldown, exposure by category, and an editable risk inspector with mitigation tracking |
| **Documents** | Deliverable register with issue status, client review codes, overdue tracking, and approval progress by discipline |
| **Agent** | A streaming chat panel that answers from the live database — cost variance, critical path, risk exposure, forecast basis, and recommendations |

## Running it

```bash
npm install
npm run db:seed     # builds data/hermes.db and fills it with a demo portfolio
npm run dev         # http://localhost:3000
```

The database is a local SQLite file; there is no external service to configure.

### Before you expose it

Hermes holds a project's cost, schedule and commercial position, so it runs
behind a session gate. Generate a credential and put both values in
`.env.local`:

```bash
npm run auth:hash -- 'your password'
# -> HERMES_AUTH_PASSWORD=scrypt$...
#    HERMES_SESSION_SECRET=...
```

With those set, every page and every API route requires a session. Without
them, Hermes runs unauthenticated **only** in development; in production it
returns 503 rather than serving the registers to anyone who can reach the host.
`HERMES_AUTH_PASSWORD` also accepts a plain string if you want to get moving
before hardening.

This is single-operator access. Multiple users with per-project roles would be
a larger change and is not attempted here.

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
| **NV-2208** Silver Basin Solar + Storage | $268M EPCM | Construction | 1.017 | 1.011 | Ahead of plan on both |
| **AB-1750** Scotford Blue Hydrogen | $158M Cost-Plus | Engineering | 0.972 | 0.938 | Early, with cost pressure already |

The generator is deterministic — a fixed PRNG seed per project code — so the
numbers are the same on every re-seed. Because earned value is derived from
activity progress rather than written directly, the seeder hits each project's
target SPI by scaling the *activity percentages* and iterating the same roll-up
the API runs, then shapes actual cost around the resulting earned value to hit
the target CPI. Per-account variance is real; the headline matches the story;
and the seeded database satisfies the same invariant a live edit does.

`npm run db:reset` rebuilds from scratch.

## How it fits together

```
src/
  app/
    (app)/                everything behind the session gate: dashboard,
                          schedule/, cost/, risk/, documents/
    login/                the one page a signed-out visitor can render
    api/                  REST routes + the streaming /api/chat endpoint
    globals.css           the Hermes design tokens
  middleware.ts           session gate in front of every page and route
  components/
    shell/                title bar, sidebar, status bar, resizable frame
    charts/               Recharts wrappers over one shared chart theme
    chat/                 agent panel, SSE client, markdown renderer
    dashboard/ schedule/ cost/ risk/ documents/
    ui/                   panels, tables, badges, stat tiles, controls
  lib/
    schema.sql            the full EPC schema
    db.ts queries.ts      connection and the typed query + metrics layer
    rollup-core.mjs       schedule -> cost roll-up, shared with the seeder
    validation.ts         Zod schemas shared by the UI and the API
    auth.ts rate-limit.ts session credential and token buckets
    agent-context.ts      builds the agent's briefing from the database
    agent-local.ts        the offline analyst
scripts/seed.mjs          the demo-portfolio generator
```

### A few decisions worth knowing

**Progress and money are one chain, not two.** `src/lib/rollup-core.mjs` owns
the only path from schedule to cost:

```
activity % complete
  -> budget-weighted progress of the WBS node
  -> control-account earned value
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
EAC, ETC, VAC and TCPI on top of that roll-up.

**The agent gets a briefing, not a database handle.** Every chat turn rebuilds a
plain-text snapshot of the project from the current tables and hands that to the
model as its only source of fact. Answers stay current without the agent needing
query access.

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
Hermes believes the header only when `HERMES_TRUSTED_PROXIES` says how many
proxies sit in front, and then reads only the entry the innermost trusted proxy
observed. With none declared, every caller shares one bucket: legitimate users
throttle together, which is the safe direction to be wrong in. A second
instance-wide ceiling bounds the total regardless of where traffic comes from.

Chat messages are capped and oversized bodies refused before buffering.

**The schedule is a register, not a solver.** Hermes stores predecessors, float
and critical-path flags but does not run CPM. Editing a forecast date does not
move successors or recompute float, and the activity inspector says so rather
than letting a planner assume otherwise. A real scheduling layer — or ingesting
calculated dates from P6/MSP — is the next step for that view.

## CI

`.github/workflows/ci.yml` runs on every pull request: typecheck, lint, build,
seed, then `scripts/smoke.mjs` against the built server.

The smoke test asserts the things this README claims rather than leaving them
as assertions in prose — that a schedule edit moves project EVM, that no page,
read or write is reachable without a session, that a forged cookie is refused,
that out-of-range and unknown fields are rejected, that a forged
`X-Forwarded-For` cannot defeat the rate limit, and that the agent still
streams SSE and quotes the current figures. It runs with no `ANTHROPIC_API_KEY`,
so it exercises the local analyst and never depends on a provider.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server on :3000 |
| `npm run build` / `npm start` | Production build and serve |
| `npm run db:seed` | Build and populate the database |
| `npm run db:reset` | Delete and rebuild it |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint over the whole tree |
| `npm run smoke` | Assert the auth gate, validation, roll-up and streaming against a running build |
| `npm run auth:hash -- 'pw'` | Generate `HERMES_AUTH_PASSWORD` and `HERMES_SESSION_SECRET` |

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · SQLite via
better-sqlite3 · Zod · Recharts · react-resizable-panels · lucide-react ·
`@anthropic-ai/sdk` for the streaming agent. Session auth uses `node:crypto`
only — no auth dependency.
