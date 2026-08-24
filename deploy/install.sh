#!/usr/bin/env bash
#
# Starkvisionz — install on a fresh Debian or Ubuntu VPS.
#
#   git clone https://github.com/starkvisionz/Controls-Agent.git /opt/starkvisionz
#   sudo /opt/starkvisionz/deploy/install.sh --domain controls.example.com --email you@example.com
#
# What it does, in order: Node and nginx, a system account that owns nothing but
# its database, the build, an environment file with a generated session secret,
# a systemd unit, an nginx site, a Let's Encrypt certificate, and a nightly
# backup timer.
#
# Idempotent. Running it again after `git pull` rebuilds and restarts without
# touching the database, the secret, or the certificate.
#
# What it deliberately does NOT do: seed the demo portfolio, create an account,
# or open any port other than 80, 443 and whatever SSH is already using. The
# first administrator is created by you, at the end, by hand.

set -euo pipefail

APP_USER=starkvisionz
APP_DIR=/opt/starkvisionz
DATA_DIR=/var/lib/starkvisionz
ENV_DIR=/etc/starkvisionz
ENV_FILE="$ENV_DIR/starkvisionz.env"
NODE_MAJOR=22

DOMAIN=""
EMAIL=""
PORT=3000
WANT_TLS=1
WANT_DEMO=0

die() { printf '\n  %s\n\n' "$*" >&2; exit 1; }
say() { printf '\n\033[1m==>\033[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }

usage() {
  cat <<'USAGE'
Usage: install.sh --domain <fqdn> [--email <address>] [options]

  --domain   <fqdn>     Host name this will serve. Point its A record at this
                        VPS before running, or TLS issuance will fail.
  --email    <address>  Where Let's Encrypt sends expiry warnings.
  --port     <number>   Loopback port for the app (default 3000).
  --no-tls              Skip certbot. Serves plain HTTP — for a VPS you reach
                        over a VPN, or when a certificate already exists.
  --demo                Also load the demo portfolio. Fictional projects and
                        four shared demo accounts: never on a real instance.
  -h, --help            This.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email)  EMAIL="${2:-}"; shift 2 ;;
    --port)   PORT="${2:-}"; shift 2 ;;
    --no-tls) WANT_TLS=0; shift ;;
    --demo)   WANT_DEMO=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "Unknown option: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."
[ -n "$DOMAIN" ] || { usage; die "--domain is required."; }
[[ "$PORT" =~ ^[0-9]+$ ]] || die "--port must be a number."

# The script lives in the checkout it installs. Work out that checkout rather
# than assuming it was cloned to the expected path.
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$SOURCE_DIR/package.json" ] || die "$SOURCE_DIR does not look like the Starkvisionz checkout."

if [ "$SOURCE_DIR" != "$APP_DIR" ]; then
  note "Installing from $SOURCE_DIR (expected $APP_DIR — that is fine, paths follow the checkout)."
  APP_DIR="$SOURCE_DIR"
fi

# ---------------------------------------------------------------------------
say "Packages"
# ---------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# build-essential and python3 are the fallback path for better-sqlite3 on an
# architecture with no prebuilt binary; on x86_64 and arm64 they go unused.
apt-get install -y -qq curl ca-certificates gnupg git nginx build-essential python3 >/dev/null

have_node=0
if command -v node >/dev/null 2>&1; then
  current="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$current" -ge 20 ] && have_node=1
  note "node $(node -v) present"
fi

if [ "$have_node" -eq 0 ]; then
  note "installing Node $NODE_MAJOR"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
  note "node $(node -v)"
fi

# ---------------------------------------------------------------------------
say "Account and directories"
# ---------------------------------------------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  # No login shell and no home of its own: this account exists to own a
  # database file and run one process.
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
  note "created $APP_USER"
else
  note "$APP_USER exists"
fi

