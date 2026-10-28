#!/usr/bin/env bash
# Build Bramble and push the built files to the `deploy-bundle` branch so a host with no node/git can
# install with deploy/deploy-in-ct.sh. Usage: deploy/publish-bundle.sh [source-branch-or-commit]
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="${BRAMBLE_BUNDLE_BRANCH:-deploy-bundle}"
SRC_REF="$(git -C "$HERE" rev-parse --short HEAD)"

echo "▶ building $SRC_REF"
(cd "$HERE" && npm run build >/dev/null)

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git -C "$HERE" worktree add --detach -q "$WORK" HEAD
git -C "$WORK" checkout -q --orphan "$BRANCH"
git -C "$WORK" rm -rfq . >/dev/null
cp -r "$HERE/dist" "$WORK/dist"
cp -r "$HERE/server" "$WORK/server"
rm -rf "$WORK/server/__pycache__"
cp "$HERE/deploy/nginx-bramble.conf" "$HERE/deploy/deploy-in-ct.sh" "$WORK/"
echo "$SRC_REF" > "$WORK/BUNDLE_COMMIT"
printf 'Prebuilt Bramble bundle from %s. Install inside the LXC with deploy-in-ct.sh. Do not edit by hand.\n' "$SRC_REF" > "$WORK/README.md"
git -C "$WORK" add -A
git -C "$WORK" -c user.name="bramble-bundle" -c user.email="bundle@bramble.local" commit -qm "bundle: build of $SRC_REF"
git -C "$WORK" push -f -q origin "$BRANCH"
git -C "$HERE" worktree remove --force "$WORK"
echo "✔ pushed $BRANCH (built from $SRC_REF)"
