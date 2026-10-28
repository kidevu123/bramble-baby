#!/usr/bin/env bash
# Build Bramble locally and ship it to the Baby Buddy LXC (CT 101) through the Proxmox host.
# Usage: deploy/deploy.sh [--skip-build]
#
# Transport note: the Proxmox host's sshd only runs commands reliably with a pty (-tt), so the
# bundle is streamed through the pty as base64 with the tty in raw mode, sized exactly with head -c.
set -euo pipefail

PVE_HOST="${PVE_HOST:?Set PVE_HOST=user@your-proxmox-host}"
CT_ID="${CT_ID:-101}"
WEB_ROOT="/var/www/bramble"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# IPQoS=none: the home router drops packets carrying ssh's default DSCP marking (seen 2026-10-06), so the
# TCP connect never completes while plain nc to port 22 works.
SSH=(ssh -tt -o BatchMode=yes -o ConnectTimeout=25 -o IPQoS=none "$PVE_HOST")

remote() { "${SSH[@]}" "$1; exit" 2>&1 | tr -d '\r' | grep -vE '^Connection to .* closed\.$' || true; }

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "▶ building"
  (cd "$HERE" && npm run build >/dev/null)
fi

BUNDLE="$(mktemp -t bramble-XXXX).tgz"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$BUNDLE" -C "$HERE/dist" . -C "$HERE/deploy" nginx-bramble.conf -C "$HERE" server
B64="$BUNDLE.b64"
base64 < "$BUNDLE" > "$B64"
SIZE=$(wc -c < "$B64" | tr -d ' ')
echo "▶ uploading $(du -h "$BUNDLE" | cut -f1) (base64 $SIZE bytes)"
"${SSH[@]}" "stty raw -echo; head -c $SIZE > /tmp/bramble.b64; stty sane; base64 -d /tmp/bramble.b64 > /tmp/bramble.tgz && rm -f /tmp/bramble.b64 && echo UPLOAD-OK; exit" < "$B64" 2>&1 | tr -d '\r' | grep -E 'UPLOAD-OK' || { echo "upload failed"; exit 1; }
rm -f "$BUNDLE" "$B64"

if [[ "${BRIDGE:-}" == "1" ]]; then
  BBUNDLE="$(mktemp -t bramble-bridge-XXXX).tgz"
  COPYFILE_DISABLE=1 tar --no-xattrs -czf "$BBUNDLE" -C "$HERE" server deploy/install-bridge.sh
  BB64="$BBUNDLE.b64"; base64 < "$BBUNDLE" > "$BB64"; BSIZE=$(wc -c < "$BB64" | tr -d ' ')
  "${SSH[@]}" "stty raw -echo; head -c $BSIZE > /tmp/bramble-bridge.b64; stty sane; base64 -d /tmp/bramble-bridge.b64 > /tmp/bramble-bridge.tgz && rm -f /tmp/bramble-bridge.b64 && echo BRIDGE-UPLOAD-OK; exit" < "$BB64" 2>&1 | tr -d '\r' | grep -E 'BRIDGE-UPLOAD-OK' || { echo "bridge upload failed"; exit 1; }
  rm -f "$BBUNDLE" "$BB64"
fi

echo "▶ installing into CT $CT_ID"
INSTALL_LOG="$(mktemp -t bramble-install-XXXX).log"
remote "pct push $CT_ID /tmp/bramble.tgz /tmp/bramble.tgz && pct exec $CT_ID -- bash -c '
  set -e
  rm -rf $WEB_ROOT.new && mkdir -p $WEB_ROOT.new
  tar -xzf /tmp/bramble.tgz -C $WEB_ROOT.new
  mv $WEB_ROOT.new/nginx-bramble.conf /etc/nginx/sites-available/bramble
  ln -sfn /etc/nginx/sites-available/bramble /etc/nginx/sites-enabled/bramble
  rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/babybuddy /etc/nginx/conf.d/babybuddy.conf 2>/dev/null || true
  rm -rf /opt/bramble-server-src && mv $WEB_ROOT.new/server /opt/bramble-server-src
  bash /opt/bramble-server-src/install.sh >/tmp/bramble-server-install.log 2>&1 && echo companion: installed || { echo companion: install FAILED; tail -20 /tmp/bramble-server-install.log; }
  nginx -t
  rm -rf $WEB_ROOT.old
  [ -d $WEB_ROOT ] && mv $WEB_ROOT $WEB_ROOT.old || true
  mv $WEB_ROOT.new $WEB_ROOT
  chown -R www-data:www-data $WEB_ROOT
  systemctl reload nginx
  rm -f /tmp/bramble.tgz
  echo INSTALL-OK
' ; rm -f /tmp/bramble.tgz" | tee "$INSTALL_LOG"

if [[ "${BRIDGE:-}" == "1" ]]; then
  echo "▶ print bridge on the Proxmox host"
  # The bundle is still at /tmp/bramble.tgz on the host only until the CT step removes it, so re-upload is not needed:
  # install-bridge.sh runs from the extracted server/ directory of the bundle on the host.
  remote "mkdir -p /opt/bramble-bridge-src && tar -xzf /tmp/bramble-bridge.tgz -C /opt/bramble-bridge-src 2>/dev/null || true; BRIDGE_PORT=${BRIDGE_PORT:-8110} bash /opt/bramble-bridge-src/deploy/install-bridge.sh /opt/bramble-bridge-src/server"
fi

echo "▶ health"
remote "pct exec $CT_ID -- bash -c 'curl -s -o /dev/null -w \"bramble / -> %{http_code}\n\" http://127.0.0.1/; curl -s -o /dev/null -w \"api      -> %{http_code}\n\" http://127.0.0.1/api/; curl -s -o /dev/null -w \"babybuddy:8000 -> %{http_code}\n\" http://127.0.0.1:8000/login/; curl -s http://127.0.0.1/bramble/health; echo'"
# remote() swallows the SSH exit code (the pty transport makes it unreliable), so judge the install by
# its own markers: INSTALL-OK is printed only after the webroot swap and nginx reload both succeeded.
if grep -q "companion: install FAILED" "$INSTALL_LOG"; then
  echo "✘ companion service install failed — notifications and companion data are down until this is fixed"
  rm -f "$INSTALL_LOG"
  exit 1
fi
if ! grep -q "^INSTALL-OK" "$INSTALL_LOG"; then
  echo "✘ install did not complete (no INSTALL-OK). The previous release is still live if nginx -t failed; read the output above."
  rm -f "$INSTALL_LOG"
  exit 1
fi
rm -f "$INSTALL_LOG"
echo "✔ done"