install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR"
install -d -o root -g "$APP_USER" -m 0750 "$ENV_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------------------------------------------------------------------------
say "Environment"
# ---------------------------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
  note "keeping $ENV_FILE (secret and settings unchanged)"
  if [ "$WANT_TLS" -eq 1 ] && grep -q '^STARKVISIONZ_INSECURE_COOKIES=1' "$ENV_FILE"; then
    note "NOTE: this env file still turns off Secure cookies, from an earlier"
    note "      --no-tls install. Once TLS is up, delete that line and restart."
  fi
else
  secret="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"

  # Session cookies are Secure in production, and a browser will not send a
  # Secure cookie back over plain http — so on a --no-tls install a correct
  # password would bounce straight back to the login page. Turn it off here
  # rather than leaving that to be discovered.
  cookie_note=""
  if [ "$WANT_TLS" -eq 0 ]; then
    cookie_note="
# No TLS on this instance, so the Secure flag would stop the browser returning
# the session cookie at all. Sessions and passwords cross the network in the
# clear: reach this over a VPN or an SSH tunnel, never over the open internet.
# Remove this line the moment a certificate is in place.
STARKVISIONZ_INSECURE_COOKIES=1"
  fi

  umask 077
  cat > "$ENV_FILE" <<ENV
# Starkvisionz. Root-owned, 0640, readable by the $APP_USER group.
# Changing STARKVISIONZ_SESSION_SECRET signs everybody out.
STARKVISIONZ_SESSION_SECRET=$secret

# The database. On a persistent volume, outside the checkout, so a redeploy
# cannot delete it.
STARKVISIONZ_DB_PATH=$DATA_DIR/starkvisionz.db

# Exactly one reverse proxy (the nginx site below) sits in front. Raising this
# without adding a real proxy would let a caller forge the address the rate
# limiter keys on.
STARKVISIONZ_TRUSTED_PROXIES=1

HOST=127.0.0.1
PORT=$PORT
$cookie_note
# Optional: the agent panel streams from the Claude API when this is set, and
# falls back to a local analyst that reads the same database when it is not.
# ANTHROPIC_API_KEY=
ENV
  umask 022
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  note "wrote $ENV_FILE with a fresh session secret"
fi

# The port may have been given on a re-run against an existing env file.
if ! grep -q "^PORT=$PORT$" "$ENV_FILE"; then
  sed -i "s/^PORT=.*/PORT=$PORT/" "$ENV_FILE"
fi
PORT="$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2)"

# ---------------------------------------------------------------------------
say "Build"
# ---------------------------------------------------------------------------
note "npm ci"
sudo -u "$APP_USER" env -C "$APP_DIR" npm ci --no-audit --no-fund
note "npm run build"
sudo -u "$APP_USER" env -C "$APP_DIR" NODE_ENV=production npm run build

# ---------------------------------------------------------------------------
say "Database"
# ---------------------------------------------------------------------------
sudo -u "$APP_USER" env -C "$APP_DIR" \
  STARKVISIONZ_DB_PATH="$DATA_DIR/starkvisionz.db" npm run db:init

if [ "$WANT_DEMO" -eq 1 ]; then
  note "loading the demo portfolio (--demo)"
  sudo -u "$APP_USER" env -C "$APP_DIR" \
    STARKVISIONZ_DB_PATH="$DATA_DIR/starkvisionz.db" npm run db:seed -- --demo-users
fi

# ---------------------------------------------------------------------------
say "Service"
# ---------------------------------------------------------------------------
sed "s|^WorkingDirectory=.*|WorkingDirectory=$APP_DIR|" \
  "$APP_DIR/deploy/starkvisionz.service" > /etc/systemd/system/starkvisionz.service
systemctl daemon-reload
systemctl enable --quiet starkvisionz
systemctl restart starkvisionz

# Give it a moment, then say plainly whether it came up.
sleep 3
if ! systemctl is-active --quiet starkvisionz; then
  journalctl -u starkvisionz -n 30 --no-pager || true
  die "starkvisionz did not start. The last 30 log lines are above."
