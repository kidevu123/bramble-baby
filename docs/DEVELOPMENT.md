# Developing Bramble

The probes and the isolated run below use a mock Baby Buddy and a throwaway companion database: no real data is touched.

## Layout

```
src/                 React + TypeScript PWA (Vite, TanStack Query, custom SW in src/sw.ts)
server/              Companion service (Python stdlib + pywebpush): contractions, activities,
                     milestones, shared child settings, reminders, Web Push
deploy/              nginx config + deploy script (CT 101 via the Proxmox host)
e2e/                 Playwright probes against a mock Baby Buddy, PWA checks, README screenshots
docs/                This file, self-hosting, screenshots
```

## Develop

```bash
npm install
BB_UPSTREAM=http://<your-baby-buddy> npm run dev   # against a real Baby Buddy — careful, real data
npm test               # unit tests
python3 -m unittest server/test_server.py server/test_hatch.py server/test_people.py server/test_nudges.py   # companion service tests (venv with pywebpush py-vapid cryptography Pillow)
```

### Isolated end-to-end run (never touches real data)

```bash
node e2e/mock-babybuddy.mjs 8000 &
BRAMBLE_PORT=8100 BRAMBLE_DB=/tmp/b.db BRAMBLE_VAPID_DIR=/tmp BABYBUDDY_URL=http://127.0.0.1:8000 python3 server/bramble_server.py &
BB_UPSTREAM=http://127.0.0.1:8000 BRAMBLE_UPSTREAM=http://127.0.0.1:8100 npm run dev &
node e2e/smoke.mjs ./e2e/out http://localhost:5173
npm run build && npx vite preview --port 4173 &  node e2e/pwa-check.mjs http://localhost:4173
e2e/people.sh ./e2e/out/people   # People: brings up its own stack (two companions, a fake Baby Buddy Django), light + dark
e2e/simple-screen.sh ./e2e/out/simple-screen   # the grandparents' simple screen: Grandma signs in on a second phone, premade bottle finished or how much is left (and the mark on the parents' timeline), diaper, undo, the way out (own stack, light + dark)
node e2e/nudges.mjs ./e2e/out/nudges http://localhost:5173 light   # Settings › Notifications reminders + push-tap hand-off (also: dark)
MOCK_BB=http://127.0.0.1:<bb-port> node e2e/stash-list.mjs ./e2e/out/stash-list http://localhost:5173   # Stash: places in order, the key, sun/moon, folded freezer, the deadline column, the in-time fridge move (light, dark and 320)
node e2e/feeding-tiles.mjs ./e2e/out/feeding-tiles http://localhost:5173 light   # Reports › Feeding's tiles: Bottle / day beside what the weight suggests; Diapers leads with the wet verdict; no card on Home (also: dark)
node e2e/bar-tap.mjs ./e2e/out/bar-tap http://localhost:5173 light   # every bar chart answers a tap: value, day and parts above the bar, the rest dimmed, tap away / tap again / Escape closes (also: dark)
node e2e/freezer-reprint.mjs ./e2e/out/freezer-reprint http://localhost:5173 <label-dir> light   # a new label on a move into or out of the freezer, none on fridge ↔ counter or with the switch off (also: dark)
MOCK_BB=http://127.0.0.1:<bb-port> node e2e/fortify.mjs ./e2e/out/fortify http://localhost:5173 light   # calories and fortified milk: Settings goal + strength, the Stash recipe, fortified premade bottles (24 h), the bottle's calories and kcal tag, Reports › Feeding calorie tiles, the pediatrician report (also: dark)
node e2e/time-zone.mjs ./e2e/out/time-zone http://localhost:5173 light   # the household time zone: seeded by an admin phone (New York), not overwritten by a London phone, moved there with one tap (also: dark)
node e2e/rearrange-bottles.mjs ./e2e/out/rearrange-bottles http://localhost:5173 light   # Stash › Premade bottles › Rearrange: move to an empty spot, swap with a filled one, cancel, Done (also: dark)
node e2e/born-early.mjs ./e2e/out/born-early http://localhost:5173 light   # Settings › Born early: weeks at birth + NICU stay; Home band, Child page, Reports without age verdicts, NICU pumping tiles, the NICU stash (colostrum, Take to the NICU), came home, cleared (also: dark)
node e2e/whats-new.mjs ./e2e/out/whats-new light http://localhost:5173   # What's new: nothing on a fresh sign-in, the card after an update, Got it, Settings › What's new (also: dark)
node e2e/quick-log.mjs ./e2e/out/quick-log http://localhost:5173       # one-tap time chips on every sheet, pumping prefilled from the last session
node e2e/auto-print.mjs ./e2e/out/auto-print http://localhost:5173 [label-dir]   # save prints the sticker (needs BRAMBLE_PRINTER=file://<label-dir> on the companion)
node e2e/multi-bag.mjs ./e2e/out/multi-bag http://localhost:5173 light  # one bottle from several bags (also: dark)
node e2e/quick-text.mjs ./e2e/out/quick-text http://localhost:5173 light  # Type it on Home: typed lines open prefilled sheets, nothing saved (also: dark)
MOCK_BB=http://127.0.0.1:<bb-port> LABELS=<file-printer dir> node e2e/travel-stickers.mjs ./e2e/out/travel-stickers http://localhost:5173 light   # travel stickers printed ahead, scanned in the pumping sheet (also: dark)
MOCK_BB=http://127.0.0.1:<bb-port> LABELS=<file-printer dir> node e2e/night-bottles.mjs ./e2e/out/night-bottles http://localhost:5173 light   # premade bottles into spots 1–5, fed from a spot, spot stickers (also: dark, and a 4th argument 320)
node e2e/weight-gain.mjs ./e2e/out/weight-gain http://localhost:5173 light   # gain in grams a day vs the doctor's goal, Day view growth rows per day (also: dark)
node e2e/growth-chart.mjs ./e2e/out/growth-chart http://localhost:5173 light # weight checks (a dashed step from each check, dots met/missed), tap/slide/keys read each weighing, the growth chart by age with WHO bands, feeding by weight (also: dark)
node e2e/doctor-report.mjs ./e2e/out/doctor-report http://localhost:5173 light   # the pediatrician report (also: dark)
node e2e/stash-runway.mjs ./e2e/out/stash-runway http://localhost:5173 light   # how long the stash lasts, the goal in Settings › Pumps (also: dark)
node e2e/day-log.mjs ./e2e/out/day-log http://localhost:5173 light  # Reports › Day on yesterday: only that day's measurements, Everything logged by kind with counts, the longest gap and edit (also: dark)
node e2e/pumps.mjs ./e2e/out/pumps http://localhost:5173 light      # Settings › Pumps, the pump on each session, Reports › Summary › Pump: this week against the week before, bar chart and tagging the sessions without a pump (also: dark)
node e2e/label-shots.mjs ./e2e/out/labels http://localhost:5173 [font-dir]   # every label preset rendered 1:1 with Nunito, QR decoded (font-dir: a local copy of Google Fonts' Nunito when offline)
```


```bash
```


### README screenshots

`docs/screenshots/` is made from a made-up baby on the mock stack, never from a real household:

```bash
node e2e/readme-shots.mjs docs/screenshots http://localhost:5173 light
```
