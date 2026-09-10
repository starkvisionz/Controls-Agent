# Deploying Starkvisionz on Railway

Railway runs a real container with a real filesystem, so this deploys without
changing a line of the data layer: `better-sqlite3` is a native module and it
works here exactly as it does on a VPS. The database lives on a mounted volume
so it survives redeploys.

That is the whole reason Railway is a fit and Cloudflare Workers is not — a
Worker has no filesystem and cannot load a native addon, so moving there would
mean rewriting every query against D1.

## Before you start

- A Railway account, and this repository connected to it.
- **A volume.** Without one the database is written to the container filesystem
  and is destroyed on the next deploy. This is the single most important step
  on this page.

## Set it up

**1. Create the service** from this repo. `railway.json` in the root is picked
up automatically — it sets the build, the start command, a health check on
`/login`, and one replica.

**2. Add a volume**, mounted at `/data`.

**3. Set the variables:**

| Variable | Value |
|---|---|
| `STARKVISIONZ_SESSION_SECRET` | 64 hex characters — generate with `npm run user -- secret` |
| `STARKVISIONZ_DB_PATH` | `/data/starkvisionz.db` — must be inside the volume mount |
| `STARKVISIONZ_TRUSTED_PROXIES` | `1` — see the note below before trusting it |
| `ANTHROPIC_API_KEY` | optional; the agent panel falls back to a local analyst without it |

Do **not** set `NODE_ENV` yourself. Railway sets it at runtime, and setting it
as a service variable applies it to the build too — where `npm ci` would then
skip devDependencies and `next build` would fail on missing TypeScript and
Tailwind. The build command pins `--include=dev` so this survives either way,
but there is no reason to invite it.

The app **refuses to serve** without `STARKVISIONZ_SESSION_SECRET`, answering
503 rather than exposing the registers unauthenticated. The health check will
fail until it is set, which is the intended order.

**4. Deploy**, then create the first administrator. There is no sign-up page,
so until you do this the instance has no way in. Open a shell on the service
(`railway ssh`, or the terminal in the dashboard) and run:

```bash
STARKVISIONZ_DB_PATH=/data/starkvisionz.db \
  npm run user -- add --email you@example.com --name 'Your Name' --role admin
```

It prompts for the password rather than taking it as an argument. Add
`--must-change` if somebody else will be typing it in.

**5. Add your domain** under the service's Networking settings, and create the
CNAME Railway gives you at your DNS provider. Railway issues the certificate.

## Two constraints worth understanding

**One replica, and it is not a preference.** SQLite tolerates exactly one
writing process, and a Railway volume attaches to one instance. Scaling the
service to two replicas does not double throughput; it corrupts the database or
fails to start. `railway.json` pins `numReplicas: 1` — leave it.

**Check `STARKVISIONZ_TRUSTED_PROXIES` rather than trusting the 1.** The rate
limiter keys on the client address, taken from `X-Forwarded-For`, and that
header is only believable to the depth you declare. The value must equal the
number of proxies actually in front of the app. Too low and every caller shares
one bucket — degraded, but safe. **Too high and a caller can forge the address
the limiter keys on**, which is the failure that matters, so err downward.

`1` is the right answer for a plain Railway service. Put Cloudflare or another
proxy in front and it becomes 2. If you are unsure, leave it unset: the app
then believes no forwarding header at all and rate-limits everyone together,
which is the safe default rather than a broken one.

## Day to day

Pushes to the connected branch redeploy. The volume, the database and the
variables are untouched by a deploy.

`db:init` runs on every boot. It applies the schema and nothing else, and it is
idempotent — verified against a populated database, where running it twice
leaves every row intact. That is what makes a fresh volume work without a
separate migration step.

**Back up.** Nothing here does it for you, unlike the VPS install's nightly
timer. A Railway volume is not a backup, and a `cp` of a live SQLite database
in WAL mode can restore torn. From a shell on the service:

```bash
node -e '
const Database = require("better-sqlite3");
const db = new Database("/data/starkvisionz.db", { readonly: true });
db.backup("/data/backup.db").then(() => db.close());
'
```

Then copy it off the volume. `deploy/backup.sh` does the same thing on a
schedule and can be adapted.

## When it does not come up

| What you see | What it is |
|---|---|
| Health check fails, log says `not configured for authenticated access` | `STARKVISIONZ_SESSION_SECRET` is not set. |
| Health check times out with no error | The app bound loopback instead of `0.0.0.0`, so Railway's proxy cannot reach it. Check the start command is `npm run start:railway`, not `npm run serve` — `serve` binds `127.0.0.1` on purpose, because the VPS install puts nginx in front of it. |
| Data gone after a deploy | No volume, or `STARKVISIONZ_DB_PATH` points outside the mount. |
| `next build` fails on missing `typescript` | `NODE_ENV=production` was set as a service variable and reached the build. Remove it. |
| `SQLITE_BUSY`, or corruption | More than one replica. Set it back to 1. |
