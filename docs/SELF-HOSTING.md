# Self-hosting Bramble

Bramble is two pieces next to a [Baby Buddy](https://github.com/babybuddy/babybuddy) install:

1. the **app**: a static PWA (`npm run build` → `dist/`) served by nginx on the same host as Baby Buddy
   (`deploy/nginx-bramble.conf` proxies `/api/` to Baby Buddy and `/bramble/` to the companion);
2. the **companion**: a small Python service (`server/`, standard library plus `pywebpush` and `Pillow`) for what Baby
   Buddy does not store: shared settings, the milk stash, reminders and Web Push, people and the Hatch scale. `server/install.sh` installs it as the systemd service `bramble-server` on port 8100.

Push notifications need HTTPS, so put the host behind a reverse proxy or tunnel with a certificate
(Cloudflare Tunnel, Caddy, Tailscale Funnel…). On iPhone, open it in Safari and Add to Home Screen.

## Deploy

```bash
deploy/deploy.sh
```

No laptop handy? From a shell **inside** the Baby Buddy LXC (no git or node needed):

```bash
deploy/publish-bundle.sh        # once, from a machine with node: builds and pushes the deploy-bundle branch
# then, inside the LXC as root (the token is only needed for a private fork):
export GITHUB_TOKEN=<fine-grained token, Contents: read>
curl -fsSL -H "Authorization: token $GITHUB_TOKEN" https://raw.githubusercontent.com/kidevu123/bramble/deploy-bundle/deploy-in-ct.sh | bash
```

`deploy/deploy.sh` (with `PVE_HOST=root@<proxmox-host>`) builds, streams the bundle to the Proxmox host over SSH,
`pct push`es it into the Baby Buddy container, installs the companion service (`server/install.sh`, systemd `bramble-server`), swaps the nginx config, reloads, and prints health.

Baby Buddy itself needs your public hostname (e.g. `baby.yourdomain.example`) in `ALLOWED_HOSTS` and the https
origin (plus `:8000`) in `CSRF_TRUSTED_ORIGINS` in `babybuddy/settings/production.py`.

The companion service checks tokens against Baby Buddy over `http://127.0.0.1`. If `ALLOWED_HOSTS` does not include
`127.0.0.1`/`localhost`, put `BABYBUDDY_HOST=baby.yourdomain.example` in `/opt/bramble-server/data/env` (the installer
creates the file). The push contact (`BRAMBLE_VAPID_SUB`) and the printer (`BRAMBLE_PRINTER`) can go there too, or
be set from the app (Settings › Notifications, Settings › Milk labels & printer), which wins.

### Bramble for another family

Each family runs its own copy: its own Baby Buddy and its own Bramble companion, on its own machine (an old laptop,
a mini PC, a Proxmox container like the first one). **Do not add another family as people on your Bramble**: Baby
Buddy shows every child to everyone who can sign in, and one server holds one Hatch account.

Once Baby Buddy and the companion are installed (`server/install.sh` beside Baby Buddy, the built app served by nginx
with `deploy/nginx-bramble.conf`), everything household-specific is set from the app by its admin (the Baby Buddy
staff login), nothing on the server:

- **Settings › Household › People**: one login per caregiver, with a role.
- **Settings › Milk labels & printer**: the printer (a Zebra or Brother QL on the network by IP address, or the print
  bridge for a Bluetooth Niimbot), with a test label; the label size; stickers to print.
- **Settings › Notifications**: the push contact email (push services refuse to send without a real one), and the
  **time zone** the times in notifications are written in. The admin's phone records its own zone the first time it
  opens the app; a phone in another zone can move it there with one tap. Until a zone is set the server's own is used,
  and a container left in UTC writes every clock 4–5 hours off for a family in the US.
- **Settings › Hatch scale**: that family's own Hatch sign-in, kept on
  their server (`data/hatch.json`, mode 0600), never on GitHub or in this repo.
- **Settings › Pumps**: their own pumps (a new household starts with none), **Units**, and the Child tab.

`BRAMBLE_PRINTER` and `BRAMBLE_VAPID_SUB` in `/opt/bramble-server/data/env` still work and are the fallback: what is
set in the app wins, and clearing it there goes back to them.

### People: creating Baby Buddy logins from Settings

Baby Buddy's API has no user endpoint, so the companion creates logins through Baby Buddy's own Django (`manage.py
shell`), as Baby Buddy's user. The installer looks for Baby Buddy in the usual places (`/opt/babybuddy` with a
`.venv`, `/srv/babybuddy`, `/var/www/babybuddy`, …), asks Django where its database is, writes
`/usr/local/libexec/bramble/people-bridge`, the sudo rule `/etc/sudoers.d/bramble-people` and a systemd drop-in that
opens the database folder, and tries it. If it cannot find
the layout, `curl -s http://127.0.0.1:8100/health` shows `"people": {"available": false, "problem": "…"}` and the
People screen shows the same sentence: put `BABYBUDDY_HOME=/path/to/babybuddy` (and if needed `BABYBUDDY_PYTHON`,
`BABYBUDDY_USER`, `DJANGO_SETTINGS_MODULE`) in `/opt/bramble-server/data/env` and run the installer again. Until then
roles and names still work for logins that already exist.

### If notifications don't arrive

Open Settings → Notifications → "Notification checks" on the phone. Each row is one link in the chain (HTTPS, installed
to the Home Screen, permission, subscription, companion reachable, server can send, device registered) and "Test" now
reports how many devices were reached and the push service's error text if it failed. On the host,
`curl -s http://127.0.0.1:8100/health` shows `push`, `webpush`, `vapid`, `problem` and `lastPushError`.
