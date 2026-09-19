# Starkvisionz — container image.
#
# Three stages, and the split matters for one reason: better-sqlite3 is a
# native addon. Its compiled .node is built against a specific libc, so the
# stage that installs it and the stage that runs it must be the same base
# image. Building on Debian and running on Alpine produces an image that
# builds cleanly and then fails at the first query.

# ---------------------------------------------------------------------------
# 1. Build the app. Needs devDependencies — typescript, tailwind and the @types
#    are all dev, and `next build` does not run without them.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

# node-gyp's toolchain, for the case where better-sqlite3 has no prebuilt
# binary for this platform (arm64 hosts, mostly). On x86_64 the prebuild is
# downloaded and none of this is used.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copied before the source so a change to application code does not re-run the
# install layer.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# 2. Production dependencies only, on the same base, so the native binding
#    built here is the one the runtime can load.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# 3. The image that ships. No compiler, no devDependencies, no source.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    # 0.0.0.0, not the 127.0.0.1 the `serve` script defaults to. A container
    # that binds loopback is unreachable through a published port, and the
    # symptom is a health check that times out with nothing in the log. The
    # script's default is right for the VPS install, where nginx is in front
    # of it; it is wrong here.
    HOST=0.0.0.0 \
    PORT=3000 \
    # Outside /app, so a volume can hold it and an image rebuild cannot
    # replace it.
    STARKVISIONZ_DB_PATH=/data/starkvisionz.db

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/.next        ./.next

# next start reads the config at runtime.
COPY package.json next.config.ts ./
COPY public ./public

# The account and database tooling is plain .mjs — no TypeScript toolchain
# needed — but it reads two things off disk that are easy to forget:
# db-init.mjs loads src/lib/schema.sql relative to the working directory, and
# the scripts import the *-core.mjs modules. Without these a fresh volume
# cannot be initialised and `npm run user` cannot create the first account.
COPY scripts ./scripts
COPY src/lib/schema.sql ./src/lib/schema.sql
COPY src/lib/accounts-core.mjs ./src/lib/accounts-core.mjs
COPY src/lib/change-orders-core.mjs ./src/lib/change-orders-core.mjs
COPY src/lib/rollup-core.mjs ./src/lib/rollup-core.mjs

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data \
 && chown -R node:node /data /app

# The node image ships an unprivileged `node` user. Nothing here needs root.
USER node

VOLUME ["/data"]
EXPOSE 3000

# /login answers 200 without a session. It also answers 503 while
# STARKVISIONZ_SESSION_SECRET is unset, which is deliberate — the app refuses
# to serve rather than expose the registers unauthenticated — so an unhealthy
# container with no secret is the correct reading, not a false alarm.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
