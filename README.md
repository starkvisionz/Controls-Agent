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

That's the whole setup. The database is a local SQLite file; there is no
external service to configure.

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
numbers are the same on every re-seed. Earned value is normalised after
generation so each project's rolled-up SPI and CPI land exactly on its target;
per-account variance is real, but the headline matches the story.

`npm run db:reset` rebuilds from scratch.

## How it fits together

```
src/
  app/
    api/                  REST routes + the streaming /api/chat endpoint
    page.tsx              dashboard; schedule/, cost/, risk/, documents/
    globals.css           the Hermes design tokens
  components/
    shell/                title bar, sidebar, status bar, resizable frame
    charts/               Recharts wrappers over one shared chart theme
    chat/                 agent panel, SSE client, markdown renderer
    dashboard/ schedule/ cost/ risk/ documents/
    ui/                   panels, tables, badges, stat tiles, controls
  lib/
    schema.sql            the full EPC schema
    db.ts queries.ts      connection and the typed query + metrics layer
    agent-context.ts      builds the agent's briefing from the database
    agent-local.ts        the offline analyst
scripts/seed.mjs          the demo-portfolio generator
```

### A few decisions worth knowing

**Earned value is computed in one place.** `projectMetrics()` in
`src/lib/queries.ts` rolls the control accounts up into SPI, CPI, EAC, ETC, VAC
and TCPI. The dashboard, the status bar, the cost view, and the agent all call
it, so there is exactly one definition of each figure.

**The agent gets a briefing, not a database handle.** Every chat turn rebuilds a
plain-text snapshot of the project from the current tables and hands that to the
model as its only source of fact. Answers stay current without the agent needing
query access.

**Charts never carry two scales.** Where two measures differ by an order of
magnitude — period spend against cumulative cost — they get two charts rather
than a second axis. The categorical palette is checked for colourblind
separation and contrast against the dark surface; the values live in
`globals.css` under `--color-series-*`.

**Progress edits write back.** The activity and risk inspectors PATCH through
the API and re-derive what depends on them: earned value follows percent
complete, severity and expected value follow probability and impact. Derived
fields are recomputed server-side rather than trusted from the client.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server on :3000 |
| `npm run build` / `npm start` | Production build and serve |
| `npm run db:seed` | Build and populate the database |
| `npm run db:reset` | Delete and rebuild it |
| `npm run typecheck` | `tsc --noEmit` |

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · SQLite via
better-sqlite3 · Recharts · react-resizable-panels · lucide-react ·
`@anthropic-ai/sdk` for the streaming agent.
