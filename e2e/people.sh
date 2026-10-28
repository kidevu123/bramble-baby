#!/usr/bin/env bash
# Brings up the isolated stack for the People probe and runs e2e/people.mjs. Never touches real data.
#
# Two companions share one mock Baby Buddy and one fake "Baby Buddy Django" (server/testdata/fake_manage.py,
# whose users.json the mock reads so a login created from Settings can sign in): companion A can create
# logins, companion B is pointed at a folder with no manage.py so the sheet's "unavailable" state shows.
#   e2e/people.sh [out-dir=./e2e/out/people]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-./e2e/out/people}
WORK=${PEOPLE_WORK:-$(mktemp -d)}
BB=${PEOPLE_BB_PORT:-8810}; COMP=${PEOPLE_COMPANION_PORT:-8820}; COMP_B=${PEOPLE_COMPANION_B_PORT:-8821}; WEB=${PEOPLE_WEB_PORT:-5890}; WEB_B=${PEOPLE_WEB_B_PORT:-5891}
mkdir -p "$WORK/babybuddy" "$WORK/vapid" "$OUT"
cp server/testdata/fake_manage.py "$WORK/babybuddy/manage.py"
pids=()
companions=()
cleanup() { for p in ${pids[@]+"${pids[@]}"} ${companions[@]+"${companions[@]}"}; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
BB_USERS_FILE="$WORK/babybuddy/users.json" node e2e/mock-babybuddy.mjs "$BB" >"$WORK/mockbb.log" 2>&1 & pids+=($!)
BB_UPSTREAM=http://127.0.0.1:$BB BRAMBLE_UPSTREAM=http://127.0.0.1:$COMP npx vite --port "$WEB" --strictPort >"$WORK/vite-a.log" 2>&1 & pids+=($!)
BB_UPSTREAM=http://127.0.0.1:$BB BRAMBLE_UPSTREAM=http://127.0.0.1:$COMP_B npx vite --port "$WEB_B" --strictPort >"$WORK/vite-b.log" 2>&1 & pids+=($!)
common=(BRAMBLE_VAPID_DIR="$WORK/vapid" BABYBUDDY_URL="http://127.0.0.1:$BB" BRAMBLE_PEOPLE_BRIDGE="$WORK/no-bridge" BABYBUDDY_PYTHON="$(command -v python3)")
# Fresh companions (and a fresh household) per pass, so light and dark start from the same place.
start_companions() {
  for p in ${companions[@]+"${companions[@]}"}; do kill "$p" 2>/dev/null || true; done
  [ "${#companions[@]}" -gt 0 ] && sleep 1
  companions=()
  rm -f "$WORK/babybuddy/users.json" "$WORK/babybuddy/calls.json" "$WORK/a-$1.db"* "$WORK/b-$1.db"*
  env "${common[@]}" BRAMBLE_PORT=$COMP BRAMBLE_DB="$WORK/a-$1.db" BABYBUDDY_HOME="$WORK/babybuddy" python3 server/bramble_server.py >>"$WORK/companion-a.log" 2>&1 & companions+=($!)
  env "${common[@]}" BRAMBLE_PORT=$COMP_B BRAMBLE_DB="$WORK/b-$1.db" BABYBUDDY_HOME="$WORK/nowhere" python3 server/bramble_server.py >>"$WORK/companion-b.log" 2>&1 & companions+=($!)
  for port in $COMP $COMP_B; do for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$port/health" >/dev/null && break; sleep 0.5; done; done
}
for port in $WEB $WEB_B; do for _ in $(seq 1 40); do curl -sf "http://localhost:$port/" >/dev/null && break; sleep 0.5; done; done
echo "stack: mock bb :$BB · companion A :$COMP (people available) · companion B :$COMP_B (unavailable) · web :$WEB / :$WEB_B · work $WORK"
status=0
for scheme in ${PEOPLE_RUNS:-light dark}; do
  start_companions "$scheme"
  curl -s "http://127.0.0.1:$COMP/health" | grep -o '"people": {[^}]*}' || true
  PEOPLE_USERS_FILE="$WORK/babybuddy/users.json" node e2e/people.mjs "$OUT" "$scheme" "http://localhost:$WEB" "http://localhost:$WEB_B" | tee "$OUT/$scheme.log" || status=1
done
echo "logs under $WORK"
exit $status
