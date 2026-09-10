# Deploying Starkvisionz on a VPS

A single-instance deployment: the app on loopback, nginx in front with TLS, the
database on a persistent path outside the checkout, and a nightly backup. Tested
against a fresh Debian/Ubuntu VPS of the kind Hostinger, Hetzner or DigitalOcean
hand you.

## Before you start

- **A VPS** running Debian 11+ or Ubuntu 22.04+, with root or sudo.
- **A domain** whose A record already points at the VPS. Let's Encrypt proves
  control by resolving the name, so DNS has to be right *first* — that is the
  single most common reason the install ends without a certificate.

  Two things bite on hosts that manage DNS for you, Hostinger among them:

  **An `ALIAS` or `CNAME` already on that name blocks the A record.** An `ALIAS`
  *is* the address answer, synthesised when the name is queried, so the zone
  cannot also hold an A record for it — the panel refuses the new record rather
  than let two authorities disagree. These get created for you, by a site
  builder or a CDN, on names you never configured. Delete it; if a CDN put it
  there, turn the CDN off for that hostname or it comes back.

  **Delete any `AAAA` on the name too, unless the VPS actually has that
  address.** Let's Encrypt resolves IPv6 in preference to IPv4, so an `AAAA`
  left pointing at the old host fails validation while `dig +short <domain>`
  shows a perfectly correct A record and tells you nothing.

  Check what is published, not what the panel shows, before you install:

  ```bash
  dig +short controls.example.com A      # the VPS address, and nothing else
  dig +short controls.example.com AAAA   # empty, or the VPS's own IPv6
  ```

  Old records have their TTL left to run, so give it a few minutes.
- **Ports 80 and 443 free.** nginx needs both. A VPS image with a preinstalled
  Docker stack — Traefik, Caddy, or a panel like Coolify or Dokploy — already
  holds them, and the install refuses to start rather than fail partway. Stop
  that service, then make sure it stays stopped:

  ```bash
  sudo ss -lntp | grep -E ':80 |:443 '     # expect no output
  ```

  A container with `restart: always` comes back on reboot and takes the port
  before nginx does, so the site works until the first reboot and then does
  not. `docker update --restart=no <name>` if you are keeping Docker around.

- **~1 GB of free RAM for the build.** `next build` is the heaviest thing that
  will ever run here. On a 1 GB instance, add swap before you start:

  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

## Install

```bash
sudo git clone https://github.com/starkvisionz/Controls-Agent.git /opt/starkvisionz
sudo /opt/starkvisionz/deploy/install.sh \
  --domain controls.example.com \
  --email you@example.com \
  --admin-email you@example.com
```

Ten minutes, mostly `npm ci` and `next build`. It is idempotent: run it again
after a `git pull` and it rebuilds and restarts without touching the database,
the session secret or the certificate.

`--admin-email` creates the first administrator and prints a generated password
once, at the end. That password has to be replaced at first sign-in, and the
refusal is the server's, not the sign-in page's: an account still on a starting
password can authenticate and read who it is, and is refused everything else
until it picks its own — the API, and the project data a page would otherwise
send with its first render. So the string that scrolled past your terminal stops
being a usable credential the moment the account is used — and a copy of it,
from your scrollback or a deploy log, does not become one.

The same holds for every account created from the Accounts view, since those
start on a password an administrator chose for somebody else.

The installer passes that password to the account tool through a pipe rather
than an argument, because a command line is readable from `/proc` by any local
account for as long as the process runs. `npm run user -- add --password-stdin`
is the same path if you are scripting account creation yourself.

Leave `--admin-email` off and the instance installs with no account and no
sign-up page, which is to say no way in. Then make the account yourself:

```bash
sudo -u starkvisionz env -C /opt/starkvisionz \
  STARKVISIONZ_DB_PATH=/var/lib/starkvisionz/starkvisionz.db \
  npm run user -- add --email you@example.com --name 'Your Name' --role admin
```

That prompts for the password rather than taking it as an argument, so it does
not end up in your shell history. Either way, sign in and add everyone else
from the Accounts view.

### Options

| Flag | Effect |
|---|---|
| `--domain <fqdn>` | Required. The name nginx serves and certbot certifies. |
| `--email <address>` | Where Let's Encrypt sends expiry warnings. |
| `--admin-email <addr>` | Create the first administrator. The password is generated, printed once, and must be changed at first sign-in. |
| `--admin-name <name>` | Name on that account. Defaults to the part before the `@`. |
| `--port <n>` | Loopback port for the app. Default 3000. |
| `--no-tls` | Skip certbot — see the warning below. |
| `--demo` | Also load the demo portfolio: three fictional projects and four shared demo accounts. Never on an instance holding real work. |

## What it puts where

