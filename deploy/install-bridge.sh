#!/usr/bin/env bash
# Installs the Bramble print bridge on the machine that has the Bluetooth adapter (the Proxmox host).
# Run as root on the host with the repo's server/ directory next to this script (deploy.sh does this
# with BRIDGE=1). Idempotent. Prints the BRAMBLE_PRINTER line to put in the companion's env.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:-$HERE/../server}"
ROOT=/opt/bramble-bridge
PORT="${BRIDGE_PORT:-8110}"

echo "▶ packages"
apt-get install -y -qq python3-venv python3-pip bluez >/dev/null
systemctl enable --now bluetooth >/dev/null 2>&1 || true

echo "▶ files"
mkdir -p "$ROOT/data"
install -m 0644 "$SRC/milk.py" "$ROOT/milk.py"
install -m 0644 "$SRC/zones.py" "$ROOT/zones.py"  # milk.py writes reminder clocks in the household zone
install -m 0644 "$SRC/niimbot_proto.py" "$ROOT/niimbot_proto.py"
install -m 0644 "$SRC/print_bridge.py" "$ROOT/print_bridge.py"
[ -x "$ROOT/.venv/bin/python" ] || python3 -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/pip" install -q "Pillow>=10,<13" "pyserial>=3.5,<4"

if [ ! -f "$ROOT/data/env" ]; then
  TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
  cat > "$ROOT/data/env" <<ENV
BRIDGE_PORT=$PORT
BRIDGE_TOKEN=$TOKEN
# The printer this bridge drives. Pair a Niimbot once with: bluetoothctl → scan on → pair <MAC> → trust <MAC>
# (use the address that lists "UUID: Serial Port"). Then:
#BRAMBLE_PRINTER=niimbot://bluetooth/AA:BB:CC:DD:EE:FF?model=b1&density=3
#BRAMBLE_PRINTER=niimbot://usb?model=b1
ENV
  chmod 0600 "$ROOT/data/env"
fi

cat > /etc/systemd/system/bramble-print-bridge.service <<UNIT
[Unit]
Description=Bramble print bridge (label printer over Bluetooth/USB)
After=network.target bluetooth.target

[Service]
Type=simple
EnvironmentFile=$ROOT/data/env
ExecStart=$ROOT/.venv/bin/python $ROOT/print_bridge.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now bramble-print-bridge >/dev/null
systemctl restart bramble-print-bridge
sleep 1
systemctl is-active bramble-print-bridge
TOKEN="$(grep ^BRIDGE_TOKEN= "$ROOT/data/env" | cut -d= -f2-)"
IP="$(hostname -I | awk '{print $1}')"
echo "bridge: http://$IP:$PORT  (status: curl -H 'Authorization: Bearer $TOKEN' http://127.0.0.1:$PORT/status)"
echo "companion env line → BRAMBLE_PRINTER=bridge://$IP:$PORT?token=$TOKEN"
