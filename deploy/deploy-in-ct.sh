#!/usr/bin/env bash
# Install Bramble from INSIDE the Baby Buddy LXC (no git, node or SSH needed).
# Downloads the prebuilt bundle branch (see deploy/publish-bundle.sh) and installs it exactly like
# deploy.sh does from a laptop. Run as root:
#   export GITHUB_TOKEN=<fine-grained token with read access to the repo>   (private repo only)
#   curl -fsSL -H "Authorization: token $GITHUB_TOKEN" \
#     https://raw.githubusercontent.com/kidevu123/bramble/deploy-bundle/deploy-in-ct.sh | bash
set -euo pipefail

REPO="${BRAMBLE_REPO:-kidevu123/bramble}"
BRANCH="${BRAMBLE_BUNDLE_BRANCH:-deploy-bundle}"
WEB_ROOT=/var/www/bramble
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

AUTH=()
[ -n "${GITHUB_TOKEN:-}" ] && AUTH=(-H "Authorization: token $GITHUB_TOKEN")

echo "▶ downloading $REPO@$BRANCH"
curl -fsSL "${AUTH[@]}" -o "$TMP/bundle.tgz" "https://api.github.com/repos/$REPO/tarball/$BRANCH"
tar -xzf "$TMP/bundle.tgz" -C "$TMP"
SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -f "$SRC/dist/index.html" ] || { echo "bundle has no dist/index.html — was publish-bundle.sh run?"; exit 1; }
echo "  bundle built from $(cat "$SRC/BUNDLE_COMMIT" 2>/dev/null || echo '?')"

echo "▶ installing web app"
rm -rf "$WEB_ROOT.new" && mkdir -p "$WEB_ROOT.new"
cp -r "$SRC/dist/." "$WEB_ROOT.new/"
install -m 0644 "$SRC/nginx-bramble.conf" /etc/nginx/sites-available/bramble
ln -sfn /etc/nginx/sites-available/bramble /etc/nginx/sites-enabled/bramble
rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/babybuddy /etc/nginx/conf.d/babybuddy.conf 2>/dev/null || true

echo "▶ installing companion service"
rm -rf /opt/bramble-server-src && cp -r "$SRC/server" /opt/bramble-server-src
if bash /opt/bramble-server-src/install.sh >/tmp/bramble-server-install.log 2>&1; then
  echo "  companion: installed"
else
  echo "  companion: install FAILED"; tail -20 /tmp/bramble-server-install.log
fi

nginx -t
rm -rf "$WEB_ROOT.old"
[ -d "$WEB_ROOT" ] && mv "$WEB_ROOT" "$WEB_ROOT.old" || true
mv "$WEB_ROOT.new" "$WEB_ROOT"
chown -R www-data:www-data "$WEB_ROOT"
systemctl reload nginx

echo "▶ health"
curl -s -o /dev/null -w "bramble /       -> %{http_code}\n" http://127.0.0.1/
curl -s -o /dev/null -w "api             -> %{http_code}\n" http://127.0.0.1/api/
curl -s http://127.0.0.1/bramble/health; echo
grep -q "install FAILED" /tmp/bramble-server-install.log 2>/dev/null && { echo "✘ companion install failed (see /tmp/bramble-server-install.log)"; exit 1; }
echo "✔ done"
