#!/usr/bin/env bash
# Idempotent installer for the Bramble companion service. Run as root on the Baby Buddy host.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT=/opt/bramble-server

echo "▶ packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1 || true
apt-get install -y -qq python3-venv python3-pip curl >/dev/null

echo "▶ user + dirs"
id -u bramble >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin bramble
mkdir -p "$ROOT/data"

echo "▶ files"
install -m 0644 "$HERE/bramble_server.py" "$ROOT/bramble_server.py"
install -m 0644 "$HERE/milk.py" "$ROOT/milk.py"
install -m 0644 "$HERE/niimbot_proto.py" "$ROOT/niimbot_proto.py"
# Hatch Grow scale import: hatch_api.py holds Hatch's routes and field names, hatch.py the sync.
install -m 0644 "$HERE/hatch.py" "$ROOT/hatch.py"
install -m 0644 "$HERE/hatch_api.py" "$ROOT/hatch_api.py"
# People: Baby Buddy logins managed from Bramble. people.py is the companion side, people_django.py runs
# inside Baby Buddy's Django (people-setup.sh below finds it and writes the wrapper + sudo rule).
install -m 0644 "$HERE/people.py" "$ROOT/people.py"
install -m 0644 "$HERE/people_django.py" "$ROOT/people_django.py"
# Nudges: reminders computed from what was logged (feeding due, pump due, diaper check, summary, Hatch weight).
install -m 0644 "$HERE/nudges.py" "$ROOT/nudges.py"
# The household time zone every clock in a notification is written in (zones.py).
install -m 0644 "$HERE/zones.py" "$ROOT/zones.py"
install -m 0644 "$HERE/bramble-server.service" /etc/systemd/system/bramble-server.service

echo "▶ venv + deps"
[ -x "$ROOT/.venv/bin/python" ] || python3 -m venv "$ROOT/.venv"
# Pinned so a deploy never silently pulls a cryptography release without a wheel for this host.
for attempt in 1 2 3; do
  if "$ROOT/.venv/bin/pip" install -q "pywebpush==2.5.0" "py-vapid==1.9.4" "cryptography>=42,<51" "brother_ql==0.9.4" "Pillow>=10,<13"; then break; fi
  echo "  pip attempt $attempt failed, retrying"; sleep 3
  [ "$attempt" = 3 ] && { echo "pip install failed"; exit 1; }
done
"$ROOT/.venv/bin/python" -c "import pywebpush, py_vapid, cryptography" || { echo "push libraries do not import; push will be disabled"; exit 1; }
# Niimbot driver is vendored (niimbot_proto.py); pyserial only matters for a USB cable into this machine.
"$ROOT/.venv/bin/pip" install -q "pyserial>=3.5,<4" >/dev/null 2>&1 || true
usermod -aG dialout bramble 2>/dev/null || true
[ -f "$ROOT/data/env" ] || cat > "$ROOT/data/env" <<'ENV'
# Optional overrides for the Bramble companion service (read by systemd).
# BABYBUDDY_HOST=baby.yourdomain.example
# BRAMBLE_VAPID_SUB=mailto:you@example.com
# People (Settings › Household): only when install.sh could not find Baby Buddy's Django on its own.
# BABYBUDDY_HOME=/opt/babybuddy
# BABYBUDDY_PYTHON=/opt/babybuddy/.venv/bin/python
# BABYBUDDY_USER=www-data
# DJANGO_SETTINGS_MODULE=babybuddy.settings.production
ENV

# The service user owns its data and venv only; the code directory stays root's, so nothing the service runs
# as can replace what install.sh put there (the people-bridge sudo rule in particular).
chown root:root "$ROOT"
chmod 755 "$ROOT"
chown root:root "$ROOT"/*.py "$ROOT"/*.service 2>/dev/null || true
chown -R bramble:bramble "$ROOT/data" "$ROOT/.venv"
chmod 750 "$ROOT/data"

echo "▶ people (Baby Buddy logins from Settings)"
ROOT="$ROOT" bash "$HERE/people-setup.sh" || echo "  people-setup failed; people management will say so in /health"

echo "▶ service"
systemctl daemon-reload
systemctl enable --now bramble-server >/dev/null
systemctl restart bramble-server
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8100/health >/tmp/bramble-health.json 2>/dev/null; then break; fi
  sleep 1
done
systemctl is-active bramble-server
cat /tmp/bramble-health.json 2>/dev/null || { echo "health check failed"; journalctl -u bramble-server -n 20 --no-pager; exit 1; }
echo
grep -q '"push": true' /tmp/bramble-health.json || echo "WARNING: push is disabled; see 'problem' above"
