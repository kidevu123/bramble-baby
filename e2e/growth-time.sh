#!/usr/bin/env bash
# Brings up the isolated stack (mock Baby Buddy, companion, vite) and runs e2e/growth-time.mjs in light and
# dark, each against a fresh mock. Never touches real data.
#   e2e/growth-time.sh [out-dir=./e2e/out/growth-time]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-./e2e/out/growth-time}
WORK=${GROWTH_WORK:-$(mktemp -d)}
BB=${GROWTH_BB_PORT:-8830}; COMP=${GROWTH_COMPANION_PORT:-8840}; WEB=${GROWTH_WEB_PORT:-5895}
PY=${PYTHON:-python3}
mkdir -p "$WORK/vapid" "$OUT"
pids=()
stack=()
cleanup() { for p in ${pids[@]+"${pids[@]}"} ${stack[@]+"${stack[@]}"}; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
BB_UPSTREAM=http://127.0.0.1:$BB BRAMBLE_UPSTREAM=http://127.0.0.1:$COMP npx vite --port "$WEB" --strictPort >"$WORK/vite.log" 2>&1 & pids+=($!)
start_stack() {
  for p in ${stack[@]+"${stack[@]}"}; do kill "$p" 2>/dev/null || true; done
  [ "${#stack[@]}" -gt 0 ] && sleep 1
  stack=()
  rm -f "$WORK/$1.db"*
  node e2e/mock-babybuddy.mjs "$BB" >"$WORK/mockbb-$1.log" 2>&1 & stack+=($!)
  BRAMBLE_PORT=$COMP BRAMBLE_DB="$WORK/$1.db" BRAMBLE_VAPID_DIR="$WORK/vapid" BABYBUDDY_URL="http://127.0.0.1:$BB" "$PY" server/bramble_server.py >>"$WORK/companion.log" 2>&1 & stack+=($!)
  for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$COMP/health" >/dev/null && break; sleep 0.5; done
  for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$BB/api/profile/" >/dev/null 2>&1 && break; curl -s -o /dev/null "http://127.0.0.1:$BB/" && break; sleep 0.5; done
}
for _ in $(seq 1 40); do curl -sf "http://localhost:$WEB/" >/dev/null && break; sleep 0.5; done
echo "stack: mock bb :$BB · companion :$COMP · web :$WEB · work $WORK"
status=0
for scheme in ${GROWTH_RUNS:-light dark}; do
  start_stack "$scheme"
  node e2e/growth-time.mjs "$OUT" "http://localhost:$WEB" "$scheme" | tee "$OUT/$scheme.log" || status=1
done
echo "logs under $WORK"
exit $status
