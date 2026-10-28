#!/usr/bin/env bash
# Brings up the isolated stack on private ports and runs e2e/full-sweep.mjs once per pass, restarting the
# companion between passes (its Hatch sign-in limit is five per ten minutes). Never touches real data.
#   e2e/full-sweep.sh [out-dir=./e2e/out/sweep]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-./e2e/out/sweep}
WORK=${SWEEP_WORK:-$(mktemp -d)}
BB=${SWEEP_BB_PORT:-8710}; HATCH=${SWEEP_HATCH_PORT:-8731}; COMP=${SWEEP_COMPANION_PORT:-8720}; WEB=${SWEEP_WEB_PORT:-5790}
mkdir -p "$WORK/labels" "$WORK/vapid" "$OUT"
pids=()
companion=""
# Every port must be free: a server left on one (another probe, an orphaned vite) would answer the
# health checks below and the sweep would run against the wrong stack without saying so.
for port in "$BB" "$HATCH" "$COMP" "$WEB"; do
  if (echo >"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then echo "port $port is already in use; pick other SWEEP_*_PORT values" >&2; exit 2; fi
done
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  [ -n "$companion" ] && kill "$companion" 2>/dev/null || true
}
trap cleanup EXIT
node e2e/mock-babybuddy.mjs "$BB" >"$WORK/mockbb.log" 2>&1 & pids+=($!)
node e2e/mock-hatch.mjs "$HATCH" >"$WORK/mockhatch.log" 2>&1 & pids+=($!)
# vite itself, not through npx: killing an npx wrapper leaves the dev server running with no parent.
BB_UPSTREAM=http://127.0.0.1:$BB BRAMBLE_UPSTREAM=http://127.0.0.1:$COMP node_modules/.bin/vite --port "$WEB" --strictPort >"$WORK/vite.log" 2>&1 & pids+=($!)
# A fresh companion DB per pass: the Hatch ledger keys on mock record ids, which mock-hatch.mjs reuses after a reset.
start_companion() {
  if [ -n "$companion" ]; then kill "$companion" 2>/dev/null || true; sleep 1; fi
  BRAMBLE_PORT=$COMP BRAMBLE_DB="$WORK/b-$1.db" BRAMBLE_VAPID_DIR="$WORK/vapid" BABYBUDDY_URL=http://127.0.0.1:$BB \
    BRAMBLE_HATCH_URL=http://127.0.0.1:$HATCH BRAMBLE_PRINTER="file://$WORK/labels" python3 server/bramble_server.py >>"$WORK/companion.log" 2>&1 &
  companion=$!
  for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$COMP/health" >/dev/null && break; sleep 0.5; done
}
for _ in $(seq 1 40); do curl -sf "http://localhost:$WEB/" >/dev/null && break; sleep 0.5; done
for p in "${pids[@]}"; do
  if ! kill -0 "$p" 2>/dev/null; then echo "a stack process exited at start-up; see $WORK/*.log" >&2; tail -n 5 "$WORK"/*.log >&2; exit 2; fi
done
status=0
for pass in ${SWEEP_RUNS:-light dark light-320 light-rm}; do
  start_companion "$pass"
  SWEEP_RUNS=$pass node e2e/full-sweep.mjs "$OUT" "http://localhost:$WEB" "http://127.0.0.1:$HATCH" "$WORK/labels" | tee "$OUT/$pass.log" || status=1
done
echo "logs and label PNGs under $WORK"
exit $status
