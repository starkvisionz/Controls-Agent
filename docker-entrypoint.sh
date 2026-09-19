#!/bin/sh
# Starkvisionz container entrypoint.
set -e

# Applies schema.sql and nothing else, and every statement is CREATE ... IF NOT
# EXISTS — so this initialises a fresh volume and is a no-op on one that
# already holds data. Verified against a populated database: running it twice
# leaves every row intact. That is what lets a container start against an empty
# volume with no separate migration step.
node scripts/db-init.mjs

# exec, so next is PID 1 and receives SIGTERM directly. Without it the shell
# holds PID 1, swallows the signal, and `docker stop` waits the full ten
# seconds before killing a database mid-write.
exec node node_modules/next/dist/bin/next start -H "${HOST:-0.0.0.0}" -p "${PORT:-3000}"
