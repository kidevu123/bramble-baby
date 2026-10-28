#!/usr/bin/env bash
# Brings up an isolated stack for the simple-screen probe and runs e2e/simple-screen.mjs. Never touches real data.
# Like e2e/people.sh: a mock Baby Buddy and the fake "Baby Buddy Django" (server/testdata/fake_manage.py), so a
# Grandma login created from the companion can sign in on a second phone.
#   e2e/simple-screen.sh [out-dir=./e2e/out/simple-screen]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-./e2e/out/simple-screen}
WORK=${SIMPLE_WORK:-$(mktemp -d)}
BB=${SIMPLE_BB_PORT:-8810}; COMP=${SIMPLE_COMPANION_PORT:-8820}; WEB=${SIMPLE_WEB_PORT:-5890}
mkdir -p "$WORK/babybuddy" "$WORK/vapid" "$OUT"
cp server/testdata/fake_manage.py "$WORK/babybuddy/manage.py"
pids=()
companion=""
cleanup() { for p in ${pids[@]+"${pids[@]}"} $companion; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
BB_USERS_FILE="$WORK/babybuddy/users.json" node e2e/mock-babybuddy.mjs "$BB" >"$WORK/mockbb.log" 2>&1 & pids+=($!)
BB_UPSTREAM=http://127.0.0.1:$BB BRAMBLE_UPSTREAM=http://127.0.0.1:$COMP npx vite --port "$WEB" --strictPort >"$WORK/vite.log" 2>&1 & pids+=($!)
PY=${SIMPLE_PYTHON:-python3}
for _ in $(seq 1 40); do curl -sf "http://localhost:$WEB/" >/dev/null && break; sleep 0.5; done
status=0
for scheme in ${SIMPLE_RUNS:-light dark}; do
  [ -n "$companion" ] && kill "$companion" 2>/dev/null && sleep 1
  rm -f "$WORK/babybuddy/users.json" "$WORK/babybuddy/calls.json" "$WORK/c-$scheme.db"*
  BRAMBLE_VAPID_DIR="$WORK/vapid" BABYBUDDY_URL="http://127.0.0.1:$BB" BRAMBLE_PEOPLE_BRIDGE="$WORK/no-bridge" BABYBUDDY_PYTHON="$(command -v python3)" \
    BRAMBLE_PORT=$COMP BRAMBLE_DB="$WORK/c-$scheme.db" BABYBUDDY_HOME="$WORK/babybuddy" "$PY" server/bramble_server.py >>"$WORK/companion.log" 2>&1 &
  companion=$!
  for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$COMP/health" >/dev/null && break; sleep 0.5; done
  node e2e/simple-screen.mjs "$OUT" "$scheme" "http://localhost:$WEB" | tee "$OUT/$scheme.log" || status=1
done
echo "logs under $WORK"
exit $status