| Path | What |
|---|---|
| `/opt/starkvisionz` | The checkout and the build, owned by the `starkvisionz` account |
| `/var/lib/starkvisionz/starkvisionz.db` | The database — outside the checkout, so a redeploy cannot delete it |
| `/var/lib/starkvisionz/backups` | Nightly backups, 14 kept, gzipped |
| `/etc/starkvisionz/starkvisionz.env` | Session secret and settings. Root-owned, 0640 |
| `/etc/systemd/system/starkvisionz.service` | The unit |
| `/etc/nginx/sites-available/starkvisionz` | The site |

The `starkvisionz` account has no login shell and can write exactly one
directory: `/var/lib/starkvisionz`. The unit enforces that with
`ProtectSystem=strict` and a single `ReadWritePaths`.

## Day to day

```bash
sudo systemctl status starkvisionz          # how it is
sudo journalctl -u starkvisionz -f          # what it is saying
sudo /opt/starkvisionz/deploy/update.sh     # pull, rebuild, restart
sudo systemctl start starkvisionz-backup    # back up right now
```

`update.sh` backs up before it builds and prints the exact rollback command if
the new build does not come back up.

## Backups, and restoring from one

The nightly timer uses SQLite's own online backup — a consistent snapshot taken
under the same locking the app uses, with the service still running. Copying the
`.db` file with `cp` while the app is live does **not** do that: the newest
writes are still in the `-wal`, and the copy can restore torn.

To restore:

```bash
sudo systemctl stop starkvisionz
sudo -u starkvisionz gunzip -c /var/lib/starkvisionz/backups/starkvisionz-<stamp>.db.gz \
  > /var/lib/starkvisionz/starkvisionz.db
sudo -u starkvisionz rm -f /var/lib/starkvisionz/starkvisionz.db-wal \
                           /var/lib/starkvisionz/starkvisionz.db-shm
sudo systemctl start starkvisionz
```

Removing the stale `-wal` and `-shm` matters: left behind, they belong to the
database you just replaced, and SQLite will refuse to open the pair.

Backups live on the same disk as the database, which protects you from a bad
import or a mistaken deletion — not from losing the VPS. Copy them off the box
on a schedule if the data matters:

```bash
rsync -az --delete root@vps:/var/lib/starkvisionz/backups/ ~/starkvisionz-backups/
```

## Two things worth knowing

**Rate limiting keys on the client address, and the header is caller-supplied.**
`STARKVISIONZ_TRUSTED_PROXIES=1` in the env file says exactly one proxy sits in
front, so the app believes only the entry that nginx observed. Put Cloudflare or
another proxy in front of nginx and that number has to go to 2 — leave it at 1
and every caller shares one bucket; raise it beyond the real hop count and a
caller can forge the address the limiter keys on.

**`--no-tls` turns off Secure cookies, and says so in the env file.** Session
cookies are marked `Secure` in production, and a browser will not send a `Secure`
cookie back over plain http — so without that opt-out a correct password lands
you back on the login page with no explanation. Use `--no-tls` only for an
instance you reach over a VPN or an SSH tunnel; on it, sessions and passwords
cross the network readable. Once a certificate is in place, delete the
`STARKVISIONZ_INSECURE_COOKIES=1` line and `systemctl restart starkvisionz`.

## When it does not come up

```bash
sudo journalctl -u starkvisionz -n 50 --no-pager
```

| What you see | What it is |
|---|---|
| `not configured for authenticated access` | `STARKVISIONZ_SESSION_SECRET` is empty or the env file is unreadable. The app refuses to serve rather than expose the registers. |
| `SQLITE_CANTOPEN` | `/var/lib/starkvisionz` is not writable by `starkvisionz`, or `ReadWritePaths` in the unit no longer matches `STARKVISIONZ_DB_PATH`. |
| `EADDRINUSE` | Something else holds the port. `sudo ss -lntp \| grep <port>`. On 80/443 it is usually a preinstalled Traefik or panel stack — see ports, above. |
| Killed during `next build` | Out of memory. Add swap (above) and re-run. |
| 502 from nginx | The app is down; the unit's status says why. |
| certbot failed | Almost always DNS: an `ALIAS`/`CNAME` still on the name, a stale `AAAA` resolving ahead of the A record, or a TTL that has not run out. Check both queries above, then `sudo certbot --nginx -d <domain> --redirect`. |

## The agent panel

Optional. With `ANTHROPIC_API_KEY` set in the env file, the panel streams
answers from the Claude API; without it, the same panel answers from a local
analyst reading the same database. The app is fully functional either way — the
key only changes how good the prose is.

Add it to `/etc/starkvisionz/starkvisionz.env` and restart. The nginx site
already disables buffering on `/api/chat`, which is what keeps the answer
streaming token by token instead of arriving all at once when the turn ends.