fi
note "starkvisionz is running on 127.0.0.1:$PORT"

# ---------------------------------------------------------------------------
say "nginx"
# ---------------------------------------------------------------------------
site=/etc/nginx/sites-available/starkvisionz
if [ -f "$site" ] && grep -q "managed by Certbot" "$site"; then
  note "keeping the existing site (Certbot has edited it)"
else
  sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" \
    "$APP_DIR/deploy/nginx.conf" > "$site"
  ln -sf "$site" /etc/nginx/sites-enabled/starkvisionz
  rm -f /etc/nginx/sites-enabled/default
  note "wrote $site for $DOMAIN"
fi

nginx -t
systemctl reload nginx

# ---------------------------------------------------------------------------
say "Firewall"
# ---------------------------------------------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null
  note "opened 80 and 443 (ufw)"
else
  note "ufw is not active — nothing to open. Port $PORT stays on loopback either way."
fi

# ---------------------------------------------------------------------------
say "TLS"
# ---------------------------------------------------------------------------
if [ "$WANT_TLS" -eq 0 ]; then
  note "skipped (--no-tls). This instance serves plain HTTP: sessions and"
  note "passwords cross the network in the clear. Do not expose it publicly."
elif [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  note "certificate for $DOMAIN already exists — renewal is already scheduled"
else
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot_args=(--nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos)
  if [ -n "$EMAIL" ]; then
    certbot_args+=(--email "$EMAIL")
  else
    certbot_args+=(--register-unsafely-without-email)
    note "no --email given: no expiry warnings will be sent"
  fi
  if certbot "${certbot_args[@]}"; then
    note "certificate issued; renewal runs from certbot's own timer"
  else
    note "certbot failed. The app is up on plain HTTP — the usual cause is the"
    note "A record for $DOMAIN not pointing here yet. Fix DNS and run:"
    note "  sudo certbot --nginx -d $DOMAIN --redirect"
  fi
fi

# ---------------------------------------------------------------------------
say "Backups"
# ---------------------------------------------------------------------------
install -m 0755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/starkvisionz-backup
cat > /etc/systemd/system/starkvisionz-backup.service <<UNIT
[Unit]
Description=Back up the Starkvisionz database

[Service]
Type=oneshot
User=$APP_USER
Group=$APP_USER
Environment=STARKVISIONZ_DB_PATH=$DATA_DIR/starkvisionz.db
Environment=STARKVISIONZ_BACKUP_DIR=$DATA_DIR/backups
WorkingDirectory=$APP_DIR
ExecStart=/usr/local/bin/starkvisionz-backup
UNIT

cat > /etc/systemd/system/starkvisionz-backup.timer <<'UNIT'
[Unit]
Description=Nightly Starkvisionz backup

[Timer]
OnCalendar=daily
# The VPS may be asleep or rebooting at the hour; catch up rather than skip.
Persistent=true
RandomizedDelaySec=30m

[Install]
WantedBy=timers.target
UNIT

install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR/backups"
systemctl daemon-reload
systemctl enable --quiet --now starkvisionz-backup.timer
note "nightly backup to $DATA_DIR/backups, 14 kept"

# ---------------------------------------------------------------------------
scheme=http
[ -d "/etc/letsencrypt/live/$DOMAIN" ] && scheme=https

cat <<DONE

  Starkvisionz is running at $scheme://$DOMAIN

  There is no sign-up page and no account yet. Create the first administrator:

    sudo -u $APP_USER env -C $APP_DIR \\
      STARKVISIONZ_DB_PATH=$DATA_DIR/starkvisionz.db \\
      npm run user -- add --email you@example.com --name 'Your Name' --role admin

  Then sign in and add the rest from the Accounts view.

  Day to day:
    sudo systemctl status starkvisionz      how it is
    sudo journalctl -u starkvisionz -f      what it is saying
    sudo $APP_DIR/deploy/update.sh          pull, rebuild, restart
    sudo systemctl start starkvisionz-backup  back up now

DONE
